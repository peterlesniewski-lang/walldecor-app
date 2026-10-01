import { COST_EVENT_START_MONTH_KEY } from '@/lib/finance/cost-cutover'
import { payrollMonthKey, type PayrollPeriod } from './period'
import type { PayrollBasis } from './types'

// Employer cost ("brutto brutto") = gross + employer-side contributions. The payroll office list
// carries gross and net only, so employer contributions are derived here from rates set once in
// settings. Rates are basis points (1 bp = 0.01%) and every contribution is rounded to grosze
// separately, the way contributions are declared.

export const PAYROLL_SETTLEMENT_TYPES = ['UOP', 'UZ', 'ZARZAD'] as const
export type PayrollSettlementType = typeof PAYROLL_SETTLEMENT_TYPES[number]

export const PAYROLL_SETTLEMENT_TYPE_LABELS: Record<PayrollSettlementType, string> = {
  UOP: 'Umowa o pracę',
  UZ: 'Umowa zlecenie',
  ZARZAD: 'Zarząd',
}

/** Employee.employmentType values that are settled through payroll. B2B arrives as invoices. */
const SETTLEMENT_TYPE_BY_EMPLOYMENT: Record<string, PayrollSettlementType> = {
  UoP: 'UOP',
  UZ: 'UZ',
  'Zarząd': 'ZARZAD',
}

export function payrollSettlementTypeFor(employmentType: string | null | undefined): PayrollSettlementType | null {
  return (employmentType && SETTLEMENT_TYPE_BY_EMPLOYMENT[employmentType]) || null
}

export type EmployerRates = {
  pensionBp: number
  disabilityBp: number
  accidentBp: number
  labourFundBp: number
  guaranteeFundBp: number
  ppkBp: number
}

export const EMPLOYER_RATE_LABELS: Record<keyof EmployerRates, string> = {
  pensionBp: 'Emerytalna',
  disabilityBp: 'Rentowa',
  accidentBp: 'Wypadkowa',
  labourFundBp: 'Fundusz Pracy',
  guaranteeFundBp: 'FGŚP',
  ppkBp: 'PPK',
}

const RATE_KEYS = Object.keys(EMPLOYER_RATE_LABELS) as Array<keyof EmployerRates>

const NO_RATES: EmployerRates = {
  pensionBp: 0,
  disabilityBp: 0,
  accidentBp: 0,
  labourFundBp: 0,
  guaranteeFundBp: 0,
  ppkBp: 0,
}

/** Indicative defaults until the owner confirms rates with the accountant in settings. */
export const DEFAULT_EMPLOYER_RATES: Record<PayrollSettlementType, EmployerRates> = {
  UOP: { pensionBp: 976, disabilityBp: 650, accidentBp: 167, labourFundBp: 245, guaranteeFundBp: 10, ppkBp: 0 },
  UZ: { pensionBp: 976, disabilityBp: 650, accidentBp: 167, labourFundBp: 0, guaranteeFundBp: 0, ppkBp: 0 },
  ZARZAD: NO_RATES,
}

export type EmployerRateRow = EmployerRates & {
  settlementType: string
  /** "YYYY-MM" */
  effectiveFrom: string
}

export type ResolvedEmployerRates = {
  rates: EmployerRates
  source: 'SETTINGS' | 'DEFAULT'
  effectiveFrom: string | null
}

function pickRates(row: EmployerRates): EmployerRates {
  return Object.fromEntries(RATE_KEYS.map((key) => [key, row[key]])) as EmployerRates
}

export function resolveEmployerRates(
  rows: EmployerRateRow[],
  settlementType: PayrollSettlementType,
  period: PayrollPeriod
): ResolvedEmployerRates {
  const monthKey = payrollMonthKey(period)
  const row = rows
    .filter((candidate) => candidate.settlementType === settlementType && candidate.effectiveFrom <= monthKey)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
  if (!row) return { rates: DEFAULT_EMPLOYER_RATES[settlementType], source: 'DEFAULT', effectiveFrom: null }
  return { rates: pickRates(row), source: 'SETTINGS', effectiveFrom: row.effectiveFrom }
}

export type EmployerCostExemptions = {
  /** No Labour Fund and FGŚP, e.g. employees aged 55+/60+. */
  withoutFunds: boolean
  /** No employer contributions at all, e.g. a student under 26 on a UZ. */
  withoutContributions: boolean
}

export function applicableEmployerRates(rates: EmployerRates, exemptions: EmployerCostExemptions): EmployerRates {
  if (exemptions.withoutContributions) return NO_RATES
  if (exemptions.withoutFunds) return { ...rates, labourFundBp: 0, guaranteeFundBp: 0 }
  return rates
}

function contributionGrosze(grossGrosze: number, rateBp: number) {
  const magnitude = Math.floor((Math.abs(grossGrosze) * rateBp + 5_000) / 10_000)
  return grossGrosze < 0 ? -magnitude : magnitude
}

export function calculateEmployerCostGrosze(grossGrosze: number, rates: EmployerRates): number {
  return RATE_KEYS.reduce((total, key) => total + contributionGrosze(grossGrosze, rates[key]), grossGrosze)
}

export function estimateEmployerCostGrosze(
  base: { amountGrosze: number; basis: string } | null,
  rates: EmployerRates
): number | null {
  if (!base || (base.basis as PayrollBasis) !== 'MONTHLY_GROSS') return null
  return calculateEmployerCostGrosze(base.amountGrosze, rates)
}

// ─── Split between salons ────────────────────────────────────────────────────

export const PAYROLL_COST_CENTERS = ['JAG', 'PUL'] as const
export type PayrollCostCenter = typeof PAYROLL_COST_CENTERS[number]

/** PUL receives the remainder (100 - jagPercent). */
export type CostSplit = { jagPercent: number }

export type CostSplitRow = CostSplit & {
  /** "YYYY-MM" */
  effectiveFrom: string
}

export type ResolvedCostSplit = CostSplit & { source: 'SPLIT' | 'COST_CENTER' }

/**
 * The split effective in the period, or 100% to the employee's salon. GLOBAL has no revenue, so an
 * employee assigned to it needs an explicit split; null means the split is missing.
 */
export function resolveCostSplit(
  rows: CostSplitRow[],
  employeeCostCenterId: string,
  period: PayrollPeriod
): ResolvedCostSplit | null {
  const monthKey = payrollMonthKey(period)
  const row = rows
    .filter((candidate) => candidate.effectiveFrom <= monthKey)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
  if (row) return { jagPercent: row.jagPercent, source: 'SPLIT' }
  if (employeeCostCenterId === 'JAG') return { jagPercent: 100, source: 'COST_CENTER' }
  if (employeeCostCenterId === 'PUL') return { jagPercent: 0, source: 'COST_CENTER' }
  return null
}

/**
 * Default month for a new split: the first month whose results include employer cost, or the
 * employee's first month if they started later. A split set "from the open settlement" would leave
 * every earlier month without a salon.
 */
export function defaultCostSplitMonth(employeeStartDate: string): string {
  const startMonth = employeeStartDate.slice(0, 7)
  return startMonth > COST_EVENT_START_MONTH_KEY ? startMonth : COST_EVENT_START_MONTH_KEY
}

/** Why a person in payroll has no employer cost in a month (ADMIN-facing wording). */
export const EMPLOYER_COST_GAP_LABELS: Record<string, string> = {
  BASE_MISSING: 'brak podstawy wynagrodzenia w tym miesiącu',
  HOURLY_BASE: 'stawka godzinowa — szacunek możliwy dopiero po rozliczeniu',
  COST_SPLIT_MISSING: 'brak podziału JAG/PUL obowiązującego w tym miesiącu',
}

export type EmployerCostAllocation = { costCenterId: PayrollCostCenter; amountGrosze: number }

export function allocateEmployerCost(amountGrosze: number, split: CostSplit): EmployerCostAllocation[] {
  const jag = Math.round((amountGrosze * split.jagPercent) / 100)
  const allocations: EmployerCostAllocation[] = []
  if (split.jagPercent > 0) allocations.push({ costCenterId: 'JAG', amountGrosze: jag })
  if (split.jagPercent < 100) allocations.push({ costCenterId: 'PUL', amountGrosze: amountGrosze - jag })
  return allocations
}
