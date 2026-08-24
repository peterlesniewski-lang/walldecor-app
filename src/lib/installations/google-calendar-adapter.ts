import { createHash } from 'node:crypto'
import { google } from 'googleapis'
import {
  CalendarConfigurationError,
  CalendarConflictError,
  CalendarRetryableError,
  type CalendarCancelInput,
  type CalendarUpsertInput,
  type CalendarWriteResult,
  type InstallationCalendarAdapter,
} from './calendar-adapter'
import type { GoogleCalendarConfiguration } from './calendar-config'
import { getGoogleCalendarConfiguration } from './calendar-server-config'
import type { CalendarEvent } from './calendar-event'

/** Must remain materially shorter than the five-minute outbox lease. */
export const GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS = 45_000

type GoogleEventData = {
  id?: string | null
  htmlLink?: string | null
  etag?: string | null
  extendedProperties?: { private?: Record<string, string | null | undefined> | null } | null
}

type GoogleEventsClient = {
  get: (parameters: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ data: GoogleEventData }>
  insert: (parameters: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ data: GoogleEventData }>
  patch: (parameters: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ data: GoogleEventData }>
  delete: (parameters: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ data?: unknown }>
}

type GoogleCalendarClient = { events: GoogleEventsClient }

function statusFrom(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { code?: unknown; response?: { status?: unknown }; status?: unknown }
  const status = candidate.response?.status ?? candidate.status ?? candidate.code
  const parsed = typeof status === 'number' ? status : Number(status)
  return Number.isInteger(parsed) ? parsed : null
}

function mapsToRetryable(error: unknown): boolean {
  const status = statusFrom(error)
  if (status === 409 || status === 429 || (status !== null && status >= 500 && status <= 599)) return true
  if (!error || typeof error !== 'object') return false
  const code = String((error as { code?: unknown }).code ?? '').toUpperCase()
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ABORT_ERR'].includes(code)
}

function normalizeGoogleError(error: unknown): never {
  if (error instanceof CalendarRetryableError || error instanceof CalendarConflictError || error instanceof CalendarConfigurationError) throw error
  const status = statusFrom(error)
  if (status === 412) throw new CalendarConflictError()
  if (status === 401 || status === 403) throw new CalendarConfigurationError()
  if (mapsToRetryable(error)) throw new CalendarRetryableError(status === 429 ? 'RATE_LIMIT' : 'NETWORK_ERROR')
  throw new CalendarConfigurationError('Google Calendar request was rejected.')
}

function isNotFound(error: unknown): boolean {
  return statusFrom(error) === 404
}

function requiredText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

/**
 * Google event IDs only permit lowercase base32hex (`a-v0-9`). SHA-256 hex is
 * a subset; prefixing it keeps IDs deterministic, valid, and safely long.
 */
export function stableGoogleEventIdForVisit(visitId: string): string {
  const normalized = visitId.trim()
  if (normalized.length === 0) throw new CalendarConfigurationError('Visit id is required for Calendar synchronization.')
  return `ab${createHash('sha256').update(normalized).digest('hex')}`
}

function requestOptions(controller: AbortController | null): Record<string, unknown> {
  return {
    timeout: GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS,
    ...(controller ? { signal: controller.signal } : {}),
  }
}

async function withRequestTimeout<T>(operation: (options: Record<string, unknown>) => Promise<T>): Promise<T> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort()
      reject(new CalendarRetryableError('TIMEOUT'))
    }, GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS)
  })
  try {
    return await Promise.race([operation(requestOptions(controller)), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function requestBody(event: CalendarEvent, eventId: string): Record<string, unknown> {
  if (event.privateProperties.wallDecorVisitId !== event.visitId) {
    throw new CalendarConflictError('Calendar event ownership is inconsistent.')
  }
  return {
    id: eventId,
    summary: event.summary,
    location: event.location,
    description: event.description,
    start: event.start,
    end: event.end,
    attendees: event.attendeeEmails.map((email) => ({ email })),
    extendedProperties: { private: { wallDecorVisitId: event.visitId } },
  }
}

function assertOwnedByVisit(data: GoogleEventData, visitId: string): void {
  if (data.extendedProperties?.private?.wallDecorVisitId !== visitId) {
    throw new CalendarConflictError('Calendar event does not belong to this WallDecor visit.')
  }
}

function resultFrom(data: GoogleEventData, fallbackEventId: string): CalendarWriteResult {
  const returnedEventId = requiredText(data.id)
  if (returnedEventId && returnedEventId !== fallbackEventId) {
    throw new CalendarConflictError('Google Calendar returned an unexpected event id.')
  }
  const eventId = returnedEventId ?? fallbackEventId
  const htmlLink = requiredText(data.htmlLink)
  const etag = requiredText(data.etag)
  if (!htmlLink || !etag) throw new CalendarRetryableError('INVALID_RESPONSE')
  return { eventId, htmlLink, etag }
}

class GoogleInstallationCalendarAdapter implements InstallationCalendarAdapter {
  private readonly calendarId: string
  private readonly events: GoogleEventsClient

  constructor(configuration: GoogleCalendarConfiguration, calendar?: GoogleCalendarClient) {
    this.calendarId = configuration.calendarId
    if (calendar) {
      this.events = calendar.events
      return
    }
    const auth = new google.auth.JWT({
      email: configuration.credentials.client_email,
      key: configuration.credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar'],
      subject: configuration.impersonatedUser,
    })
    this.events = (google.calendar({ version: 'v3', auth }) as unknown as GoogleCalendarClient).events
  }

  private async getEvent(eventId: string): Promise<GoogleEventData | null> {
    try {
      const result = await withRequestTimeout((options) => this.events.get({ calendarId: this.calendarId, eventId }, options))
      return result.data
    } catch (error) {
      if (isNotFound(error)) return null
      return normalizeGoogleError(error)
    }
  }

  async upsert(input: CalendarUpsertInput): Promise<CalendarWriteResult> {
    const eventId = stableGoogleEventIdForVisit(input.event.visitId)
    if (input.externalId !== null && input.externalId !== eventId) {
      throw new CalendarConflictError('Calendar event id does not belong to this WallDecor visit.')
    }

    const existing = await this.getEvent(eventId)
    if (!existing) {
      try {
        const created = await withRequestTimeout((options) => this.events.insert({
          calendarId: this.calendarId,
          sendUpdates: 'all',
          requestBody: requestBody(input.event, eventId),
        }, options))
        return resultFrom(created.data, eventId)
      } catch (error) {
        return normalizeGoogleError(error)
      }
    }

    assertOwnedByVisit(existing, input.event.visitId)
    const remoteEtag = requiredText(existing.etag)
    if (!remoteEtag) throw new CalendarRetryableError('INVALID_RESPONSE')
    let etag: string
    if (input.forceOverwrite) {
      etag = remoteEtag
    } else if (input.etag !== null) {
      if (input.etag !== remoteEtag) throw new CalendarConflictError()
      etag = input.etag
    } else if (input.externalId === null) {
      // A previous insert may have reached Google but not our database.
      etag = remoteEtag
    } else {
      throw new CalendarConflictError('Calendar event has no local ETag.')
    }

    try {
      const patched = await withRequestTimeout((options) => this.events.patch({
        calendarId: this.calendarId,
        eventId,
        sendUpdates: 'all',
        requestBody: requestBody(input.event, eventId),
      }, { ...options, headers: { 'If-Match': etag } }))
      return resultFrom(patched.data, eventId)
    } catch (error) {
      return normalizeGoogleError(error)
    }
  }

  async cancel(input: CalendarCancelInput): Promise<void> {
    const expectedEventId = stableGoogleEventIdForVisit(input.visitId)
    if (input.externalId !== null && input.externalId !== expectedEventId) {
      throw new CalendarConflictError('Calendar event id does not belong to this WallDecor visit.')
    }
    const eventId = expectedEventId
    const existing = await this.getEvent(eventId)
    if (!existing) return

    assertOwnedByVisit(existing, input.visitId)
    const remoteEtag = requiredText(existing.etag)
    if (!remoteEtag) throw new CalendarRetryableError('INVALID_RESPONSE')
    let etag: string
    if (input.forceOverwrite) {
      etag = remoteEtag
    } else if (input.etag !== null) {
      if (input.etag !== remoteEtag) throw new CalendarConflictError()
      etag = input.etag
    } else if (input.externalId === null) {
      // Recover a prior deterministic insert whose response never reached our database.
      etag = remoteEtag
    } else {
      throw new CalendarConflictError('Calendar event has no local ETag.')
    }
    try {
      await withRequestTimeout((options) => this.events.delete({
        calendarId: this.calendarId,
        eventId,
        sendUpdates: 'all',
      }, { ...options, headers: { 'If-Match': etag } }))
    } catch (error) {
      if (isNotFound(error)) return
      return normalizeGoogleError(error)
    }
  }
}

/** The only construction path: environment guards run before a Google client can exist. */
export function createGoogleInstallationCalendarAdapter(): InstallationCalendarAdapter {
  return new GoogleInstallationCalendarAdapter(getGoogleCalendarConfiguration())
}
