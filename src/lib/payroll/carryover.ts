import { getWarsawBusinessDate } from '@/lib/hr/business-date'
import type { BaseSegment } from './calendar'
import type { EmployerCostContext } from './cost-context'
import { calculateEmployerCostGrosze } from './employer-cost'
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

export type CarryoverSuggestion = {
  finalGrossGrosze: number
  finalNetGrosze: number
  employerCostGrosze: number
  /** CALCULATED: recalculated from current rates; OVERRIDDEN: copied as a manually entered amount. */
  employerCostSource: 'CALCULATED' | 'OVERRIDDEN'
  /** "YYYY-MM" of the version the amounts come from. */
  sourceMonth: string
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
}

export type CarryoverEvaluation = {
  suggestion: CarryoverSuggestion | null
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

function suggestionFrom(source: CarryoverSourceVersion, costContext: CarryoverInput['costContext']): CarryoverSuggestion {
  const recalculate = source.employerCostSource === 'CALCULATED' && costContext.rates !== null
  return {
    finalGrossGrosze: source.finalGrossGrosze,
    finalNetGrosze: source.finalNetGrosze,
    employerCostGrosze: recalculate
      ? calculateEmployerCostGrosze(source.finalGrossGrosze, costContext.rates as NonNullable<typeof costContext.rates>)
      : source.employerCostGrosze,
    employerCostSource: recalculate ? 'CALCULATED' : 'OVERRIDDEN',
    sourceMonth: payrollMonthKey(source),
  }
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
  if (segments.some((segment) => segment.basis === 'HOURLY_GROSS')) flags.push('HOURLY_BASIS')
  if (!input.employee.employmentType) flags.push('EMPLOYMENT_TYPE_MISSING')

  const suggestion = source ? suggestionFrom(source, input.costContext) : null
  const monthlyBase = segments.length > 0 && segments.every((segment) => segment.basis === 'MONTHLY_GROSS')

  return {
    suggestion,
    flags,
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
    case 'EMPLOYMENT_TYPE_MISSING':
      return 'brak rodzaju umowy — uzupełnij w karcie'
  }
}
