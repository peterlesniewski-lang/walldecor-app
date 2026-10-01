import type { Prisma, PrismaClient } from '@/generated/prisma'
import { contractMonthlyCosts, type ContractCostRow } from './cost-contracts'

type Db = PrismaClient | Prisma.TransactionClient

/** Contract costs for the given months of one year. Callers pass months in scope and filter by role. */
export async function loadContractCostsForMonths(db: Db, year: number, months: number[]): Promise<ContractCostRow[]> {
  if (months.length === 0) return []
  const contracts = await db.costContract.findMany({
    select: {
      id: true,
      isConfidential: true,
      startMonth: true,
      endMonth: true,
      amounts: { select: { effectiveFrom: true, amountGrosze: true, revokedAt: true } },
      splits: { select: { effectiveFrom: true, jagPercent: true, revokedAt: true } },
    },
  })
  return contractMonthlyCosts(contracts, year, months)
}
