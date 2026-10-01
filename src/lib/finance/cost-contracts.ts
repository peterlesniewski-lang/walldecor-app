import { allocateEmployerCost, resolveCostSplit } from '@/lib/payroll/employer-cost'
import { payrollMonthKey } from '@/lib/payroll/period'
import type { FinanceCostCenterId } from './company-health'

// Cost contracts: fixed monthly costs without a VAT invoice (e.g. a yard rented from a private
// person). No VAT and no contributions, so the amount is net as it stands.

export type CostContractInput = {
  id: string
  isConfidential: boolean
  /** "YYYY-MM" */
  startMonth: string
  endMonth: string | null
  amounts: Array<{ effectiveFrom: string; amountGrosze: number; revokedAt: Date | null }>
  splits: Array<{ effectiveFrom: string; jagPercent: number; revokedAt: Date | null }>
}

/** One contract's cost in one salon and month (PLN). */
export type ContractCostRow = {
  contractId: string
  month: number
  costCenterId: FinanceCostCenterId
  amount: number
  isConfidential: boolean
}

function amountForMonth(amounts: CostContractInput['amounts'], monthKey: string) {
  return amounts
    .filter((row) => row.revokedAt === null && row.effectiveFrom <= monthKey)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.amountGrosze ?? null
}

export function contractMonthlyCosts(contracts: CostContractInput[], year: number, months: number[]): ContractCostRow[] {
  const rows: ContractCostRow[] = []
  for (const month of months) {
    const monthKey = payrollMonthKey({ year, month })
    for (const contract of contracts) {
      if (contract.startMonth > monthKey || (contract.endMonth !== null && contract.endMonth < monthKey)) continue
      const amountGrosze = amountForMonth(contract.amounts, monthKey)
      if (amountGrosze === null) continue
      const split = resolveCostSplit(contract.splits.filter((row) => row.revokedAt === null), 'GLOBAL', { year, month })
      // Without a split the cost still counts, at company level, rather than disappearing.
      const allocations = split
        ? allocateEmployerCost(amountGrosze, split)
        : [{ costCenterId: 'GLOBAL' as const, amountGrosze }]
      for (const allocation of allocations) {
        rows.push({
          contractId: contract.id,
          month,
          costCenterId: allocation.costCenterId,
          amount: allocation.amountGrosze / 100,
          isConfidential: contract.isConfidential,
        })
      }
    }
  }
  return rows
}

/** Confidential contracts (e.g. the owner's private rent) are visible to ADMIN only. */
export function visibleContractCosts(rows: ContractCostRow[], role: string | undefined): ContractCostRow[] {
  return role === 'ADMIN' ? rows : rows.filter((row) => !row.isConfidential)
}
