import { getWarsawBusinessDate } from '@/lib/hr/business-date'
import type { BaseSegment } from './calendar'
import type { EmployerCostContext } from './cost-context'
import { calculateEmployerCostGrosze } from './employer-cost'
import { hourlyGrossGrosze, netFromLastApproved, type ApprovedFigures } from './hourly'
import { monthGenitive } from './month-names'
import {
  payrollMonthKey,
  periodFirstDay,
  periodLastDay,
  previousPayrollPeriod,
  type PayrollPeriod,
} from './period'
import type { PayrollBlocker } from './summary'

// Suggestion ("podpowiedź") for one person and month on the month sheet. Pure: computed on every
// read from the immediately previous month's effective version and never written to the database.
// A settlement exists only once it is approved (see settleEmployeeMonth in service.ts).

/**
 * Leave codes that change the payroll-list amount although the catalog marks them as paid
 * (sickness and benefits are paid by ZUS or at a reduced rate, not as regular salary).
 */
export const PAY_AFFECTING_LEAVE_CODES = ['SL', 'ML', 'PL', 'FIL'] as const

export function isPayAffectingLeave(leaveType: { isPaid: boolean; code: string }): boolean {
  return !leaveType.isPaid || (PAY_AFFECTING_LEAVE_CODES as readonly string[]).includes(leaveType.code)
}

export const CARRYOVER_FLAGS = [
  'NO_PREVIOUS_MONTH',
  'PARTIAL_MONTH',
  'BASE_CHANGED',
  'PREVIOUS_HAD_ADJUSTMENTS',
  'PREVIOUS_MONTH_PARTIAL',
  'PREVIOUS_HAD_ABSENCE',
  'PAY_AFFECTING_ABSENCE',
  'HOURLY_BASIS',
  'HOURLY_NO_HOURS',
  'EMPLOYMENT_TYPE_MISSING',
] as const
export type CarryoverFlag = typeof CARRYOVER_FLAGS[number]

/** The effective approved version of the source month, as stored in PayrollSettlementVersion. */
export type CarryoverSourceVersion = {
  year: number
  month: number
  versionNumber: number
  baseSalaryGrosze: number
  baseBasis: string
  bonusesGrosze: number
  correctionsGrosze: number
  payoutOvertimeMinutes: number
  finalGrossGrosze: number
  finalNetGrosze: number
  employerCostGrosze: number
  /** ENTERED (legacy) | CALCULATED | OVERRIDDEN */
  employerCostSource: string
}

/** Amounts copied from the immediately previous month (stage 1). */
export type PreviousMonthSuggestion = {
  kind: 'PREVIOUS_MONTH'
  finalGrossGrosze: number
  finalNetGrosze: number
  employerCostGrosze: number
  /** CALCULATED: recalculated from current rates; OVERRIDDEN: copied as a manually entered amount. */
  employerCostSource: 'CALCULATED' | 'OVERRIDDEN'
  /** "YYYY-MM" of the version the amounts come from. */
  sourceMonth: string
}

/** Hourly basis (D15, D17): gross = approved hours × rate; net from the last approved proportion. */
export type HoursSuggestion = {
  kind: 'HOURS'
  finalGrossGrosze: number
  /** null when the person has no earlier approved version to take the proportion from. */
  finalNetGrosze: number | null
  /** null when there are no rates and no source month to copy a manual cost from: the ADMIN types it. */
  employerCostGrosze: number | null
  employerCostSource: 'CALCULATED' | 'OVERRIDDEN'
  /** "YYYY-MM" of the version the net proportion comes from, or null. */
  sourceMonth: string | null
}

export type CarryoverSuggestion = PreviousMonthSuggestion | HoursSuggestion

/** "38 h × 50,00 zł" — what the hourly gross is made of. */
export type HourlyCalculation = {
  rateGrosze: number
  approvedMinutes: number
  grossGrosze: number
}

export type EmploymentInPeriod = {
  /** Employment start clamped to the month, "YYYY-MM-DD". */
  from: string
  /** Employment end clamped to the month, "YYYY-MM-DD". */
  to: string
}

export type CarryoverInput = {
  period: PayrollPeriod
  employee: { startDate: Date; endDate: Date | null; employmentType: string | null }
  /** Base salary segments in force in the month (`resolveBaseSegments`). */
  baseSegments: BaseSegment[]
  /** Effective version of the immediately previous month, or null. */
  source: CarryoverSourceVersion | null
  costContext: Pick<EmployerCostContext, 'rates'>
  /** Blockers derived from the live calendar snapshot (see `sheetBlockers`). */
  blockers: PayrollBlocker[]
  /** Approved leave requests in the month that change the amount (`isPayAffectingLeave`). */
  payAffectingAbsenceIds: string[]
  /**
   * The same for the source (previous) month. A source month with such an absence, or one the person
   * did not work in full, holds an untypical amount that must not be carried over unseen.
   */
  previousPayAffectingAbsenceIds: string[]
  /** Approved worked minutes of the month (`approvedWorkedMinutes`); used for an hourly basis only. */
  approvedWorkedMinutes?: number
  /** The person's latest approved version of ANY earlier month (net proportion for an hourly basis). */
  lastApproved?: ApprovedFigures | null
}

export type CarryoverEvaluation = {
  suggestion: CarryoverSuggestion | null
  /** Hourly basis with one segment and approved hours: what the gross is made of; otherwise null. */
  hourly: HourlyCalculation | null
  flags: CarryoverFlag[]
  autoEligible: boolean
  employment: EmploymentInPeriod
  /** Employment clamped to the source (previous) month. */
  previousEmployment: EmploymentInPeriod
}

/** Employment dates of a person clamped to the month (Europe/Warsaw business dates). */
export function employmentInPeriod(
  employee: { startDate: Date; endDate: Date | null },
  period: PayrollPeriod
): EmploymentInPeriod {
  const first = periodFirstDay(period)
  const last = periodLastDay(period)
  const start = getWarsawBusinessDate(employee.startDate).isoDate
  const end = employee.endDate ? getWarsawBusinessDate(employee.endDate).isoDate : null
  return {
    from: start > first ? start : first,
    to: end !== null && end < last ? end : last,
  }
}

function suggestionFrom(source: CarryoverSourceVersion, costContext: CarryoverInput['costContext']): PreviousMonthSuggestion {
  const recalculate = source.employerCostSource === 'CALCULATED' && costContext.rates !== null
  return {
    kind: 'PREVIOUS_MONTH',
    finalGrossGrosze: source.finalGrossGrosze,
    finalNetGrosze: source.finalNetGrosze,
    employerCostGrosze: recalculate
      ? calculateEmployerCostGrosze(source.finalGrossGrosze, costContext.rates as NonNullable<typeof costContext.rates>)
      : source.employerCostGrosze,
    employerCostSource: recalculate ? 'CALCULATED' : 'OVERRIDDEN',
    sourceMonth: payrollMonthKey(source),
  }
}

/**
 * Employer cost of an hours-based gross, by the stage 1 rule: calculated from current rates unless the
 * source month's cost was entered by hand (then copied as a manual amount); with no rates and no
 * source there is nothing to suggest.
 */
function hourlyCost(
  grossGrosze: number,
  source: CarryoverSourceVersion | null,
  costContext: CarryoverInput['costContext']
): Pick<HoursSuggestion, 'employerCostGrosze' | 'employerCostSource'> {
  const rates = costContext.rates
  if (rates !== null && (source === null || source.employerCostSource === 'CALCULATED')) {
    return { employerCostGrosze: calculateEmployerCostGrosze(grossGrosze, rates), employerCostSource: 'CALCULATED' }
  }
  return { employerCostGrosze: source ? source.employerCostGrosze : null, employerCostSource: 'OVERRIDDEN' }
}

export function evaluateCarryover(input: CarryoverInput): CarryoverEvaluation {
  const expected = previousPayrollPeriod(input.period)
  // Only the immediately previous month is a valid source; anything older is treated as missing.
  const source = input.source && input.source.year === expected.year && input.source.month === expected.month
    ? input.source
    : null
  const employment = employmentInPeriod(input.employee, input.period)
  const previousEmployment = employmentInPeriod(input.employee, expected)
  const flags: CarryoverFlag[] = []

  if (!source) flags.push('NO_PREVIOUS_MONTH')
  if (employment.from > periodFirstDay(input.period) || employment.to < periodLastDay(input.period)) {
    flags.push('PARTIAL_MONTH')
  }

  const segments = input.baseSegments
  const current = segments.at(-1) ?? null
  const baseChanged = segments.length > 1
    || (source !== null && current !== null
      && (current.amountGrosze !== source.baseSalaryGrosze || current.basis !== source.baseBasis))
  if (baseChanged) flags.push('BASE_CHANGED')

  if (source && (source.bonusesGrosze !== 0 || source.correctionsGrosze !== 0 || source.payoutOvertimeMinutes > 0)) {
    flags.push('PREVIOUS_HAD_ADJUSTMENTS')
  }
  // The source amount is only worth copying if the source month was an ordinary, full month.
  if (source && (previousEmployment.from > periodFirstDay(expected) || previousEmployment.to < periodLastDay(expected))) {
    flags.push('PREVIOUS_MONTH_PARTIAL')
  }
  if (source && input.previousPayAffectingAbsenceIds.length > 0) flags.push('PREVIOUS_HAD_ABSENCE')
  if (input.payAffectingAbsenceIds.length > 0) flags.push('PAY_AFFECTING_ABSENCE')
  const hourlyBasis = segments.some((segment) => segment.basis === 'HOURLY_GROSS')
  if (hourlyBasis) flags.push('HOURLY_BASIS')

  let suggestion: CarryoverSuggestion | null = source ? suggestionFrom(source, input.costContext) : null
  let hourly: HourlyCalculation | null = null
  if (hourlyBasis) {
    const minutes = input.approvedWorkedMinutes ?? 0
    if (segments.length > 1) {
      // Two bases in one month (BASE_CHANGED is already flagged): no calculation, the ADMIN types it.
      suggestion = null
    } else if (minutes === 0) {
      // D19: no approved hours → last month's amount stays as the suggestion, with a warning.
      flags.push('HOURLY_NO_HOURS')
    } else {
      const rateGrosze = segments[0].amountGrosze
      const grossGrosze = hourlyGrossGrosze(minutes, rateGrosze)
      const last = input.lastApproved ?? null
      const finalNetGrosze = netFromLastApproved(grossGrosze, last)
      hourly = { rateGrosze, approvedMinutes: minutes, grossGrosze }
      suggestion = {
        kind: 'HOURS',
        finalGrossGrosze: grossGrosze,
        finalNetGrosze,
        ...hourlyCost(grossGrosze, source, input.costContext),
        sourceMonth: finalNetGrosze !== null && last ? payrollMonthKey(last) : null,
      }
      // The gross does not depend on the previous month; only a missing net still needs typing.
      if (finalNetGrosze !== null) {
        const index = flags.indexOf('NO_PREVIOUS_MONTH')
        if (index >= 0) flags.splice(index, 1)
      }
    }
  }
  if (!input.employee.employmentType) flags.push('EMPLOYMENT_TYPE_MISSING')

  const monthlyBase = segments.length > 0 && segments.every((segment) => segment.basis === 'MONTHLY_GROSS')

  return {
    suggestion,
    hourly,
    flags,
    // An hourly row is never ready for one-click or automatic approval (D18): monthlyBase is false.
    autoEligible: suggestion !== null && flags.length === 0 && input.blockers.length === 0 && monthlyBase,
    employment,
    previousEmployment,
  }
}

/** ADMIN-facing description of a flag, e.g. "angaż zmienił się od października". */
export function describeCarryoverFlag(
  flag: CarryoverFlag,
  context: { period: PayrollPeriod; employment: EmploymentInPeriod; previousEmployment?: EmploymentInPeriod; source?: Pick<CarryoverSourceVersion, 'bonusesGrosze' | 'correctionsGrosze' | 'payoutOvertimeMinutes'> | null }
): string {
  const previousKey = payrollMonthKey(previousPayrollPeriod(context.period))
  switch (flag) {
    case 'NO_PREVIOUS_MONTH':
      return `brak zatwierdzonego ${monthGenitive(previousKey)} — wpisz kwoty`
    case 'PARTIAL_MONTH': {
      const parts = [
        context.employment.from > periodFirstDay(context.period) ? `od ${context.employment.from}` : null,
        context.employment.to < periodLastDay(context.period) ? `do ${context.employment.to}` : null,
      ].filter(Boolean)
      return `niepełny miesiąc — zatrudnienie ${parts.join(' ')}`
    }
    case 'BASE_CHANGED':
      return `angaż zmienił się od ${monthGenitive(previousKey)}`
    case 'PREVIOUS_HAD_ADJUSTMENTS': {
      const source = context.source
      const what = [
        source && source.bonusesGrosze !== 0 ? 'premię' : null,
        source && source.correctionsGrosze !== 0 ? 'korektę' : null,
        source && source.payoutOvertimeMinutes > 0 ? 'płatne nadgodziny' : null,
      ].filter(Boolean)
      return `poprzedni miesiąc zawierał ${what.length > 0 ? what.join(' i ') : 'premię lub korektę'}`
    }
    case 'PREVIOUS_MONTH_PARTIAL': {
      const previous = previousPayrollPeriod(context.period)
      const worked = context.previousEmployment
      const parts = worked
        ? [
          worked.from > periodFirstDay(previous) ? `od ${worked.from}` : null,
          worked.to < periodLastDay(previous) ? `do ${worked.to}` : null,
        ].filter(Boolean)
        : []
      return `poprzedni miesiąc był niepełny${parts.length > 0 ? ` (zatrudnienie ${parts.join(' ')})` : ''} — sprawdź kwotę`
    }
    case 'PREVIOUS_HAD_ABSENCE':
      return 'poprzedni miesiąc zawierał nieobecność zmieniającą wypłatę — sprawdź kwotę'
    case 'PAY_AFFECTING_ABSENCE':
      return 'nieobecność zmieniająca wypłatę — sprawdź kwotę'
    case 'HOURLY_BASIS':
      return 'stawka godzinowa — sprawdź kwotę'
    case 'HOURLY_NO_HOURS':
      return 'brak godzin — sprawdź kwotę'
    case 'EMPLOYMENT_TYPE_MISSING':
      return 'brak rodzaju umowy — uzupełnij w karcie'
  }
}
