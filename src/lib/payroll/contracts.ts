import type { Prisma, PrismaClient } from '@/generated/prisma'
import { payrollMonthKey, type PayrollPeriod } from './period'

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
  year: number
  month: number
  /** Full employer cost as confirmed by the payroll office — the amount to book as cost. */
  employerCostGrosze: number
  /** Informational only; do not book both gross and employer cost. */
  finalGrossGrosze: number
  approvedAt: Date
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
      finalGrossGrosze: true,
      approvedAt: true,
    },
    orderBy: [{ costCenterId: 'asc' }, { employeeId: 'asc' }],
  })
  return versions.map(({ id, ...version }) => ({
    sourceKey: payrollCostSourceKey(version.employeeId, version),
    versionId: id,
    ...version,
  }))
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
