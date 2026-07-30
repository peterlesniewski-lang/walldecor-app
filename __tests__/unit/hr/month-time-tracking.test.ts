import { describe, expect, it } from 'vitest'
import {
  buildMonthDateKeys,
  currentMonthParam,
  dateKeyToLocalNoon,
  formatDateKey,
  getAdjacentMonth,
  parseMonthParam,
} from '@/lib/hr/time-tracking/month'

describe('monthly time helpers', () => {
  it.each([
    ['2025-02', 28],
    ['2024-02', 29],
    ['2026-04', 30],
    ['2026-07', 31],
  ])('builds every day for %s', (month, expectedDays) => {
    expect(buildMonthDateKeys(month)).toHaveLength(expectedDays)
  })

  it('builds canonical keys from the first through the last day', () => {
    const keys = buildMonthDateKeys('2026-07')

    expect(keys[0]).toBe('2026-07-01')
    expect(keys.at(-1)).toBe('2026-07-31')
  })

  it('parses canonical month parameters', () => {
    expect(parseMonthParam('2026-07')).toEqual({ year: 2026, month: 7 })
  })

  it('rejects impossible or non-canonical months', () => {
    expect(parseMonthParam('2026-00')).toBeNull()
    expect(parseMonthParam('2026-13')).toBeNull()
    expect(parseMonthParam('2026-7')).toBeNull()
    expect(parseMonthParam('26-07')).toBeNull()
  })

  it('formats the current month from local calendar fields', () => {
    const localDate = new Date(2026, 6, 31, 23, 30)

    expect(currentMonthParam(localDate)).toBe('2026-07')
  })

  it('crosses year boundaries', () => {
    expect(getAdjacentMonth('2026-12', 1)).toBe('2027-01')
    expect(getAdjacentMonth('2026-01', -1)).toBe('2025-12')
  })

  it('supports navigation by more than one month', () => {
    expect(getAdjacentMonth('2026-11', 3)).toBe('2027-02')
  })

  it('creates local noon without shifting the calendar date', () => {
    const date = dateKeyToLocalNoon('2026-03-29')

    expect([
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
    ]).toEqual([2026, 3, 29, 12])
  })

  it('formats a Date from local calendar fields', () => {
    const localDate = new Date(2026, 0, 5, 0, 30)

    expect(formatDateKey(localDate)).toBe('2026-01-05')
  })
})
