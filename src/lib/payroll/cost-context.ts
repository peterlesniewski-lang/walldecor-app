import type { Prisma, PrismaClient } from '@/generated/prisma'
import {
  applicableEmployerRates,
  calculateEmployerCostGrosze,
  payrollSettlementTypeFor,
  resolveCostSplit,
  resolveEmployerRates,
  type EmployerCostExemptions,
  type EmployerRates,
  type PayrollSettlementType,
  type ResolvedCostSplit,
} from './employer-cost'
import type { PayrollPeriod } from './period'

type Db = PrismaClient | Prisma.TransactionClient

/** Everything needed to derive and allocate one employee's employer cost for one month. */
export type EmployerCostContext = {
  settlementType: PayrollSettlementType | null
  /** Rates after exemptions; null when the employment type has no payroll rates (e.g. B2B). */
  rates: EmployerRates | null
  ratesSource: 'SETTINGS' | 'DEFAULT' | null
  ratesEffectiveFrom: string | null
  exemptions: EmployerCostExemptions
  /** null when the employee sits in GLOBAL without an explicit split. */
  split: ResolvedCostSplit | null
}

export type EmployerCostEmployee = { id: string; employmentType: string | null; costCenterId: string }

export async function loadEmployerCostContexts(
  db: Db,
  employees: EmployerCostEmployee[],
  period: PayrollPeriod
): Promise<Map<string, EmployerCostContext>> {
  const employeeIds = employees.map((employee) => employee.id)
  const [rateRows, profiles, splitRows] = await Promise.all([
    db.payrollEmployerRate.findMany({ where: { revokedAt: null } }),
    db.payrollCostProfile.findMany({ where: { employeeId: { in: employeeIds } } }),
    db.payrollCostSplit.findMany({ where: { employeeId: { in: employeeIds }, revokedAt: null } }),
  ])
  const profileByEmployee = new Map(profiles.map((profile) => [profile.employeeId, profile]))

  return new Map(employees.map((employee) => {
    const profile = profileByEmployee.get(employee.id)
    const exemptions = {
      withoutFunds: profile?.withoutFunds ?? false,
      withoutContributions: profile?.withoutContributions ?? false,
    }
    const settlementType = payrollSettlementTypeFor(employee.employmentType)
    const resolved = settlementType ? resolveEmployerRates(rateRows, settlementType, period) : null
    const split = resolveCostSplit(
      splitRows.filter((row) => row.employeeId === employee.id),
      employee.costCenterId,
      period
    )
    return [employee.id, {
      settlementType,
      rates: resolved ? applicableEmployerRates(resolved.rates, exemptions) : null,
      ratesSource: resolved?.source ?? null,
      ratesEffectiveFrom: resolved?.effectiveFrom ?? null,
      exemptions,
      split,
    }]
  }))
}

export async function loadEmployerCostContext(db: Db, employee: EmployerCostEmployee, period: PayrollPeriod) {
  const contexts = await loadEmployerCostContexts(db, [employee], period)
  return contexts.get(employee.id) as EmployerCostContext
}

/**
 * A CALCULATED employer cost goes stale when rates, exemptions or the employment type change after
 * the payroll office confirmation; approving it would freeze an amount nobody confirmed.
 */
export function isCalculatedEmployerCostStale(
  settlement: { employerCostSource: string | null; finalGrossGrosze: number | null; employerCostGrosze: number | null },
  context: EmployerCostContext
): boolean {
  if (settlement.employerCostSource !== 'CALCULATED' || settlement.finalGrossGrosze === null) return false
  if (!context.rates) return true
  return calculateEmployerCostGrosze(settlement.finalGrossGrosze, context.rates) !== settlement.employerCostGrosze
}
