// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  changeNoticeMonths,
  dueCarryoverMonth,
  isChangeNoticeDue,
  lastMonthAfterEnabling,
  nextCarryoverRun,
  warsawClock,
} from '@/lib/payroll/auto-carryover-scheduler'
import { carryoverApprovalNote, carryoverNotification, pluralPl, type PayrollAutoCarryoverSummary } from '@/lib/payroll/auto-carryover'
import { isPayrollSchedulerEnabledByEnv } from '@/lib/payroll/automation-env'
import {
  evaluateChangeAfterApproval,
  payInputsSignature,
  type ApprovedVersionInputs,
  type LivePayInputs,
} from '@/lib/payroll/pay-inputs'

// Pure rules of the payroll automat (stage 2). All data synthetic.

const on = (lastMonth: string | null) => ({ enabled: true, lastMonth })
const utc = (iso: string) => new Date(iso)

describe('automat due run (Europe/Warsaw)', () => {
  it('should be due on the 1st at 06:00 Warsaw time', () => {
    // 1 December 2026 05:00 UTC = 06:00 CET
    expect(dueCarryoverMonth(utc('2026-12-01T05:00:00Z'), on('2026-11'))).toBe('2026-12')
  })

  it('should not be due on the 1st before 06:00 Warsaw time', () => {
    expect(dueCarryoverMonth(utc('2026-12-01T04:59:00Z'), on('2026-11'))).toBeNull()
  })

  it('should not be due just after midnight UTC on the 1st, which is still before 06:00 in Warsaw', () => {
    expect(dueCarryoverMonth(utc('2026-11-30T23:30:00Z'), on('2026-11'))).toBeNull()
  })

  it('should catch up at the first check after downtime, e.g. on the 5th at 03:00', () => {
    expect(dueCarryoverMonth(utc('2026-12-05T02:00:00Z'), on('2026-11'))).toBe('2026-12')
  })

  it('should not be due again in a month that has already run', () => {
    expect(dueCarryoverMonth(utc('2026-12-20T10:00:00Z'), on('2026-12'))).toBeNull()
  })

  it('should not be due when the automat is off', () => {
    expect(dueCarryoverMonth(utc('2026-12-01T09:00:00Z'), { enabled: false, lastMonth: '2026-11' })).toBeNull()
  })

  it('should not be due when no month is recorded (never run the current month unasked)', () => {
    expect(dueCarryoverMonth(utc('2026-12-01T09:00:00Z'), on(null))).toBeNull()
  })

  it('should not run the current month when switched on mid-month (D10)', () => {
    const now = utc('2026-11-24T12:00:00Z')
    expect(dueCarryoverMonth(now, on(lastMonthAfterEnabling(now, '2026-09')))).toBeNull()
  })

  it('should schedule the first run for the 1st of the next month when switched on mid-month', () => {
    const now = utc('2026-11-24T12:00:00Z')
    expect(nextCarryoverRun(now, on(lastMonthAfterEnabling(now, null)))).toEqual({ month: '2026-12', date: '2026-12-01' })
  })

  it('should cross the year boundary: December → January', () => {
    expect([
      dueCarryoverMonth(utc('2027-01-01T05:00:00Z'), on('2026-12')),
      nextCarryoverRun(utc('2026-12-15T12:00:00Z'), on('2026-12')),
    ]).toEqual(['2027-01', { month: '2027-01', date: '2027-01-01' }])
  })

  it('should report no next run when the automat is off', () => {
    expect(nextCarryoverRun(utc('2026-11-24T12:00:00Z'), { enabled: false, lastMonth: '2026-11' })).toBeNull()
  })

  it('should use Warsaw summer time (UTC+2) in July', () => {
    expect(warsawClock(utc('2026-06-30T22:30:00Z'))).toEqual({ date: '2026-07-01', month: '2026-07', day: 1, hour: 0 })
  })
})

describe('daily change notice', () => {
  it('should be due once a day from 07:00 Warsaw time', () => {
    const settings = { enabled: true, lastDay: '2026-11-10' }
    expect([
      isChangeNoticeDue(utc('2026-11-11T05:59:00Z'), settings),
      isChangeNoticeDue(utc('2026-11-11T06:00:00Z'), settings),
      isChangeNoticeDue(utc('2026-11-10T15:00:00Z'), settings),
      isChangeNoticeDue(utc('2026-11-11T06:00:00Z'), { enabled: false, lastDay: null }),
    ]).toEqual([false, true, false, false])
  })

  it('should look at the previous month too, so a change from its last day is still noticed on the 1st', () => {
    expect(changeNoticeMonths(utc('2026-12-01T06:00:00Z'))).toEqual(['2026-11', '2026-12'])
  })

  it('should take December of the previous year as the previous month in January', () => {
    expect(changeNoticeMonths(utc('2027-01-15T10:00:00Z'))).toEqual(['2026-12', '2027-01'])
  })
})

describe('environment switch', () => {
  it('should run in production unless PAYROLL_AUTO_CARRYOVER=off and elsewhere only with =on', () => {
    expect([
      isPayrollSchedulerEnabledByEnv({ NODE_ENV: 'production' }),
      isPayrollSchedulerEnabledByEnv({ NODE_ENV: 'production', PAYROLL_AUTO_CARRYOVER: 'off' }),
      isPayrollSchedulerEnabledByEnv({ NODE_ENV: 'development' }),
      isPayrollSchedulerEnabledByEnv({ NODE_ENV: 'development', PAYROLL_AUTO_CARRYOVER: 'on' }),
    ]).toEqual([true, false, false, true])
  })
})

describe('run notification text', () => {
  const summary = (approved: number, attention: number): PayrollAutoCarryoverSummary => ({
    month: '2026-12',
    approved: Array.from({ length: approved }, (_, i) => ({ employeeId: `a${i}`, name: `Osoba${i} Testowa`, settlementId: `s${i}`, versionNumber: 1 })),
    attention: Array.from({ length: attention }, (_, i) => ({ employeeId: `b${i}`, name: `Uwaga${i} Testowa`, reasons: ['angaż zmienił się od listopada'] })),
    alreadySettled: [],
    errors: [],
  })

  it('should read "3 zatwierdzone automatycznie, 2 wymagają uwagi" with a link to the month sheet', () => {
    const text = carryoverNotification(summary(3, 2))
    expect([text.title, text.link]).toEqual(['Wynagrodzenia za grudzień: 3 zatwierdzone automatycznie, 2 wymagają uwagi', '/hr/payroll?month=2026-12'])
  })

  it('should inflect five and one correctly', () => {
    expect(carryoverNotification(summary(5, 1)).title).toBe('Wynagrodzenia za grudzień: 5 zatwierdzonych automatycznie, 1 wymaga uwagi')
  })

  it('should inflect 12–14 as "many"', () => {
    expect([pluralPl(12, 'a', 'b', 'c'), pluralPl(22, 'a', 'b', 'c'), pluralPl(0, 'a', 'b', 'c')]).toEqual(['c', 'b', 'c'])
  })

  it('should name the source month in the version note', () => {
    expect(carryoverApprovalNote('2026-11')).toBe('Automatyczne przeniesienie z 2026-11')
  })
})

// ─── Change after approval: only pay-relevant inputs ─────────────────────────

const employment = { from: '2026-11-01', to: '2026-11-30' }
const version = (extra: Record<string, unknown> = {}, basis = 'MONTHLY_GROSS', minutes = 0): ApprovedVersionInputs => ({
  baseBasis: basis,
  approvedWorkedMinutes: minutes,
  snapshotJson: JSON.stringify({
    overtimeLines: [],
    baseSegments: [{ baseSalaryId: 'b1', from: '2026-11-01', amountGrosze: 500000, basis }],
    calendarFingerprint: 'fingerprint-at-approval',
    inputs: { employment, payAffectingAbsenceIds: [] },
    ...extra,
  }),
})
const live = (patch: Partial<LivePayInputs> = {}, basis = 'MONTHLY_GROSS'): LivePayInputs => ({
  overtimeLines: [],
  baseSegments: [{ from: '2026-11-01', amountGrosze: 500000, basis: basis as 'MONTHLY_GROSS' }],
  approvedWorkedMinutes: 0,
  employment,
  absenceIds: [],
  ...patch,
})
const codes = (v: ApprovedVersionInputs, l: LivePayInputs) => evaluateChangeAfterApproval({ version: v, live: l, acknowledgement: null })?.changes ?? []

describe('change after approval — signature of pay-relevant inputs', () => {
  it('should ignore ordinary worked minutes of a salaried person (a normal clock-in)', () => {
    expect(evaluateChangeAfterApproval({ version: version(), live: live({ approvedWorkedMinutes: 480 }), acknowledgement: null })).toBeNull()
  })

  it('should report overtime added after approval', () => {
    expect(codes(version(), live({ overtimeLines: [{ timeEntryId: 't1', overtimeMinutes: 60, entryStatus: 'pending' }] }))).toEqual(['OVERTIME'])
  })

  it('should report an overtime entry whose status changed', () => {
    const at = version({ overtimeLines: [{ timeEntryId: 't1', overtimeMinutes: 60, entryStatus: 'pending' }] })
    expect(codes(at, live({ overtimeLines: [{ timeEntryId: 't1', overtimeMinutes: 60, entryStatus: 'approved' }] }))).toEqual(['OVERTIME'])
  })

  it('should report a base salary change', () => {
    expect(codes(version(), live({ baseSegments: [
      { from: '2026-11-01', amountGrosze: 500000, basis: 'MONTHLY_GROSS' },
      { from: '2026-11-15', amountGrosze: 550000, basis: 'MONTHLY_GROSS' },
    ] }))).toEqual(['BASE'])
  })

  it('should report an end of employment within the month', () => {
    expect(codes(version(), live({ employment: { from: '2026-11-01', to: '2026-11-20' } }))).toEqual(['EMPLOYMENT'])
  })

  it('should report a pay-affecting absence', () => {
    expect(codes(version(), live({ absenceIds: ['leave-1'] }))).toEqual(['ABSENCE'])
  })

  it('should compare approved minutes for an hourly basis', () => {
    expect(codes(version({}, 'HOURLY_GROSS', 600), live({ approvedWorkedMinutes: 660 }, 'HOURLY_GROSS'))).toEqual(['HOURS'])
  })

  it('should compare only overtime and base for a version approved before stage 1 (no inputs)', () => {
    const legacy = version({ inputs: undefined })
    expect([
      codes(legacy, live({ absenceIds: ['leave-1'], employment: { from: '2026-11-01', to: '2026-11-10' } })),
      codes(legacy, live({ overtimeLines: [{ timeEntryId: 't1', overtimeMinutes: 30, entryStatus: 'approved' }] })),
    ]).toEqual([[], ['OVERTIME']])
  })

  it('should give the same signature for the same inputs in a different order', () => {
    const a = evaluateChangeAfterApproval({ version: version(), live: live({ absenceIds: ['x', 'y'] }), acknowledgement: null })
    const b = evaluateChangeAfterApproval({ version: version(), live: live({ absenceIds: ['y', 'x'] }), acknowledgement: null })
    expect(a?.signature).toBe(b?.signature)
  })

  it('should hide the label once exactly this state is acknowledged, and show only the next change afterwards', () => {
    const sick = live({ absenceIds: ['leave-1'] })
    const first = evaluateChangeAfterApproval({ version: version(), live: sick, acknowledgement: null })
    const acknowledgement = { signature: first?.signature ?? '', state: first?.state ?? null }
    const hidden = evaluateChangeAfterApproval({ version: version(), live: sick, acknowledgement })
    const next = evaluateChangeAfterApproval({
      version: version(),
      live: live({ absenceIds: ['leave-1'], overtimeLines: [{ timeEntryId: 't9', overtimeMinutes: 120, entryStatus: 'approved' }] }),
      acknowledgement,
    })
    expect([hidden, next?.changes]).toEqual([null, ['OVERTIME']])
  })

  it('should produce a 64-character hex signature', () => {
    const state = { overtime: [], base: [], employment: null, absenceIds: null, workedMinutes: null }
    expect(payInputsSignature(state)).toMatch(/^[0-9a-f]{64}$/)
  })
})
