import { createHash } from 'node:crypto'
import {
  CalendarConfigurationError,
  CalendarConflictError,
  type CalendarCancelInput,
  type CalendarUpsertInput,
  type CalendarWriteResult,
  type InstallationCalendarAdapter,
} from './calendar-adapter'
import type { CalendarEvent } from './calendar-event'

export type FakeCalendarEventSnapshot = {
  eventId: string
  htmlLink: string
  etag: string
  version: number
  cancelled: boolean
  event: CalendarEvent
}

function eventIdForVisit(visitId: string): string {
  return `wd${createHash('sha256').update(visitId).digest('hex')}`
}

function htmlLinkForEvent(eventId: string): string {
  return `https://calendar.example.test/events/${eventId}`
}

function etagForVersion(version: number): string {
  return `fake-${version}`
}

function cloneEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    start: { ...event.start },
    end: { ...event.end },
    attendeeEmails: [...event.attendeeEmails],
    privateProperties: { ...event.privateProperties },
  }
}

function cloneSnapshot(record: FakeCalendarEventSnapshot): FakeCalendarEventSnapshot {
  return { ...record, event: cloneEvent(record.event) }
}

/** A network-free deterministic adapter for unit, integration, and end-to-end tests. */
export class FakeInstallationCalendarAdapter implements InstallationCalendarAdapter {
  private readonly events = new Map<string, FakeCalendarEventSnapshot>()

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new CalendarConfigurationError('Fake calendar adapter is forbidden in production.')
    }
  }

  async upsert(input: CalendarUpsertInput): Promise<CalendarWriteResult> {
    const expectedEventId = eventIdForVisit(input.event.visitId)

    if (input.externalId !== null && input.externalId !== expectedEventId) {
      throw new CalendarConflictError('Calendar event id does not belong to this WallDecor visit.')
    }

    const existing = this.events.get(expectedEventId)
    if (!existing) {
      if (input.externalId !== null || input.etag !== null) {
        throw new CalendarConflictError('Calendar event does not exist for the supplied external state.')
      }

      const created: FakeCalendarEventSnapshot = {
        eventId: expectedEventId,
        htmlLink: htmlLinkForEvent(expectedEventId),
        etag: etagForVersion(1),
        version: 1,
        cancelled: false,
        event: cloneEvent(input.event),
      }
      this.events.set(expectedEventId, created)
      return { eventId: created.eventId, htmlLink: created.htmlLink, etag: created.etag }
    }

    const etagMismatched = input.etag !== null
      ? input.etag !== existing.etag
      : input.externalId !== null
    if (etagMismatched && !input.forceOverwrite) {
      throw new CalendarConflictError()
    }

    existing.version += 1
    existing.etag = etagForVersion(existing.version)
    existing.cancelled = false
    existing.event = cloneEvent(input.event)

    return { eventId: existing.eventId, htmlLink: existing.htmlLink, etag: existing.etag }
  }

  async cancel(input: CalendarCancelInput): Promise<void> {
    const expectedEventId = eventIdForVisit(input.visitId)
    const eventId = input.externalId ?? expectedEventId
    const existing = this.events.get(eventId)
    if (!existing) return
    if (
      existing.event.visitId !== input.visitId
      || existing.event.privateProperties.wallDecorVisitId !== input.visitId
    ) {
      throw new CalendarConflictError('Calendar event does not belong to this WallDecor visit.')
    }

    // An outbox retry after a successful cancellation keeps its stale etag and is
    // intentionally harmless: the observable cancellation state is already true.
    if (existing.cancelled) return

    if (!input.forceOverwrite) {
      if (input.etag !== null && input.etag !== existing.etag) throw new CalendarConflictError()
      if (input.etag === null && input.externalId !== null) throw new CalendarConflictError('Calendar event has no local ETag.')
    }

    existing.version += 1
    existing.etag = etagForVersion(existing.version)
    existing.cancelled = true
  }

  snapshot(): FakeCalendarEventSnapshot[] {
    return [...this.events.values()]
      .sort((left, right) => (left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0))
      .map(cloneSnapshot)
  }
}
