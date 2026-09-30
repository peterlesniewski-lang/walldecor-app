import type { Prisma, PrismaClient } from '@/generated/prisma'
import { isEmployedInPeriod, payrollMonthKey, periodLastDay, periodTimeEntryQueryRange, type PayrollPeriod } from './period'
import { allocateEmployerCost, estimateEmployerCostGrosze, payrollSettlementTypeFor } from './employer-cost'
import { loadEmployerCostContexts } from './cost-context'

// Read contracts for the next stages. Both read ONLY effective approved versions
// (PayrollSettlementVersion.supersededAt IS NULL) — never drafts, never superseded versions.
// The database guarantees at most one effective version per employee-month.

type Db = PrismaClient | Prisma.TransactionClient

// ─── Finance / Break-even ────────────────────────────────────────────────────

/**
 * One payroll cost per employee-month. Consumers must upsert by `sourceKey` (stable across
 * corrections) and store `versionId`; when a newer version arrives for the same sourceKey the
 * previous amount is REPLACED, never added. That is what prevents double cost recognition.
 */
export type PayrollCostRecord = {
  sourceKey: string // `payroll:${employeeId}:${YYYY-MM}`
  versionId: string
  versionNumber: number
  employeeId: string
  costCenterId: string // Employee cost center snapshot at approval time (JAG | PUL | GLOBAL)
  /** Employer cost split between salons at approval; sums to employerCostGrosze. */
  allocations: PayrollCostAllocation[]
  /** CALCULATED from rates, OVERRIDDEN by ADMIN, or ENTERED before rates existed. */
  employerCostSource: string
  /** Employment type snapshot at approval time. */
  employmentType: string | null
  year: number
  month: number
  /** Full employer cost as confirmed by the payroll office — the amount to book as cost. */
  employerCostGrosze: number
  /** Informational only; do not book both gross and employer cost. */
  finalGrossGrosze: number
  approvedAt: Date
}

export type PayrollCostAllocation = { costCenterId: string; amountGrosze: number }

function parseAllocations(json: string, fallback: PayrollCostAllocation): PayrollCostAllocation[] {
  const parsed = JSON.parse(json) as PayrollCostAllocation[]
  // Versions approved before salon splits existed carry the whole cost on the employee cost center.
  return parsed.length > 0 ? parsed : [fallback]
}

export function payrollCostSourceKey(employeeId: string, period: PayrollPeriod) {
  return `payroll:${employeeId}:${payrollMonthKey(period)}`
}

export async function getEffectivePayrollCosts(db: Db, period: PayrollPeriod): Promise<PayrollCostRecord[]> {
  const versions = await db.payrollSettlementVersion.findMany({
    where: { year: period.year, month: period.month, supersededAt: null },
    select: {
      id: true,
      versionNumber: true,
      employeeId: true,
      costCenterId: true,
      year: true,
      month: true,
      employerCostGrosze: true,
      employerCostSource: true,
      employmentType: true,
      costAllocationJson: true,
      finalGrossGrosze: true,
      approvedAt: true,
    },
    orderBy: [{ costCenterId: 'asc' }, { employeeId: 'asc' }],
  })
  return versions.map(({ id, costAllocationJson, ...version }) => ({
    sourceKey: payrollCostSourceKey(version.employeeId, version),
    versionId: id,
    ...version,
    allocations: parseAllocations(costAllocationJson, {
      costCenterId: version.costCenterId,
      amountGrosze: version.employerCostGrosze,
    }),
  }))
}

// ─── Finance: employer cost per month (approved or estimated) ────────────────

export type MonthlyEmployerCostStatus = 'APPROVED' | 'ESTIMATE' | 'MISSING'
export type MonthlyEmployerCostGap = 'BASE_MISSING' | 'HOURLY_BASE' | 'COST_SPLIT_MISSING'

export type MonthlyEmployerCost = {
  employeeId: string
  year: number
  month: number
  status: MonthlyEmployerCostStatus
  /** Why an estimate could not be made; set only for MISSING. */
  gap: MonthlyEmployerCostGap | null
  employerCostGrosze: number | null
  allocations: PayrollCostAllocation[]
}

/**
 * Employer cost of every person settled through payroll (UoP, UZ, management board) for one month.
 * An approved version wins; otherwise the cost is estimated from the base salary and rates, without
 * overtime or bonuses. B2B and other employment types are excluded — their cost arrives as invoices.
 */
export async function getMonthlyEmployerCosts(db: Db, period: PayrollPeriod): Promise<MonthlyEmployerCost[]> {
  const range = periodTimeEntryQueryRange(period)
  const [approved, employees] = await Promise.all([
    getEffectivePayrollCosts(db, period),
    db.employee.findMany({
      where: { startDate: { lt: range.lt }, OR: [{ endDate: null }, { endDate: { gte: range.gte } }] },
      select: {
        id: true,
        employmentType: true,
        costCenterId: true,
        startDate: true,
        endDate: true,
        payrollBaseSalaries: {
          where: { revokedAt: null, effectiveFrom: { lte: periodLastDay(period) } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { amountGrosze: true, basis: true },
        },
      },
      orderBy: { id: 'asc' },
    }),
  ])
  const approvedEmployeeIds = new Set(approved.map((record) => record.employeeId))
  const inScope = employees.filter((employee) =>
    payrollSettlementTypeFor(employee.employmentType) !== null && isEmployedInPeriod(employee, period)
  )
  const contexts = await loadEmployerCostContexts(db, inScope, period)

  const approvedRows: MonthlyEmployerCost[] = approved
    .filter((record) => payrollSettlementTypeFor(record.employmentType) !== null)
    .map((record) => ({
      employeeId: record.employeeId,
      year: record.year,
      month: record.month,
      status: 'APPROVED',
      gap: null,
      employerCostGrosze: record.employerCostGrosze,
      allocations: record.allocations,
    }))

  const estimatedRows = inScope
    .filter((employee) => !approvedEmployeeIds.has(employee.id))
    .map((employee): MonthlyEmployerCost => {
      const context = contexts.get(employee.id)
      const base = employee.payrollBaseSalaries[0] ?? null
      const missing = (gap: MonthlyEmployerCostGap): MonthlyEmployerCost => ({
        employeeId: employee.id, ...period, status: 'MISSING', gap, employerCostGrosze: null, allocations: [],
      })
      if (!base) return missing('BASE_MISSING')
      if (!context?.split) return missing('COST_SPLIT_MISSING')
      const estimate = context.rates ? estimateEmployerCostGrosze(base, context.rates) : null
      if (estimate === null) return missing('HOURLY_BASE')
      return {
        employeeId: employee.id,
        ...period,
        status: 'ESTIMATE',
        gap: null,
        employerCostGrosze: estimate,
        allocations: allocateEmployerCost(estimate, context.split),
      }
    })

  return [...approvedRows, ...estimatedRows]
}

// ─── Employee "Moje wynagrodzenia" ───────────────────────────────────────────

/**
 * What an employee may see about their own pay. Deliberately excludes employer cost, payroll
 * office references, admin notes and the audit trail. The caller MUST pass the employeeId from
 * the authenticated session (session.user.employeeId), never from a request parameter.
 */
export type EmployeePayrollStatement = {
  year: number
  month: number
  versionNumber: number
  approvedAt: Date
  finalGrossGrosze: number
  finalNetGrosze: number
  baseSalaryGrosze: number
  baseBasis: string
  bonusesGrosze: number
  correctionsGrosze: number
  payoutOvertimeMinutes: number
  timeOffOvertimeMinutes: number
}

export async function getOwnPayrollStatements(db: Db, sessionEmployeeId: string): Promise<EmployeePayrollStatement[]> {
  if (!sessionEmployeeId) return []
  return db.payrollSettlementVersion.findMany({
    where: { employeeId: sessionEmployeeId, supersededAt: null },
    select: {
      year: true,
      month: true,
      versionNumber: true,
      approvedAt: true,
      finalGrossGrosze: true,
      finalNetGrosze: true,
      baseSalaryGrosze: true,
      baseBasis: true,
      bonusesGrosze: true,
      correctionsGrosze: true,
      payoutOvertimeMinutes: true,
      timeOffOvertimeMinutes: true,
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  })
}
