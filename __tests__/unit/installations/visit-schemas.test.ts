import { describe, expect, it } from 'vitest'
import {
  InstallationVisitValidationError,
  parseCreateInstallationVisit,
  parseInstallationVisitAction,
} from '@/lib/installations/visit-schemas'
import {
  INTEGRATION_OUTBOX_OPERATIONS,
  INTEGRATION_OUTBOX_STATUSES,
  INTEGRATION_SYNC_STATUSES,
  INSTALLATION_VISIT_STATUSES,
} from '@/lib/installations/visit-constants'

const startsAt = new Date('2026-07-15T06:00:00.000Z')
const endsAt = new Date('2026-07-15T08:00:00.000Z')
const futureEndsAt = new Date('2026-08-15T08:00:00.000Z')

describe('installation visit literals', () => {
  it('exports stable visit and integration states', () => {
    expect(INSTALLATION_VISIT_STATUSES).toEqual(['DRAFT', 'CONFIRMED', 'CANCELLED', 'COMPLETED'])
    expect(INTEGRATION_SYNC_STATUSES).toEqual(['NOT_REQUESTED', 'PENDING', 'SYNCED', 'ATTENTION'])
    expect(INTEGRATION_OUTBOX_STATUSES).toEqual(['PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'DEAD'])
    expect(INTEGRATION_OUTBOX_OPERATIONS).toEqual(['CALENDAR_UPSERT', 'CALENDAR_CANCEL'])
  })
})

describe('create installation visit validation', () => {
  it('normalizes a draft without a date and deduplicates trimmed scope IDs', () => {
    expect(parseCreateInstallationVisit({
      startsAt: '',
      endsAt: null,
      note: '   ',
      scopeIds: [' wallpaper ', 'wallpaper', 'moulding'],
    })).toEqual({ scopeIds: ['wallpaper', 'moulding'] })
  })

  it('accepts a complete time range', () => {
    expect(parseCreateInstallationVisit({ startsAt, endsAt, note: '  Pierwsza wizyta  ', scopeIds: ['scope-a'] })).toEqual({
      startsAt,
      endsAt,
      note: 'Pierwsza wizyta',
      scopeIds: ['scope-a'],
    })
  })

  it('accepts RFC3339 instants and converts them to Date objects', () => {
    expect(parseCreateInstallationVisit({
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      scopeIds: ['scope-a'],
    })).toEqual({ startsAt, endsAt, scopeIds: ['scope-a'] })
  })

  it('accepts an RFC3339 offset and converts it to the matching UTC Date', () => {
    expect(parseCreateInstallationVisit({
      startsAt: '2026-07-15T08:00:00+02:00',
      endsAt: endsAt.toISOString(),
      scopeIds: ['scope-a'],
    })).toEqual({ startsAt, endsAt, scopeIds: ['scope-a'] })
  })

  it('rejects a visit with only one endpoint of its time range', () => {
    expectValidationError(() => parseCreateInstallationVisit({ startsAt, scopeIds: [] }), 'endsAt')
  })

  it('rejects a visit whose end is not after its start', () => {
    expectValidationError(() => parseCreateInstallationVisit({ startsAt, endsAt: startsAt, scopeIds: [] }), 'endsAt')
  })

  it('rejects invalid date inputs without coercing null to epoch', () => {
    expectValidationError(() => parseCreateInstallationVisit({ startsAt: 'not-a-date', endsAt, scopeIds: [] }), 'startsAt')
    expectValidationError(() => parseCreateInstallationVisit({ startsAt: 0, endsAt, scopeIds: [] }), 'startsAt')
    expect(parseCreateInstallationVisit({ startsAt: null, endsAt: '', scopeIds: [] })).toEqual({ scopeIds: [] })
  })

  it.each([
    '2026-02-30T06:00:00.000Z',
    '2026-07-15T08:00',
    '15.07.2026 08:00',
    '1752568800000',
  ])('rejects a non-RFC3339 visit time: %s', (startsAt) => {
    expectValidationError(() => parseCreateInstallationVisit({ startsAt, endsAt: futureEndsAt, scopeIds: [] }), 'startsAt')
  })

  it('rejects notes longer than 4,000 characters', () => {
    expectValidationError(() => parseCreateInstallationVisit({ note: 'n'.repeat(4_001), scopeIds: [] }), 'note')
  })

  it('rejects scope identifiers longer than 191 characters', () => {
    expectValidationError(() => parseCreateInstallationVisit({ scopeIds: ['s'.repeat(192)] }), 'scopeIds.0')
  })

  it('rejects unknown keys', () => {
    expectValidationError(() => parseCreateInstallationVisit({ scopeIds: [], unexpected: true }), 'form')
  })
})

describe('installation visit action validation', () => {
  it('normalizes a save-draft payload and permits no scheduled time or scopes', () => {
    expect(parseInstallationVisitAction({
      action: 'SAVE_DRAFT',
      expectedRevision: 2,
      startsAt: '',
      endsAt: null,
      note: '   ',
      scopeIds: [' scope-a ', 'scope-a'],
    })).toEqual({
      action: 'SAVE_DRAFT',
      expectedRevision: 2,
      note: null,
      scopeIds: ['scope-a'],
    })
  })

  it('requires a complete future time range and scopes to confirm', () => {
    expect(parseInstallationVisitAction({
      action: 'CONFIRM',
      expectedRevision: 3,
      startsAt,
      endsAt,
      note: ' Termin uzgodniony ',
      scopeIds: [' scope-a ', 'scope-a'],
    })).toEqual({
      action: 'CONFIRM',
      expectedRevision: 3,
      startsAt,
      endsAt,
      note: 'Termin uzgodniony',
      scopeIds: ['scope-a'],
    })
  })

  it('rejects an overlong note when saving a draft', () => {
    expectValidationError(() => parseInstallationVisitAction({
      action: 'SAVE_DRAFT', expectedRevision: 1, note: 'n'.repeat(4_001), scopeIds: [],
    }), 'note')
  })

  it('rejects an empty scope list when confirming', () => {
    expectValidationError(() => parseInstallationVisitAction({
      action: 'CONFIRM', expectedRevision: 1, startsAt, endsAt, scopeIds: [],
    }), 'scopeIds')
  })

  it.each([0, -1, 1.5])('rejects an invalid expected revision: %s', (expectedRevision) => {
    expectValidationError(() => parseInstallationVisitAction({ action: 'CANCEL', expectedRevision }), 'expectedRevision')
  })

  it('rejects an unknown action and extra action fields', () => {
    expectValidationError(() => parseInstallationVisitAction({ action: 'ARCHIVE', expectedRevision: 1 }), 'action')
    expectValidationError(() => parseInstallationVisitAction({ action: 'CANCEL', expectedRevision: 1, extra: true }), 'form')
  })

  it('accepts cancel and complete actions with just the expected revision', () => {
    expect(parseInstallationVisitAction({ action: 'CANCEL', expectedRevision: 1 })).toEqual({ action: 'CANCEL', expectedRevision: 1 })
    expect(parseInstallationVisitAction({ action: 'COMPLETE', expectedRevision: 1 })).toEqual({ action: 'COMPLETE', expectedRevision: 1 })
  })
})

function expectValidationError(run: () => unknown, field: string) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(InstallationVisitValidationError)
    expect(error).toMatchObject({ fieldErrors: expect.objectContaining({ [field]: expect.any(String) }) })
    return
  }
  throw new Error(`Expected an InstallationVisitValidationError for ${field}.`)
}
