import { describe, expect, it } from 'vitest'
import {
  entitlementAsOfDate,
  getWarsawBusinessDateQueryRange,
  getWarsawBusinessDate,
  maxEffectiveDateForYear,
  toWarsawBusinessDateUtcMidnight,
} from '@/lib/hr/business-date'

describe('Warsaw HR business date', () => {
  it('crosses into the next business year at Warsaw midnight', () => {
    expect(getWarsawBusinessDate(new Date('2026-12-31T22:30:00.000Z')))
      .toEqual(expect.objectContaining({ year: 2026, isoDate: '2026-12-31' }))
    expect(getWarsawBusinessDate(new Date('2026-12-31T23:30:00.000Z')))
      .toEqual(expect.objectContaining({ year: 2027, isoDate: '2027-01-01' }))
  })

  it('uses today for the current year and year end for a historical year', () => {
    const now = new Date('2026-07-30T12:00:00.000Z')

    expect(entitlementAsOfDate(2026, now).toISOString())
      .toBe('2026-07-30T23:59:59.999Z')
    expect(maxEffectiveDateForYear(2026, now)).toBe('2026-07-30')
    expect(entitlementAsOfDate(2025, now).toISOString())
      .toBe('2025-12-31T23:59:59.999Z')
    expect(maxEffectiveDateForYear(2025, now)).toBe('2025-12-31')
  })

  it.each(['UTC', 'Europe/Warsaw'])(
    'normalizes a fixed instant through Warsaw policy when reader TZ is %s',
    (timezone) => {
      const originalTimezone = process.env.TZ
      process.env.TZ = timezone

      try {
        const legacyWarsawMidnight = new Date('2026-07-01T22:00:00.000Z')

        expect(getWarsawBusinessDate(legacyWarsawMidnight).isoDate).toBe('2026-07-02')
        expect(toWarsawBusinessDateUtcMidnight(legacyWarsawMidnight).toISOString())
          .toBe('2026-07-02T00:00:00.000Z')
        expect(getWarsawBusinessDateQueryRange(legacyWarsawMidnight)).toEqual({
          gte: new Date('2026-07-01T00:00:00.000Z'),
          lte: new Date('2026-07-03T23:59:59.999Z'),
        })
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ
        else process.env.TZ = originalTimezone
      }
    }
  )
})
