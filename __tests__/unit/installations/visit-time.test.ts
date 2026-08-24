import { describe, expect, it } from 'vitest'
import { INSTALLATION_TIMEZONE, formatWarsawDateTime, formatWarsawDateTimeInput, parseWarsawLocalDateTime } from '@/lib/installations/visit-time'
import { InstallationVisitValidationError } from '@/lib/installations/visit-schemas'

describe('installation visit Warsaw time boundary', () => {
  it('stores a summer Warsaw local date-time as UTC', () => {
    expect(parseWarsawLocalDateTime('2026-07-15T08:00').toISOString()).toBe('2026-07-15T06:00:00.000Z')
  })

  it('stores a winter Warsaw local date-time as UTC', () => {
    expect(parseWarsawLocalDateTime('2026-12-15T08:00').toISOString()).toBe('2026-12-15T07:00:00.000Z')
  })

  it('formats an instant for display in Warsaw time', () => {
    expect(formatWarsawDateTime(new Date('2026-12-15T07:00:00.000Z'))).toBe('15.12.2026, 08:00')
  })

  it('formats an instant as a date-time-local input in Warsaw time', () => {
    expect(formatWarsawDateTimeInput('2026-07-15T06:00:00.000Z')).toBe('2026-07-15T08:00')
  })

  it('uses the one timezone chosen for installation visits', () => {
    expect(INSTALLATION_TIMEZONE).toBe('Europe/Warsaw')
  })

  it.each([
    '2026-07-15 08:00',
    '2026-07-15T8:00',
    '2026-07-15T08:00:00',
    '2026-02-30T08:00',
    'not-a-date',
  ])('rejects a malformed local date-time: %s', (value) => {
    expectTimeValidationField(() => parseWarsawLocalDateTime(value), 'form')
  })

  it('rejects a nonexistent Warsaw wall time during the DST spring transition', () => {
    expect(() => parseWarsawLocalDateTime('2026-03-29T02:30')).toThrow(InstallationVisitValidationError)
  })

  it('rejects an ambiguous Warsaw wall time during the DST autumn transition', () => {
    expectTimeValidationField(() => parseWarsawLocalDateTime('2026-10-25T02:30', 'endsAt'), 'endsAt')
  })

  it('attributes invalid local input to the field supplied by the caller', () => {
    expectTimeValidationField(() => parseWarsawLocalDateTime('not-a-date', 'startsAt'), 'startsAt')
  })

  it('attributes invalid formatter input to the form', () => {
    expectTimeValidationField(() => formatWarsawDateTime(new Date('invalid')), 'form')
    expectTimeValidationField(() => formatWarsawDateTimeInput('not-a-date'), 'form')
  })
})

function expectTimeValidationField(run: () => unknown, field: 'startsAt' | 'endsAt' | 'form') {
  expect(run).toThrow(InstallationVisitValidationError)
  try {
    run()
  } catch (error) {
    expect(error).toMatchObject({
      fieldErrors: { [field]: 'Podaj poprawny termin wizyty w czasie Warszawy.' },
    })
  }
}
