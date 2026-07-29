import { describe, expect, it } from 'vitest'
import {
  annualDaysForMode,
  calculateConfiguredEntitlement,
  selectEffectiveEntitlement,
  type LeaveEntitlementInput,
} from '@/lib/hr/leave-entitlement'

const localDate = (year: number, month: number, day: number): Date =>
  new Date(year, month - 1, day, 12, 0, 0, 0)

const entitlement = (
  overrides: Partial<LeaveEntitlementInput> = {}
): LeaveEntitlementInput => ({
  mode: 'DAYS_20',
  customAnnualDays: null,
  employmentFraction: 1,
  employmentStartDate: localDate(2020, 1, 1),
  year: 2026,
  ...overrides,
})

describe('annualDaysForMode', () => {
  it.each([
    ['DAYS_20', null, 20],
    ['DAYS_26', null, 26],
    ['CUSTOM', 30, 30],
  ] as const)('returns annual days for %s', (mode, customAnnualDays, expected) => {
    expect(annualDaysForMode(mode, customAnnualDays)).toBe(expected)
  })

  it.each([null, 0, 366, 12.5])(
    'rejects invalid custom annual days: %s',
    (customAnnualDays) => {
      expect(() => annualDaysForMode('CUSTOM', customAnnualDays)).toThrow(
        'Custom annual leave days must be an integer from 1 to 365'
      )
    }
  )
})

describe('calculateConfiguredEntitlement', () => {
  it.each([
    ['DAYS_20', null, 20],
    ['DAYS_26', null, 26],
    ['CUSTOM', 30, 30],
  ] as const)(
    'calculates full-time entitlement for %s',
    (mode, customAnnualDays, expected) => {
      expect(calculateConfiguredEntitlement(entitlement({ mode, customAnnualDays }))).toBe(
        expected
      )
    }
  )

  it('calculates half of 20 days as 10', () => {
    expect(
      calculateConfiguredEntitlement(entitlement({ employmentFraction: 0.5 }))
    ).toBe(10)
  })

  it('rounds 0.75 of 26 days up to 20', () => {
    expect(
      calculateConfiguredEntitlement(
        entitlement({ mode: 'DAYS_26', employmentFraction: 0.75 })
      )
    ).toBe(20)
  })

  it('does not round a floating-point representation error up to another day', () => {
    expect(
      calculateConfiguredEntitlement(
        entitlement({
          mode: 'CUSTOM',
          customAnnualDays: 25,
          employmentFraction: 0.28,
        })
      )
    ).toBe(7)
  })

  it('applies the existing partial-year month rule after fraction rounding', () => {
    expect(
      calculateConfiguredEntitlement(
        entitlement({
          mode: 'DAYS_26',
          employmentFraction: 0.5,
          employmentStartDate: localDate(2026, 7, 1),
        })
      )
    ).toBe(7)
  })

  it('treats a UTC-midnight employment date as its canonical UTC month', () => {
    expect(
      calculateConfiguredEntitlement(
        entitlement({
          mode: 'DAYS_26',
          employmentStartDate: new Date('2026-07-01T00:00:00.000Z'),
        })
      )
    ).toBe(13)
  })

  it('returns zero when employment starts after the target year', () => {
    expect(
      calculateConfiguredEntitlement(
        entitlement({ employmentStartDate: localDate(2027, 1, 1) })
      )
    ).toBe(0)
  })

  it.each([0, -0.5, 1.01])('rejects invalid employment fraction: %s', (fraction) => {
    expect(() =>
      calculateConfiguredEntitlement(entitlement({ employmentFraction: fraction }))
    ).toThrow('Employment fraction must be greater than 0 and at most 1')
  })

  it('rejects an invalid employment start date', () => {
    expect(() =>
      calculateConfiguredEntitlement(
        entitlement({ employmentStartDate: new Date(Number.NaN) })
      )
    ).toThrow('Employment start date must be a valid Date')
  })

  it.each([2026.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid target year: %s',
    (year) => {
      expect(() => calculateConfiguredEntitlement(entitlement({ year }))).toThrow(
        'Year must be a finite integer'
      )
    }
  )
})

describe('selectEffectiveEntitlement', () => {
  const oldConfig = {
    id: 'old',
    effectiveFrom: new Date('2025-01-01T00:00:00+01:00'),
  }
  const newConfig = {
    id: 'new',
    effectiveFrom: new Date('2026-01-01T00:00:00+01:00'),
  }
  const futureConfig = {
    id: 'future',
    effectiveFrom: new Date('2027-01-01T00:00:00+01:00'),
  }

  it.each([
    [new Date('2025-06-01T00:00:00Z'), oldConfig],
    [new Date('2026-06-01T00:00:00Z'), newConfig],
    [new Date('2028-01-01T00:00:00Z'), futureConfig],
  ])('selects the latest config effective by %s', (targetDate, expected) => {
    expect(
      selectEffectiveEntitlement([futureConfig, oldConfig, newConfig], targetDate)
    ).toBe(expected)
  })

  it('returns null when all configs are in the future', () => {
    expect(
      selectEffectiveEntitlement(
        [newConfig, futureConfig],
        new Date('2024-12-31T00:00:00Z')
      )
    ).toBeNull()
  })

  it('does not mutate input order', () => {
    const configs = [futureConfig, oldConfig, newConfig]
    const originalOrder = [...configs]

    selectEffectiveEntitlement(configs, new Date('2026-06-01T00:00:00Z'))

    expect(configs).toEqual(originalOrder)
  })

  it('rejects an invalid target date', () => {
    expect(() =>
      selectEffectiveEntitlement([oldConfig], new Date(Number.NaN))
    ).toThrow('Target date must be a valid Date')
  })

  it('rejects a config with an invalid effective date', () => {
    expect(() =>
      selectEffectiveEntitlement(
        [{ id: 'invalid', effectiveFrom: new Date(Number.NaN) }],
        new Date('2026-01-01T00:00:00Z')
      )
    ).toThrow('Entitlement effectiveFrom must be a valid Date')
  })
})
