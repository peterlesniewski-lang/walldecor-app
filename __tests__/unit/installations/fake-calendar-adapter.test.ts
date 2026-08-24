import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CalendarConfigurationError,
  CalendarConflictError,
  CalendarRetryableError,
} from '@/lib/installations/calendar-adapter'
import type { CalendarEvent } from '@/lib/installations/calendar-event'
import { FakeInstallationCalendarAdapter } from '@/lib/installations/fake-calendar-adapter'

function calendarEvent(visitId = 'visit-1', summary = 'Montaż MON-1 — Jan Kowalski'): CalendarEvent {
  return {
    visitId,
    summary,
    location: 'Puławska 17, 02-515 Warszawa',
    description: 'Adres montażu: Puławska 17, 02-515 Warszawa',
    start: { dateTime: '2026-08-24T08:00:00.000Z', timeZone: 'Europe/Warsaw' },
    end: { dateTime: '2026-08-24T12:00:00.000Z', timeZone: 'Europe/Warsaw' },
    attendeeEmails: ['anna@example.pl'],
    privateProperties: { wallDecorVisitId: visitId },
  }
}

describe('FakeInstallationCalendarAdapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('refuses construction in production before any fake event can be written', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => new FakeInstallationCalendarAdapter()).toThrow(CalendarConfigurationError)
  })

  it('creates, updates, and cancels exactly one stable fake event for a visit', async () => {
    const adapter = new FakeInstallationCalendarAdapter()
    const created = await adapter.upsert({ event: calendarEvent(), externalId: null, etag: null, forceOverwrite: false })
    const updated = await adapter.upsert({
      event: calendarEvent('visit-1', 'Montaż MON-1 — Jan Kowalski (zmiana terminu)'),
      externalId: created.eventId,
      etag: created.etag,
      forceOverwrite: false,
    })

    expect(created.eventId).toMatch(/^wd[0-9a-v]+$/)
    expect(updated).toMatchObject({ eventId: created.eventId, htmlLink: created.htmlLink })
    expect(updated.etag).not.toBe(created.etag)
    expect(adapter.snapshot()).toHaveLength(1)

    await adapter.cancel({ visitId: 'visit-1', externalId: created.eventId, etag: updated.etag, forceOverwrite: false })

    expect(adapter.snapshot()).toMatchObject([{
      eventId: created.eventId,
      cancelled: true,
      event: { summary: 'Montaż MON-1 — Jan Kowalski (zmiana terminu)' },
    }])
  })

  it('rejects a stale etag or foreign external id unless an existing record is force-overwritten', async () => {
    const adapter = new FakeInstallationCalendarAdapter()
    const created = await adapter.upsert({ event: calendarEvent(), externalId: null, etag: null, forceOverwrite: false })

    await expect(adapter.upsert({
      event: calendarEvent(), externalId: created.eventId, etag: 'stale-etag', forceOverwrite: false,
    })).rejects.toMatchObject({ name: 'CalendarConflictError', code: 'ETAG_CONFLICT' })
    await expect(adapter.upsert({
      event: calendarEvent(), externalId: 'wdforeign', etag: created.etag, forceOverwrite: false,
    })).rejects.toMatchObject({ name: 'CalendarConflictError', code: 'ETAG_CONFLICT' })

    const forced = await adapter.upsert({
      event: calendarEvent('visit-1', 'Montaż MON-1 — świadome nadpisanie'),
      externalId: created.eventId,
      etag: 'stale-etag',
      forceOverwrite: true,
    })

    expect(forced.eventId).toBe(created.eventId)
    expect(adapter.snapshot()).toMatchObject([{
      event: { summary: 'Montaż MON-1 — świadome nadpisanie' },
      cancelled: false,
    }])
  })

  it('treats repeated cancellation of an existing event as an idempotent no-op', async () => {
    const adapter = new FakeInstallationCalendarAdapter()
    const created = await adapter.upsert({ event: calendarEvent(), externalId: null, etag: null, forceOverwrite: false })

    await adapter.cancel({ visitId: 'visit-1', externalId: created.eventId, etag: created.etag, forceOverwrite: false })
    const afterFirstCancel = adapter.snapshot()
    await adapter.cancel({ visitId: 'visit-1', externalId: created.eventId, etag: created.etag, forceOverwrite: false })

    expect(adapter.snapshot()).toEqual(afterFirstCancel)
  })

  it.each([false, true])('never lets forceOverwrite cancel another visit event: %s', async (forceOverwrite) => {
    const adapter = new FakeInstallationCalendarAdapter()
    const createdA = await adapter.upsert({ event: calendarEvent('visit-a'), externalId: null, etag: null, forceOverwrite: false })
    const createdB = await adapter.upsert({ event: calendarEvent('visit-b'), externalId: null, etag: null, forceOverwrite: false })

    await expect(adapter.cancel({
      visitId: 'visit-b', externalId: createdA.eventId, etag: createdA.etag, forceOverwrite,
    })).rejects.toBeInstanceOf(CalendarConflictError)

    expect(adapter.snapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: createdA.eventId, cancelled: false }),
      expect.objectContaining({ eventId: createdB.eventId, cancelled: false }),
    ]))

    await adapter.cancel({ visitId: 'visit-b', externalId: createdB.eventId, etag: createdB.etag, forceOverwrite: false })
    expect(adapter.snapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: createdA.eventId, cancelled: false }),
      expect.objectContaining({ eventId: createdB.eventId, cancelled: true }),
    ]))
  })

  it('never calls fetch and returns defensive, deterministic snapshots', async () => {
    const adapter = new FakeInstallationCalendarAdapter()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    try {
      await adapter.upsert({ event: calendarEvent('visit-z'), externalId: null, etag: null, forceOverwrite: false })
      await adapter.upsert({ event: calendarEvent('visit-a'), externalId: null, etag: null, forceOverwrite: false })

      const firstSnapshot = adapter.snapshot()
      const secondSnapshot = adapter.snapshot()
      firstSnapshot[0].event.summary = 'zewnętrzna mutacja'

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(secondSnapshot.map((record) => record.eventId)).toEqual([...secondSnapshot.map((record) => record.eventId)].sort())
      expect(adapter.snapshot()[0].event.summary).not.toBe('zewnętrzna mutacja')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('calendar adapter error contract', () => {
  it('exposes stable, safe error codes', () => {
    expect(new CalendarRetryableError('RATE_LIMIT')).toMatchObject({
      name: 'CalendarRetryableError', code: 'RATE_LIMIT',
    })
    expect(new CalendarConflictError()).toMatchObject({
      name: 'CalendarConflictError', code: 'ETAG_CONFLICT',
    })
    expect(new CalendarConfigurationError()).toMatchObject({
      name: 'CalendarConfigurationError', code: 'CONFIGURATION_ERROR',
    })
  })
})
