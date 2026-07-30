import { describe, it, expect } from 'vitest'
import {
  calculateWorkingDays,
  calculateWorkingHours,
  isWeekend,
  isPublicHoliday,
  formatDuration,
  calculateOvertimeMinutes,
} from '@/lib/hr/utils'
import { getPolishHolidays } from '@/lib/hr/constants'

// Helper: creates a Date at noon UTC to avoid timezone-related ISO string shifts
const utcDate = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))

describe('getPolishHolidays', () => {
  it('returns exactly 13 dates for 2025', () => {
    const holidays = getPolishHolidays(2025)
    expect(holidays).toHaveLength(13)
  })

  it('contains Easter Sunday 2025 (2025-04-20)', () => {
    const holidays = getPolishHolidays(2025)
    expect(holidays).toContain('2025-04-20')
  })

  it('contains Boże Ciało 2025 (2025-06-19 = Easter + 60)', () => {
    const holidays = getPolishHolidays(2025)
    expect(holidays).toContain('2025-06-19')
  })

  it('contains fixed holidays', () => {
    const holidays = getPolishHolidays(2025)
    expect(holidays).toContain('2025-01-01')
    expect(holidays).toContain('2025-01-06')
    expect(holidays).toContain('2025-05-01')
    expect(holidays).toContain('2025-05-03')
    expect(holidays).toContain('2025-08-15')
    expect(holidays).toContain('2025-11-01')
    expect(holidays).toContain('2025-11-11')
    expect(holidays).toContain('2025-12-25')
    expect(holidays).toContain('2025-12-26')
  })

  it.each([
    [2024, false],
    [2025, true],
    [2026, true],
  ])('treats Christmas Eve in %i according to its effective date', (year, expected) => {
    const dateKey = `${year}-12-24`

    expect(getPolishHolidays(year).includes(dateKey)).toBe(expected)
    expect(isPublicHoliday(new Date(year, 11, 24, 12))).toBe(expected)
  })
})

describe('calculateWorkingDays', () => {
  it('counts a UTC-midnight four-day VLD range consistently', () => {
    const start = new Date('2026-07-27T00:00:00.000Z')
    const end = new Date('2026-07-30T00:00:00.000Z')

    expect(calculateWorkingDays(start, end)).toBe(4)
  })

  it('skips a UTC-midnight weekend without shifting calendar dates', () => {
    const start = new Date('2026-07-31T00:00:00.000Z')
    const end = new Date('2026-08-03T00:00:00.000Z')

    expect(calculateWorkingDays(start, end)).toBe(2)
  })

  it('matches Polish holidays using UTC YYYY-MM-DD', () => {
    const independenceDay = new Date('2026-11-11T00:00:00.000Z')

    expect(calculateWorkingDays(independenceDay, independenceDay)).toBe(0)
  })

  it('matches extra holidays using the canonical UTC date', () => {
    const day = new Date('2026-07-29T00:00:00.000Z')

    expect(calculateWorkingDays(day, day, ['2026-07-29'])).toBe(0)
  })

  it('skips weekends in a full week Mon–Fri = 5 days', () => {
    // 2025-04-14 (Monday) to 2025-04-18 (Friday) — no holidays that week
    const start = utcDate(2025, 4, 14)
    const end = utcDate(2025, 4, 18)
    expect(calculateWorkingDays(start, end)).toBe(5)
  })

  it('skips Saturday and Sunday when range spans a weekend', () => {
    // 2025-04-14 (Mon) to 2025-04-22 (Tue)
    // Weekdays: Mon 14, Tue 15, Wed 16, Thu 17, Fri 18, Mon 21 — but 21 is Easter Monday (holiday)
    // So: 5 days (Sat 19 = weekend, Sun 20 = Easter holiday, Mon 21 = Easter Monday holiday)
    const start = utcDate(2025, 4, 14)
    const end = utcDate(2025, 4, 22)
    // Mon 14, Tue 15, Wed 16, Thu 17, Fri 18 = 5 working
    // Sat 19 = weekend skip
    // Sun 20 = Easter (holiday) skip
    // Mon 21 = Easter Monday (holiday) skip
    // Tue 22 = 1 working
    expect(calculateWorkingDays(start, end)).toBe(6)
  })

  it('skips Easter Sunday (2025-04-20) as a holiday', () => {
    // Single day — Easter Sunday
    const easter = utcDate(2025, 4, 20)
    expect(calculateWorkingDays(easter, easter)).toBe(0)
  })

  it('counts single working day correctly', () => {
    // 2025-04-15 (Tuesday, no holiday)
    const d = utcDate(2025, 4, 15)
    expect(calculateWorkingDays(d, d)).toBe(1)
  })

  it('respects extraHolidays parameter', () => {
    // 2025-04-15 (Tuesday) — mark it as extra holiday
    const d = utcDate(2025, 4, 15)
    expect(calculateWorkingDays(d, d, ['2025-04-15'])).toBe(0)
  })

  it('counts full month of April 2025 correctly', () => {
    // April 2025: 30 days
    // Weekends: 5+6=5 Saturdays (5,12,19,26) and 4 Sundays skipped by weekend check (6,13,20,27)
    // Holidays in April: Easter Sun 20 (weekend anyway), Easter Mon 21
    // Working days: all weekdays minus Easter Mon 21
    // Weekdays in April 2025: 22 total (30 - 8 weekend days)
    // Minus Easter Mon 21 = 21 working days
    const start = utcDate(2025, 4, 1)
    const end = utcDate(2025, 4, 30)
    expect(calculateWorkingDays(start, end)).toBe(21)
  })
})

describe('calculateWorkingHours', () => {
  it('calculates correct totalMinutes', () => {
    const clockIn = new Date('2025-04-15T08:00:00Z')
    const clockOut = new Date('2025-04-15T16:30:00Z')
    const result = calculateWorkingHours(clockIn, clockOut, [])
    expect(result.totalMinutes).toBe(510) // 8.5h
  })

  it('calculates net minutes with a 30-minute break', () => {
    const clockIn = new Date('2025-04-15T08:00:00Z')
    const clockOut = new Date('2025-04-15T16:30:00Z')
    const breaks = [
      {
        startTime: new Date('2025-04-15T12:00:00Z'),
        endTime: new Date('2025-04-15T12:30:00Z'),
      },
    ]
    const result = calculateWorkingHours(clockIn, clockOut, breaks)
    expect(result.totalMinutes).toBe(510)
    expect(result.breakMinutes).toBe(30)
    expect(result.netMinutes).toBe(480)
  })

  it('calculates net minutes without any breaks', () => {
    const clockIn = new Date('2025-04-15T09:00:00Z')
    const clockOut = new Date('2025-04-15T17:00:00Z')
    const result = calculateWorkingHours(clockIn, clockOut, [])
    expect(result.totalMinutes).toBe(480)
    expect(result.breakMinutes).toBe(0)
    expect(result.netMinutes).toBe(480)
  })

  it('ignores breaks without endTime', () => {
    const clockIn = new Date('2025-04-15T08:00:00Z')
    const clockOut = new Date('2025-04-15T16:00:00Z')
    const breaks = [
      {
        startTime: new Date('2025-04-15T12:00:00Z'),
        endTime: null,
      },
    ]
    const result = calculateWorkingHours(clockIn, clockOut, breaks)
    expect(result.breakMinutes).toBe(0)
    expect(result.netMinutes).toBe(480)
  })
})

describe('isWeekend', () => {
  it('returns true for Saturday', () => {
    // 2025-04-19 is Saturday
    expect(isWeekend(new Date('2025-04-19T12:00:00Z'))).toBe(true)
  })

  it('returns true for Sunday', () => {
    // 2025-04-20 is Sunday
    expect(isWeekend(new Date('2025-04-20T12:00:00Z'))).toBe(true)
  })

  it('returns false for Monday', () => {
    // 2025-04-21 is Monday
    expect(isWeekend(new Date('2025-04-21T12:00:00Z'))).toBe(false)
  })

  it('returns false for Wednesday', () => {
    // 2025-04-16 is Wednesday
    expect(isWeekend(new Date('2025-04-16T12:00:00Z'))).toBe(false)
  })
})

describe('formatDuration', () => {
  it('formats 0 minutes as "0m"', () => {
    expect(formatDuration(0)).toBe('0m')
  })

  it('formats negative minutes as "0m"', () => {
    expect(formatDuration(-10)).toBe('0m')
  })

  it('formats 45 minutes as "45m"', () => {
    expect(formatDuration(45)).toBe('45m')
  })

  it('formats 60 minutes as "1h"', () => {
    expect(formatDuration(60)).toBe('1h')
  })

  it('formats 90 minutes as "1h 30m"', () => {
    expect(formatDuration(90)).toBe('1h 30m')
  })

  it('formats 480 minutes as "8h"', () => {
    expect(formatDuration(480)).toBe('8h')
  })
})

describe('calculateOvertimeMinutes', () => {
  it('returns 0 when net equals daily threshold (480min, 8h)', () => {
    expect(calculateOvertimeMinutes(480, 8)).toBe(0)
  })

  it('returns 60 when 540min with 8h threshold', () => {
    expect(calculateOvertimeMinutes(540, 8)).toBe(60)
  })

  it('returns 0 when 420min with 8h threshold (under threshold)', () => {
    expect(calculateOvertimeMinutes(420, 8)).toBe(0)
  })

  it('returns 0 for 0 minutes', () => {
    expect(calculateOvertimeMinutes(0, 8)).toBe(0)
  })
})
