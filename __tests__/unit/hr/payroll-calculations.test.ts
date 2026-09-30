import { describe, expect, it } from 'vitest'
import { buildCalendarSnapshot, resolveBaseSegments, type CalendarTimeEntry } from '@/lib/payroll/calendar'
import { formatGrosze, parsePlnToGrosze } from '@/lib/payroll/money'
import { isEmployedInPeriod, isFuturePeriod, parsePayrollMonth, periodLastDay } from '@/lib/payroll/period'
import { summarizeSettlement, validatePayrollOfficeFigures, type SummaryInput } from '@/lib/payroll/summary'

// Synthetic amounts only — no real payroll data.
const period = { year: 2026, month: 8 }

function entry(overrides: Partial<CalendarTimeEntry> & { id: string; day: string }): CalendarTimeEntry {
  const { day, ...rest } = overrides
  return {
    date: new Date(`${day}T00:00:00.000Z`),
    status: 'approved',
    clockOut: new Date(`${day}T17:00:00.000Z`),
    totalMinutes: 480,
    breakMinutes: 0,
    overtimeMinutes: 0,
    ...rest,
  }
}

function summaryInput(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    baseSalaryGrosze: 100_00,
    baseBasis: 'MONTHLY_GROSS',
    baseSegmentCount: 1,
    pendingEntryCount: 0,
    openEntryCount: 0,
    calendarInSync: true,
    payrollOfficeConfirmedAt: null,
    lines: [],
    adjustments: [],
    ...overrides,
  }
}

describe('payroll money', () => {
  it('should parse Polish decimal comma into grosze without float drift', () => {
    expect(parsePlnToGrosze('1 234,56')).toBe(123456)
  })

  it('should parse a negative correction', () => {
    expect(parsePlnToGrosze('-0.1')).toBe(-10)
  })

  it('should reject more than two decimal places', () => {
    expect(parsePlnToGrosze('10.001')).toBeNull()
  })

  it('should format grosze as PLN', () => {
    expect(formatGrosze(1234567).replace(/\s/g, ' ')).toBe('12 345,67 zł')
  })
})

describe('payroll period', () => {
  it('should reject malformed month keys', () => {
    expect(parsePayrollMonth('2026-13')).toBeNull()
  })

  it('should compute the last day of February in a leap year', () => {
    expect(periodLastDay({ year: 2028, month: 2 })).toBe('2028-02-29')
  })

  it('should treat next month as future at the year boundary', () => {
    expect(isFuturePeriod({ year: 2027, month: 1 }, new Date('2026-12-31T12:00:00Z'))).toBe(true)
  })

  it('should exclude an employee whose contract ended before the month', () => {
    expect(isEmployedInPeriod({ startDate: new Date('2025-01-01'), endDate: new Date('2026-07-31T10:00:00Z') }, period)).toBe(false)
  })

  it('should include an employee hired on the last day of the month', () => {
    expect(isEmployedInPeriod({ startDate: new Date('2026-08-31T08:00:00Z'), endDate: null }, period)).toBe(true)
  })
})

describe('payroll base segments', () => {
  const rows = [
    { id: 'a', amountGrosze: 100_00, basis: 'MONTHLY_GROSS', effectiveFrom: '2026-01-01', revokedAt: null },
    { id: 'b', amountGrosze: 120_00, basis: 'MONTHLY_GROSS', effectiveFrom: '2026-08-15', revokedAt: null },
    { id: 'c', amountGrosze: 999_00, basis: 'MONTHLY_GROSS', effectiveFrom: '2026-08-10', revokedAt: new Date() },
    { id: 'd', amountGrosze: 150_00, basis: 'MONTHLY_GROSS', effectiveFrom: '2026-09-01', revokedAt: null },
  ]

  it('should use the base in force on day one plus in-month changes, ignoring revoked and future rows', () => {
    expect(resolveBaseSegments(rows, period).map((segment) => [segment.baseSalaryId, segment.from])).toEqual([
      ['a', '2026-08-01'],
      ['b', '2026-08-15'],
    ])
  })

  it('should return no segment when no base is effective yet', () => {
    expect(resolveBaseSegments(rows, { year: 2025, month: 12 })).toEqual([])
  })
})

describe('payroll calendar snapshot', () => {
  const base = [{ id: 'base', amountGrosze: 100_00, basis: 'MONTHLY_GROSS', effectiveFrom: '2026-01-01', revokedAt: null }]

  it('should take overtime from calendar entries of the month only', () => {
    const snapshot = buildCalendarSnapshot({
      period,
      entries: [
        entry({ id: 'jul', day: '2026-07-31', overtimeMinutes: 60 }),
        entry({ id: 'aug', day: '2026-08-03', overtimeMinutes: 90 }),
      ],
      overtimeRequests: [],
      baseSalaries: base,
    })
    expect(snapshot.lines.map((line) => line.timeEntryId)).toEqual(['aug'])
  })

  it('should not treat a pending calendar entry as approved', () => {
    const snapshot = buildCalendarSnapshot({
      period,
      entries: [entry({ id: 'p', day: '2026-08-04', status: 'pending', overtimeMinutes: 60 })],
      overtimeRequests: [],
      baseSalaries: base,
    })
    expect([snapshot.lines[0].entryStatus, snapshot.approvedWorkedMinutes, snapshot.pendingEntryCount]).toEqual(['pending', 0, 1])
  })

  it('should mark Saturday overtime lines', () => {
    const snapshot = buildCalendarSnapshot({
      period,
      entries: [entry({ id: 'sat', day: '2026-08-08', overtimeMinutes: 180, totalMinutes: 180 })],
      overtimeRequests: [],
      baseSalaries: base,
    })
    expect(snapshot.lines[0].isSaturday).toBe(true)
  })

  it('should default resolution from an approved overtime request of the same day', () => {
    const snapshot = buildCalendarSnapshot({
      period,
      entries: [entry({ id: 'e', day: '2026-08-05', overtimeMinutes: 60 })],
      overtimeRequests: [{ date: new Date('2026-08-05T00:00:00Z'), status: 'approved', resolution: 'time_off' }],
      baseSalaries: base,
    })
    expect([snapshot.lines[0].resolution, snapshot.lines[0].resolutionSource]).toEqual(['TIME_OFF', 'OVERTIME_REQUEST'])
  })

  it('should leave resolution empty when approved requests conflict', () => {
    const snapshot = buildCalendarSnapshot({
      period,
      entries: [entry({ id: 'e', day: '2026-08-05', overtimeMinutes: 60 })],
      overtimeRequests: [
        { date: new Date('2026-08-05T00:00:00Z'), status: 'approved', resolution: 'time_off' },
        { date: new Date('2026-08-05T00:00:00Z'), status: 'approved', resolution: 'payment' },
      ],
      baseSalaries: base,
    })
    expect(snapshot.lines[0].resolution).toBeNull()
  })

  it('should keep an administrator decision over the request default', () => {
    const snapshot = buildCalendarSnapshot({
      period,
      entries: [entry({ id: 'e', day: '2026-08-05', overtimeMinutes: 60 })],
      overtimeRequests: [{ date: new Date('2026-08-05T00:00:00Z'), status: 'approved', resolution: 'time_off' }],
      baseSalaries: base,
      existingLines: [{ timeEntryId: 'e', resolution: 'PAYOUT', resolutionSource: 'ADMIN' }],
    })
    expect(snapshot.lines[0].resolution).toBe('PAYOUT')
  })

  it('should change the fingerprint when a calendar entry is approved', () => {
    const input = { period, overtimeRequests: [], baseSalaries: base }
    const before = buildCalendarSnapshot({ ...input, entries: [entry({ id: 'e', day: '2026-08-05', status: 'pending', overtimeMinutes: 30 })] })
    const after = buildCalendarSnapshot({ ...input, entries: [entry({ id: 'e', day: '2026-08-05', overtimeMinutes: 30 })] })
    expect(before.fingerprint).not.toBe(after.fingerprint)
  })

  it('should produce no lines and no worked minutes for an empty month', () => {
    const snapshot = buildCalendarSnapshot({ period, entries: [], overtimeRequests: [], baseSalaries: [] })
    expect([snapshot.lines.length, snapshot.approvedWorkedMinutes, snapshot.baseSalaryGrosze]).toEqual([0, 0, null])
  })
})

describe('payroll settlement summary', () => {
  it('should count only approved PAYOUT overtime as payable', () => {
    const summary = summarizeSettlement(summaryInput({
      lines: [
        { overtimeMinutes: 60, entryStatus: 'approved', resolution: 'PAYOUT' },
        { overtimeMinutes: 30, entryStatus: 'approved', resolution: 'TIME_OFF' },
        { overtimeMinutes: 45, entryStatus: 'rejected', resolution: null },
      ],
    }))
    expect([summary.payoutOvertimeMinutes, summary.timeOffOvertimeMinutes, summary.rejectedOvertimeMinutes]).toEqual([60, 30, 45])
  })

  it('should block approval while calendar overtime awaits approval', () => {
    const summary = summarizeSettlement(summaryInput({ lines: [{ overtimeMinutes: 60, entryStatus: 'pending', resolution: null }] }))
    expect(summary.inputBlockers).toContain('OVERTIME_PENDING_APPROVAL')
  })

  it('should block approval when approved overtime has no payout/time-off decision', () => {
    const summary = summarizeSettlement(summaryInput({ lines: [{ overtimeMinutes: 60, entryStatus: 'approved', resolution: null }] }))
    expect(summary.inputBlockers).toContain('OVERTIME_UNRESOLVED')
  })

  it('should require payroll office confirmation for approval but not for sending inputs', () => {
    const summary = summarizeSettlement(summaryInput())
    expect([summary.inputBlockers, summary.approvalBlockers]).toEqual([[], ['PAYROLL_OFFICE_NOT_CONFIRMED']])
  })

  it('should ignore soft-deleted adjustments and keep negative corrections', () => {
    const summary = summarizeSettlement(summaryInput({
      adjustments: [
        { kind: 'BONUS', amountGrosze: 50_00, deletedAt: null },
        { kind: 'BONUS', amountGrosze: 70_00, deletedAt: new Date() },
        { kind: 'CORRECTION', amountGrosze: -12_34, deletedAt: null },
      ],
    }))
    expect([summary.bonusesGrosze, summary.correctionsGrosze]).toEqual([50_00, -12_34])
  })

  it('should block hourly basis with pending calendar entries', () => {
    const summary = summarizeSettlement(summaryInput({ baseBasis: 'HOURLY_GROSS', pendingEntryCount: 2 }))
    expect(summary.inputBlockers).toContain('HOURLY_ENTRIES_PENDING')
  })

  it('should block when no base salary is effective', () => {
    expect(summarizeSettlement(summaryInput({ baseSalaryGrosze: null })).inputBlockers).toContain('BASE_MISSING')
  })
})

describe('payroll office figures', () => {
  const figures = { employmentType: 'UoP', finalGrossGrosze: 100_00, finalNetGrosze: 70_00, employerCostGrosze: 120_00 }

  it('should accept consistent figures', () => {
    expect(validatePayrollOfficeFigures(figures)).toBeNull()
  })

  it('should reject net above gross', () => {
    expect(validatePayrollOfficeFigures({ ...figures, finalNetGrosze: 100_01 })).toMatch(/Netto/)
  })

  it('should reject employer cost below gross for an employment contract', () => {
    expect(validatePayrollOfficeFigures({ ...figures, employerCostGrosze: 70_00 })).toMatch(/koszt pracodawcy/)
  })

  it('should allow employer cost below gross for B2B', () => {
    expect(validatePayrollOfficeFigures({ ...figures, employmentType: 'B2B', employerCostGrosze: 81_30 })).toBeNull()
  })
})
