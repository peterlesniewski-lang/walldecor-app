import { describe, expect, it } from 'vitest'
import { buildCalendarSnapshot, type CalendarTimeEntry } from '@/lib/payroll/calendar'
import { evaluateCarryover, type CarryoverInput, type CarryoverSourceVersion } from '@/lib/payroll/carryover'
import { calculateEmployerCostGrosze, DEFAULT_EMPLOYER_RATES } from '@/lib/payroll/employer-cost'
import { hourlyGrossGrosze, netFromLastApproved } from '@/lib/payroll/hourly'
import {
  duePayReminderMonth,
  isPolishWorkingDay,
  lastWorkingDayOfMonth,
  payReminderDate,
  payReminderNotification,
} from '@/lib/payroll/pay-reminder'
import { summarizeSettlement, type SummaryInput } from '@/lib/payroll/summary'

// Stage 3 — hourly basis (D15–D19) and the pay reminder (D18). Synthetic amounts only.

const RATES = DEFAULT_EMPLOYER_RATES.UZ
const OCTOBER = { year: 2026, month: 10 }
const HOURLY = { baseSalaryId: 'base-h', from: '2026-10-01', amountGrosze: 5000, basis: 'HOURLY_GROSS' as const }

function source(overrides: Partial<CarryoverSourceVersion> = {}): CarryoverSourceVersion {
  return {
    year: 2026, month: 9, versionNumber: 1, baseSalaryGrosze: 5000, baseBasis: 'HOURLY_GROSS',
    bonusesGrosze: 0, correctionsGrosze: 0, payoutOvertimeMinutes: 0,
    finalGrossGrosze: 400000, finalNetGrosze: 320000,
    employerCostGrosze: calculateEmployerCostGrosze(400000, RATES), employerCostSource: 'CALCULATED',
    ...overrides,
  }
}

function hourlyInput(overrides: Partial<CarryoverInput> = {}): CarryoverInput {
  return {
    period: OCTOBER,
    employee: { startDate: new Date('2025-01-01T00:00:00Z'), endDate: null, employmentType: 'UZ' },
    baseSegments: [HOURLY],
    source: source(),
    costContext: { rates: RATES },
    blockers: [],
    payAffectingAbsenceIds: [],
    previousPayAffectingAbsenceIds: [],
    approvedWorkedMinutes: 38 * 60,
    lastApproved: { year: 2026, month: 9, finalGrossGrosze: 400000, finalNetGrosze: 320000 },
    ...overrides,
  }
}

describe('hourly gross = approved minutes × rate / 60', () => {
  it('should pay 38 h at 50,00 zł as exactly 1900,00 zł', () => {
    expect(hourlyGrossGrosze(38 * 60, 5000)).toBe(190000)
  })

  it('should round a half grosz up (1 min × 27,30 zł/h = 45,5 gr → 46 gr)', () => {
    expect(hourlyGrossGrosze(1, 2730)).toBe(46)
  })

  it('should round below a half grosz down (1 min × 27,29 zł/h = 45,48 gr → 45 gr)', () => {
    expect(hourlyGrossGrosze(1, 2729)).toBe(45)
  })

  it('should calculate 7 h 30 min at 33,33 zł/h as 249,98 zł (249,975 rounded half up)', () => {
    expect(hourlyGrossGrosze(450, 3333)).toBe(24998)
  })

  it('should give zero for zero minutes', () => {
    expect(hourlyGrossGrosze(0, 5000)).toBe(0)
  })

  it('should stay exact for a product beyond 2^53', () => {
    expect(hourlyGrossGrosze(44_640, 300_000_000_000)).toBe(223_200_000_000_000)
  })

  it('should refuse a fractional number of minutes', () => {
    expect(() => hourlyGrossGrosze(1.5, 5000)).toThrow()
  })
})

describe('net from the last approved proportion (D17)', () => {
  it('should be null without an earlier approved version', () => {
    expect(netFromLastApproved(190000, null)).toBeNull()
  })

  it('should equal gross when the last net equalled gross', () => {
    expect(netFromLastApproved(123457, { year: 2026, month: 9, finalGrossGrosze: 400001, finalNetGrosze: 400001 })).toBe(123457)
  })

  it('should follow the proportion 0,8', () => {
    expect(netFromLastApproved(190000, { year: 2026, month: 9, finalGrossGrosze: 400000, finalNetGrosze: 320000 })).toBe(152000)
  })

  it('should round the proportional net half up', () => {
    // 100 × 1/3 = 33,33… → 33; 101 × 1/2 = 50,5 → 51
    expect([
      netFromLastApproved(100, { year: 2026, month: 9, finalGrossGrosze: 3, finalNetGrosze: 1 }),
      netFromLastApproved(101, { year: 2026, month: 9, finalGrossGrosze: 2, finalNetGrosze: 1 }),
    ]).toEqual([33, 51])
  })

  it('should be null when the last gross was zero', () => {
    expect(netFromLastApproved(1000, { year: 2026, month: 9, finalGrossGrosze: 0, finalNetGrosze: 0 })).toBeNull()
  })
})

describe('hourly suggestion on the sheet', () => {
  it('should suggest hours × rate, the proportional net and a cost calculated from current rates', () => {
    const { suggestion, hourly } = evaluateCarryover(hourlyInput())
    expect({ suggestion, hourly }).toEqual({
      suggestion: {
        kind: 'HOURS',
        finalGrossGrosze: 190000,
        finalNetGrosze: 152000,
        employerCostGrosze: calculateEmployerCostGrosze(190000, RATES),
        employerCostSource: 'CALCULATED',
        sourceMonth: '2026-09',
      },
      hourly: { rateGrosze: 5000, approvedMinutes: 2280, grossGrosze: 190000 },
    })
  })

  it('should never mark an hourly row as ready, even without other flags', () => {
    const result = evaluateCarryover(hourlyInput())
    expect([result.flags, result.autoEligible]).toEqual([['HOURLY_BASIS'], false])
  })

  it('should take the net proportion from an older month and drop NO_PREVIOUS_MONTH', () => {
    const result = evaluateCarryover(hourlyInput({
      source: null,
      lastApproved: { year: 2026, month: 7, finalGrossGrosze: 300000, finalNetGrosze: 300000 },
    }))
    expect([result.suggestion?.finalNetGrosze, result.suggestion?.sourceMonth, result.flags]).toEqual([190000, '2026-07', ['HOURLY_BASIS']])
  })

  it('should leave net empty and keep NO_PREVIOUS_MONTH for a person never approved before', () => {
    const result = evaluateCarryover(hourlyInput({ source: null, lastApproved: null }))
    expect([result.suggestion?.finalGrossGrosze, result.suggestion?.finalNetGrosze, result.flags])
      .toEqual([190000, null, ['NO_PREVIOUS_MONTH', 'HOURLY_BASIS']])
  })

  it('should copy a manually entered source cost (stage 1 rule)', () => {
    const result = evaluateCarryover(hourlyInput({ source: source({ employerCostGrosze: 410000, employerCostSource: 'OVERRIDDEN' }) }))
    expect([result.suggestion?.employerCostGrosze, result.suggestion?.employerCostSource]).toEqual([410000, 'OVERRIDDEN'])
  })

  it('should leave the cost empty with no rates and no source month', () => {
    const result = evaluateCarryover(hourlyInput({ source: null, costContext: { rates: null } }))
    expect([result.suggestion?.employerCostGrosze, result.suggestion?.employerCostSource]).toEqual([null, 'OVERRIDDEN'])
  })

  it('should suggest last month and warn "brak godzin" with zero approved minutes (D19)', () => {
    const result = evaluateCarryover(hourlyInput({ approvedWorkedMinutes: 0 }))
    expect([result.suggestion?.kind, result.suggestion?.finalGrossGrosze, result.suggestion?.finalNetGrosze, result.hourly, result.flags])
      .toEqual(['PREVIOUS_MONTH', 400000, 320000, null, ['HOURLY_BASIS', 'HOURLY_NO_HOURS']])
  })

  it('should have no suggestion at all with zero minutes and no previous month', () => {
    const result = evaluateCarryover(hourlyInput({ approvedWorkedMinutes: 0, source: null, lastApproved: null }))
    expect([result.suggestion, result.flags]).toEqual([null, ['NO_PREVIOUS_MONTH', 'HOURLY_BASIS', 'HOURLY_NO_HOURS']])
  })

  it('should not calculate with two base segments in the month and flag BASE_CHANGED', () => {
    const result = evaluateCarryover(hourlyInput({
      baseSegments: [HOURLY, { ...HOURLY, baseSalaryId: 'base-h2', from: '2026-10-15', amountGrosze: 5500 }],
    }))
    expect([result.suggestion, result.hourly, result.flags]).toEqual([null, null, ['BASE_CHANGED', 'HOURLY_BASIS']])
  })

  it('should leave a monthly salary untouched by approved hours', () => {
    const result = evaluateCarryover(hourlyInput({
      baseSegments: [{ ...HOURLY, amountGrosze: 400000, basis: 'MONTHLY_GROSS' }],
      source: source({ baseSalaryGrosze: 400000, baseBasis: 'MONTHLY_GROSS' }),
    }))
    expect([result.suggestion?.kind, result.suggestion?.finalGrossGrosze, result.hourly, result.autoEligible])
      .toEqual(['PREVIOUS_MONTH', 400000, null, true])
  })
})

function summaryInput(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    baseSalaryGrosze: 5000, baseBasis: 'HOURLY_GROSS', baseSegmentCount: 1, pendingEntryCount: 0, openEntryCount: 0,
    calendarInSync: true, payrollOfficeConfirmedAt: new Date('2026-10-30T10:00:00Z'), lines: [], adjustments: [],
    ...overrides,
  }
}

const SATURDAY_LINE = { overtimeMinutes: 240, entryStatus: 'approved', resolution: null }

describe('blockers: hourly versus monthly (D15)', () => {
  it('should not block an hourly person on approved overtime without a payout/time-off decision', () => {
    expect(summarizeSettlement(summaryInput({ lines: [SATURDAY_LINE] })).approvalBlockers).toEqual([])
  })

  it('should not block an hourly person on overtime of a pending entry other than as a pending entry', () => {
    const summary = summarizeSettlement(summaryInput({ lines: [{ ...SATURDAY_LINE, entryStatus: 'pending' }], pendingEntryCount: 1 }))
    expect(summary.approvalBlockers).toEqual(['HOURLY_ENTRIES_PENDING'])
  })

  it('should block an hourly person on an entry without a clock-out', () => {
    expect(summarizeSettlement(summaryInput({ openEntryCount: 1, pendingEntryCount: 1 })).approvalBlockers)
      .toEqual(['HOURLY_ENTRIES_PENDING', 'OPEN_TIME_ENTRY'])
  })

  it('should put zero overtime minutes to pay out or take off into an hourly version', () => {
    const summary = summarizeSettlement(summaryInput({ lines: [{ ...SATURDAY_LINE, resolution: 'PAYOUT' }, { ...SATURDAY_LINE, resolution: 'TIME_OFF' }] }))
    expect([summary.payoutOvertimeMinutes, summary.timeOffOvertimeMinutes, summary.unresolvedOvertimeMinutes]).toEqual([0, 0, 0])
  })

  it('should still require an overtime decision for a monthly salary (no regression)', () => {
    expect(summarizeSettlement(summaryInput({ baseBasis: 'MONTHLY_GROSS', lines: [SATURDAY_LINE] })).approvalBlockers)
      .toEqual(['OVERTIME_UNRESOLVED'])
  })

  it('should still block a monthly salary on overtime waiting for approval (no regression)', () => {
    expect(summarizeSettlement(summaryInput({ baseBasis: 'MONTHLY_GROSS', lines: [{ ...SATURDAY_LINE, entryStatus: 'pending' }], pendingEntryCount: 1 })).approvalBlockers)
      .toEqual(['OVERTIME_PENDING_APPROVAL'])
  })
})

function entry(id: string, date: string, overrides: Partial<CalendarTimeEntry> = {}): CalendarTimeEntry {
  return {
    id, date: new Date(`${date}T00:00:00Z`), status: 'approved', clockOut: new Date(`${date}T15:00:00Z`),
    totalMinutes: 480, breakMinutes: 0, overtimeMinutes: 0, ...overrides,
  }
}

describe('hours from the calendar', () => {
  const snapshot = buildCalendarSnapshot({
    period: OCTOBER,
    entries: [
      entry('mon', '2026-10-05'),
      // Saturday: the calendar counts the whole shift as overtime (automatic Saturday overtime).
      entry('sat', '2026-10-10', { totalMinutes: 240, overtimeMinutes: 240 }),
      entry('wait', '2026-10-12', { status: 'pending', totalMinutes: 390, breakMinutes: 30 }),
      entry('open', '2026-10-13', { status: 'pending', clockOut: null, totalMinutes: null }),
    ],
    overtimeRequests: [],
    baseSalaries: [{ id: 'base-h', amountGrosze: 5000, basis: 'HOURLY_GROSS', effectiveFrom: '2025-01-01', revokedAt: null }],
  })

  it('should count a Saturday shift (automatic overtime) in the approved hours paid at the rate', () => {
    expect([snapshot.approvedWorkedMinutes, snapshot.lines.map((line) => [line.timeEntryId, line.isSaturday])])
      .toEqual([720, [['sat', true]]])
  })

  it('should count waiting minutes only for entries with a clock-out', () => {
    expect([snapshot.pendingWorkedMinutes, snapshot.pendingEntryCount, snapshot.approvablePendingEntryCount, snapshot.openEntryCount])
      .toEqual([360, 2, 1, 1])
  })

  it('should not let the Saturday overtime block the hourly settlement', () => {
    const summary = summarizeSettlement(summaryInput({ lines: snapshot.lines.filter((line) => line.entryStatus === 'approved') }))
    expect(summary.approvalBlockers).toEqual([])
  })
})

describe('pay reminder day (D18)', () => {
  it.each([
    ['November 2026 (ends on a Monday)', { year: 2026, month: 11 }, '2026-11-30', '2026-11-26'],
    ['February 2026 (ends on a Saturday)', { year: 2026, month: 2 }, '2026-02-27', '2026-02-25'],
    ['May 2026 (ends on a Sunday)', { year: 2026, month: 5 }, '2026-05-29', '2026-05-27'],
    ['March 2027 (Easter Monday 29.03 is skipped)', { year: 2027, month: 3 }, '2027-03-31', '2027-03-26'],
    ['December 2026', { year: 2026, month: 12 }, '2026-12-31', '2026-12-29'],
    ['December 2028 (ends on a Sunday)', { year: 2028, month: 12 }, '2028-12-29', '2028-12-27'],
  ])('should place the reminder for %s', (_label, period, lastWorkingDay, reminder) => {
    expect([lastWorkingDayOfMonth(period), payReminderDate(period)]).toEqual([lastWorkingDay, reminder])
  })

  it('should treat public holidays and weekends as non-working days', () => {
    expect(['2026-11-11', '2026-12-24', '2027-03-29', '2026-11-28', '2026-11-27'].map(isPolishWorkingDay))
      .toEqual([false, false, false, false, true])
  })
})

describe('pay reminder due rule', () => {
  const clock = (date: string, hour: number) => ({ date, month: date.slice(0, 7), hour })

  it('should not be due before the reminder day', () => {
    expect(duePayReminderMonth(clock('2026-11-25', 12), '2026-10')).toBeNull()
  })

  it('should not be due on the reminder day before 07:00', () => {
    expect(duePayReminderMonth(clock('2026-11-26', 6), '2026-10')).toBeNull()
  })

  it('should be due on the reminder day from 07:00', () => {
    expect(duePayReminderMonth(clock('2026-11-26', 7), '2026-10')).toBe('2026-11')
  })

  it('should catch up on a later day of the month after downtime', () => {
    expect(duePayReminderMonth(clock('2026-11-30', 3), null)).toBe('2026-11')
  })

  it('should not repeat a month already reminded', () => {
    expect(duePayReminderMonth(clock('2026-11-27', 9), '2026-11')).toBeNull()
  })

  it('should never remind about a month that has ended', () => {
    // 1 December: November was missed entirely; December's own day is still ahead.
    expect(duePayReminderMonth(clock('2026-12-01', 9), '2026-10')).toBeNull()
  })

  it('should cross the year boundary', () => {
    expect(duePayReminderMonth(clock('2026-12-29', 8), '2026-11')).toBe('2026-12')
  })
})

describe('pay reminder text', () => {
  it.each([
    [1, 'Wynagrodzenia za listopad: 1 osoba bez zatwierdzonego rozliczenia, wypłata do 30.11'],
    [3, 'Wynagrodzenia za listopad: 3 osoby bez zatwierdzonego rozliczenia, wypłata do 30.11'],
    [5, 'Wynagrodzenia za listopad: 5 osób bez zatwierdzonego rozliczenia, wypłata do 30.11'],
  ])('should say how many people are left (%i)', (count, title) => {
    const people = Array.from({ length: count }, (_, i) => ({ name: `Testowa ${i}`, hourly: i === 0 }))
    expect(payReminderNotification({ month: '2026-11', people, lastWorkingDay: '2026-11-30' }).title).toBe(title)
  })

  it('should list the people, mark hourly ones and link to the month sheet', () => {
    const notice = payReminderNotification({
      month: '2026-11',
      people: [{ name: 'Godzinowa Testowa', hourly: true }, { name: 'Stała Testowa', hourly: false }],
      lastWorkingDay: '2026-11-30',
    })
    expect([notice.message, notice.link]).toEqual([
      'Do zatwierdzenia: Godzinowa Testowa (stawka godzinowa); Stała Testowa.',
      '/hr/payroll?month=2026-11',
    ])
  })
})
