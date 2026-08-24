import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  events: {
    get: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  calendar: vi.fn(),
  jwt: vi.fn(),
}))

vi.mock('googleapis', () => ({
  google: {
    auth: { JWT: mocks.jwt },
    calendar: mocks.calendar,
  },
}))

import {
  CalendarConfigurationError,
  CalendarConflictError,
  CalendarRetryableError,
} from '@/lib/installations/calendar-adapter'
import {
  createGoogleInstallationCalendarAdapter,
  GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS,
  stableGoogleEventIdForVisit,
} from '@/lib/installations/google-calendar-adapter'
import type { CalendarEvent } from '@/lib/installations/calendar-event'
import * as publicCalendarConfig from '@/lib/installations/calendar-config'
import {
  assertInstallationCalendarAdapterAllowed,
  getInstallationCalendarReadiness,
} from '@/lib/installations/calendar-server-config'
import type { GoogleCalendarConfiguration } from '@/lib/installations/calendar-config'

const testConfiguration: GoogleCalendarConfiguration = {
  calendarId: 'test-calendar@group.calendar.google.com',
  impersonatedUser: 'info@walldecor.pl',
  credentials: {
    type: 'service_account',
    client_email: 'calendar-sync@example.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nexample\\n-----END PRIVATE KEY-----\\n',
  },
}

function testCredentialsBase64(): string {
  return Buffer.from(JSON.stringify(testConfiguration.credentials)).toString('base64')
}

function event(visitId = 'visit-1'): CalendarEvent {
  return {
    visitId,
    summary: 'Montaż MON-1 — Jan Kowalski',
    location: 'Puławska 17, Warszawa',
    description: 'Karta montażu: https://app.walldecor.pl/installations/order-1',
    start: { dateTime: '2026-09-14T06:00:00.000Z', timeZone: 'Europe/Warsaw' },
    end: { dateTime: '2026-09-14T14:00:00.000Z', timeZone: 'Europe/Warsaw' },
    attendeeEmails: ['installer@example.pl'],
    privateProperties: { wallDecorVisitId: visitId },
  }
}

function googleEvent(visitId = 'visit-1', etag = 'etag-1') {
  return {
    id: stableGoogleEventIdForVisit(visitId),
    htmlLink: `https://calendar.google.test/event/${visitId}`,
    etag,
    extendedProperties: { private: { wallDecorVisitId: visitId } },
  }
}

function errorWithStatus(status: number) {
  return Object.assign(new Error(`Google ${status}`), { code: status, response: { status } })
}

describe('GoogleInstallationCalendarAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('INSTALLATION_CALENDAR_ENABLED', 'true')
    vi.stubEnv('INSTALLATION_CALENDAR_ADAPTER', 'google')
    vi.stubEnv('GOOGLE_CALENDAR_ID', testConfiguration.calendarId)
    vi.stubEnv('GOOGLE_CALENDAR_IMPERSONATED_USER', testConfiguration.impersonatedUser)
    vi.stubEnv('GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_B64', testCredentialsBase64())
    mocks.calendar.mockReturnValue({ events: mocks.events })
    mocks.jwt.mockImplementation(function JwtStub() { return { kind: 'jwt' } })
    mocks.events.get.mockResolvedValue({ data: googleEvent() })
    mocks.events.insert.mockResolvedValue({ data: googleEvent() })
    mocks.events.patch.mockResolvedValue({ data: googleEvent('visit-1', 'etag-2') })
    mocks.events.delete.mockResolvedValue({ data: undefined })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function adapter() {
    return createGoogleInstallationCalendarAdapter()
  }

  it('creates an event at a stable Google-compatible id after confirming it does not already exist', async () => {
    mocks.events.get.mockRejectedValueOnce(errorWithStatus(404))
    const result = await adapter().upsert({ event: event(), externalId: null, etag: null, forceOverwrite: false })

    expect(result).toEqual({ eventId: stableGoogleEventIdForVisit('visit-1'), htmlLink: 'https://calendar.google.test/event/visit-1', etag: 'etag-1' })
    expect(stableGoogleEventIdForVisit('visit-1')).toMatch(/^[a-v0-9]{5,1024}$/)
    expect(mocks.events.get).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'test-calendar@group.calendar.google.com',
      eventId: stableGoogleEventIdForVisit('visit-1'),
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(mocks.events.insert).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'test-calendar@group.calendar.google.com',
      sendUpdates: 'all',
      requestBody: expect.objectContaining({
        id: stableGoogleEventIdForVisit('visit-1'),
        attendees: [{ email: 'installer@example.pl' }],
        extendedProperties: { private: { wallDecorVisitId: 'visit-1' } },
      }),
    }), expect.objectContaining({ timeout: expect.any(Number), signal: expect.any(AbortSignal) }))
  })

  it('recovers a pre-existing stable event after uncertain insertion only when it belongs to the same visit', async () => {
    const recovered = googleEvent('visit-1', 'remote-etag')
    mocks.events.get.mockResolvedValueOnce({ data: recovered })

    await adapter().upsert({ event: event(), externalId: null, etag: null, forceOverwrite: false })

    expect(mocks.events.insert).not.toHaveBeenCalled()
    expect(mocks.events.patch).toHaveBeenCalledWith(expect.objectContaining({
      eventId: stableGoogleEventIdForVisit('visit-1'), sendUpdates: 'all',
    }), expect.objectContaining({ headers: { 'If-Match': 'remote-etag' } }))
  })

  it('patches with If-Match and force overwrite first reads the current ETag', async () => {
    const current = googleEvent('visit-1', 'etag-1')
    mocks.events.get.mockResolvedValueOnce({ data: current })
    await adapter().upsert({ event: event(), externalId: current.id, etag: 'etag-1', forceOverwrite: false })

    expect(mocks.events.patch).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'test-calendar@group.calendar.google.com', eventId: current.id, sendUpdates: 'all',
    }), expect.objectContaining({ headers: { 'If-Match': 'etag-1' } }))

    mocks.events.get.mockResolvedValueOnce({ data: googleEvent('visit-1', 'new-current-etag') })
    await adapter().upsert({ event: event(), externalId: current.id, etag: 'stale-etag', forceOverwrite: true })
    expect(mocks.events.patch).toHaveBeenLastCalledWith(expect.objectContaining({ eventId: current.id }), expect.objectContaining({ headers: { 'If-Match': 'new-current-etag' } }))
  })

  it.each([
    [412, CalendarConflictError],
    [429, CalendarRetryableError],
    [500, CalendarRetryableError],
    [401, CalendarConfigurationError],
    [403, CalendarConfigurationError],
  ])('maps Google HTTP %s to the safe adapter error', async (status, ErrorClass) => {
    mocks.events.get.mockRejectedValueOnce(errorWithStatus(status))
    await expect(adapter().upsert({ event: event(), externalId: null, etag: null, forceOverwrite: false })).rejects.toBeInstanceOf(ErrorClass)
  })

  it('does not delete an event owned by another visit, even during a forced cancellation', async () => {
    const foreign = { ...googleEvent('other-visit'), id: stableGoogleEventIdForVisit('visit-1') }
    mocks.events.get.mockResolvedValueOnce({ data: foreign })

    await expect(adapter().cancel({ visitId: 'visit-1', externalId: stableGoogleEventIdForVisit('visit-1'), etag: foreign.etag, forceOverwrite: true })).rejects.toBeInstanceOf(CalendarConflictError)
    expect(mocks.events.get).toHaveBeenCalledWith(expect.objectContaining({ eventId: stableGoogleEventIdForVisit('visit-1') }), expect.anything())
    expect(mocks.events.delete).not.toHaveBeenCalled()
  })

  it('treats a 404 cancellation as an idempotent success', async () => {
    mocks.events.get.mockReset().mockRejectedValueOnce(errorWithStatus(404))
    await expect(adapter().cancel({
      visitId: 'visit-1', externalId: stableGoogleEventIdForVisit('visit-1'), etag: 'etag-1', forceOverwrite: false,
    })).resolves.toBeUndefined()
    expect(mocks.events.delete).not.toHaveBeenCalled()
  })

  it('refuses to instantiate from a disabled integration instead of making any Google call', () => {
    vi.stubEnv('INSTALLATION_CALENDAR_ENABLED', 'false')
    expect(() => createGoogleInstallationCalendarAdapter()).toThrow(CalendarConfigurationError)
    expect(mocks.calendar).not.toHaveBeenCalled()
  })

  it.each([
    ['disabled feature', { INSTALLATION_CALENDAR_ENABLED: 'false', INSTALLATION_CALENDAR_ADAPTER: 'google' }],
    ['wrong adapter', { INSTALLATION_CALENDAR_ENABLED: 'true', INSTALLATION_CALENDAR_ADAPTER: 'fake' }],
    ['invalid credentials', { INSTALLATION_CALENDAR_ENABLED: 'true', INSTALLATION_CALENDAR_ADAPTER: 'google', GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_B64: 'not-json' }],
  ])('cannot bypass the %s guard by supplying a configuration argument', (_label, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    const unsafeFactory = createGoogleInstallationCalendarAdapter as unknown as (configuration: GoogleCalendarConfiguration) => unknown

    expect(() => unsafeFactory(testConfiguration)).toThrow(CalendarConfigurationError)
  })

  it('times out a hanging Google request long before the outbox lease expires', async () => {
    vi.useFakeTimers()
    mocks.events.get.mockReset().mockImplementation(() => new Promise(() => undefined))
    const pending = adapter().upsert({ event: event(), externalId: null, etag: null, forceOverwrite: false })
    const rejection = expect(pending).rejects.toMatchObject({ name: 'CalendarRetryableError', code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS)
    await rejection
    vi.useRealTimers()
  })

  it('keeps environment readiness free of credentials and rejects fake execution in production', () => {
    const credentials = Buffer.from(JSON.stringify({
      type: 'service_account',
      client_email: 'calendar-sync@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nvery-private-key-material\\n-----END PRIVATE KEY-----',
    })).toString('base64')
    const readiness = getInstallationCalendarReadiness({
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'google',
      GOOGLE_CALENDAR_ID: 'test-calendar@group.calendar.google.com',
      GOOGLE_CALENDAR_IMPERSONATED_USER: 'info@walldecor.pl',
      GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_B64: credentials,
    })
    expect(readiness).toEqual({
      enabled: true, adapter: 'google', credentialsConfigured: true,
      calendarConfigured: true, impersonationConfigured: true, ready: true,
    })
    expect(JSON.stringify(readiness)).not.toContain('very-private-key-material')
    expect(JSON.stringify(readiness)).not.toContain('test-calendar@')
    expect(() => assertInstallationCalendarAdapterAllowed({
      NODE_ENV: 'production', INSTALLATION_CALENDAR_ADAPTER: 'fake',
    })).toThrow(CalendarConfigurationError)
  })

  it('does not consider a malformed Calendar id configured', () => {
    const readiness = getInstallationCalendarReadiness({
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'google',
      GOOGLE_CALENDAR_ID: 'not-a-calendar-id',
      GOOGLE_CALENDAR_IMPERSONATED_USER: 'info@walldecor.pl',
    })
    expect(readiness.calendarConfigured).toBe(false)
    expect(readiness.ready).toBe(false)
  })

  it('keeps credential parsing outside the client-safe Calendar config module', () => {
    expect(publicCalendarConfig).not.toHaveProperty('getGoogleCalendarConfiguration')
    expect(publicCalendarConfig).not.toHaveProperty('getInstallationCalendarReadiness')
  })
})
