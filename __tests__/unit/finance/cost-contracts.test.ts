import { describe, expect, it } from 'vitest'
import { contractMonthlyCosts, visibleContractCosts, type CostContractInput } from '@/lib/finance/cost-contracts'

// Synthetic amounts only.
function contract(overrides: Partial<CostContractInput> = {}): CostContractInput {
  return {
    id: 'yard',
    isConfidential: true,
    startMonth: '2026-04',
    endMonth: null,
    amounts: [{ effectiveFrom: '2026-04', amountGrosze: 3_000_00, revokedAt: null }],
    splits: [{ effectiveFrom: '2026-04', jagPercent: 50, revokedAt: null }],
    ...overrides,
  }
}

const amountsFor = (rows: ReturnType<typeof contractMonthlyCosts>, month: number) =>
  rows.filter((row) => row.month === month).map((row) => [row.costCenterId, row.amount])

describe('cost contract monthly costs', () => {
  it('should split the monthly amount between salons', () => {
    expect(amountsFor(contractMonthlyCosts([contract()], 2026, [8]), 8)).toEqual([['JAG', 1500], ['PUL', 1500]])
  })

  it('should not count months before the contract starts', () => {
    expect(contractMonthlyCosts([contract({ startMonth: '2026-06' })], 2026, [5])).toEqual([])
  })

  it('should count the last month of an ended contract and nothing after it', () => {
    const rows = contractMonthlyCosts([contract({ endMonth: '2026-07' })], 2026, [7, 8])
    expect([amountsFor(rows, 7).length, amountsFor(rows, 8).length]).toEqual([2, 0])
  })

  it('should use a new amount from its month and keep the old one before it', () => {
    const indexed = contract({ amounts: [
      { effectiveFrom: '2026-04', amountGrosze: 3_000_00, revokedAt: null },
      { effectiveFrom: '2026-09', amountGrosze: 3_200_00, revokedAt: null },
    ], splits: [{ effectiveFrom: '2026-04', jagPercent: 100, revokedAt: null }] })
    const rows = contractMonthlyCosts([indexed], 2026, [8, 9])
    expect([amountsFor(rows, 8), amountsFor(rows, 9)]).toEqual([[['JAG', 3000]], [['JAG', 3200]]])
  })

  it('should ignore a revoked amount', () => {
    const corrected = contract({ amounts: [
      { effectiveFrom: '2026-04', amountGrosze: 3_000_00, revokedAt: null },
      { effectiveFrom: '2026-08', amountGrosze: 9_999_00, revokedAt: new Date() },
    ] })
    expect(amountsFor(contractMonthlyCosts([corrected], 2026, [8]), 8)).toEqual([['JAG', 1500], ['PUL', 1500]])
  })

  it('should not lose a grosz on an odd split', () => {
    const odd = contract({ amounts: [{ effectiveFrom: '2026-04', amountGrosze: 100_01, revokedAt: null }] })
    const rows = contractMonthlyCosts([odd], 2026, [8])
    expect(Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100)).toBe(100_01)
  })

  it('should put a contract without a split on the company (GLOBAL) instead of dropping it', () => {
    expect(amountsFor(contractMonthlyCosts([contract({ splits: [] })], 2026, [8]), 8)).toEqual([['GLOBAL', 3000]])
  })

  it('should keep a zero amount at zero', () => {
    const free = contract({ amounts: [{ effectiveFrom: '2026-04', amountGrosze: 0, revokedAt: null }] })
    expect(contractMonthlyCosts([free], 2026, [8]).reduce((sum, row) => sum + row.amount, 0)).toBe(0)
  })

  it('should continue across the year boundary from December to January', () => {
    const yearly = contract({ startMonth: '2026-12' , amounts: [{ effectiveFrom: '2026-12', amountGrosze: 1_000_00, revokedAt: null }], splits: [{ effectiveFrom: '2026-12', jagPercent: 0, revokedAt: null }] })
    expect([amountsFor(contractMonthlyCosts([yearly], 2026, [12]), 12), amountsFor(contractMonthlyCosts([yearly], 2027, [1]), 1)])
      .toEqual([[['PUL', 1000]], [['PUL', 1000]]])
  })

  it('should cover a full year', () => {
    const months = Array.from({ length: 12 }, (_, index) => index + 1)
    expect(contractMonthlyCosts([contract({ startMonth: '2026-01' })], 2027, months).reduce((sum, row) => sum + row.amount, 0)).toBe(36000)
  })
})

describe('cost contract visibility', () => {
  const rows = contractMonthlyCosts([contract(), contract({ id: 'cleaning', isConfidential: false })], 2026, [8])

  it('should show ADMIN confidential contracts', () => {
    expect(visibleContractCosts(rows, 'ADMIN')).toHaveLength(4)
  })

  it('should hide confidential contracts from MANAGER', () => {
    expect(visibleContractCosts(rows, 'MANAGER').map((row) => row.contractId)).toEqual(['cleaning', 'cleaning'])
  })
})

describe('cost contracts in realized costs', () => {
  it('should add contract costs to the salon result as fixed costs from April 2026', async () => {
    const { buildRealizedCostSummary } = await import('@/lib/finance/realized-costs')
    const summary = buildRealizedCostSummary({
      year: 2026,
      actualEntries: [],
      costEvents: [],
      contractCosts: [{ month: 3, costCenterId: 'JAG', amount: 500 }, { month: 8, costCenterId: 'JAG', amount: 1500 }],
    })
    expect([summary.totalCostsByMonth[2], summary.fixedCostsByMonth[7], summary.contractCostsByMonth[7]]).toEqual([0, 1500, 1500])
  })
})
