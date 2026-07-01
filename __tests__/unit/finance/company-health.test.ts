import { describe, expect, it } from 'vitest'
import { buildCompanyHealth, type FinanceCostCenterId } from '@/lib/finance/company-health'

describe('buildCompanyHealth', () => {
  it('returns stable monthly result per salon without mixing GLOBAL costs into salon result', () => {
    const currentMonth = 3
    const revenue = [
      { costCenterId: 'JAG' as FinanceCostCenterId, month: 3, amount: 80_000 },
      { costCenterId: 'PUL' as FinanceCostCenterId, month: 3, amount: 120_000 },
    ]
    const expenses = [
      { costCenterId: 'JAG' as FinanceCostCenterId, month: 3, amount: 55_000 },
      { costCenterId: 'PUL' as FinanceCostCenterId, month: 3, amount: 90_000 },
      { costCenterId: 'GLOBAL' as FinanceCostCenterId, month: 3, amount: 40_000 },
    ]

    const health = buildCompanyHealth({ year: 2026, currentMonth, revenue, expenses })

    expect(health.byCostCenter.JAG.currentMonth.result).toBe(25_000)
    expect(health.byCostCenter.PUL.currentMonth.result).toBe(30_000)
    expect(health.byCostCenter.GLOBAL.currentMonth.result).toBe(-40_000)
    expect(health.company.currentMonth.result).toBe(15_000)
  })

  it('reports break-even gap as revenue minus current costs for the selected month', () => {
    const health = buildCompanyHealth({
      year: 2026,
      currentMonth: 4,
      revenue: [{ costCenterId: 'JAG', month: 4, amount: 45_000 }],
      expenses: [{ costCenterId: 'JAG', month: 4, amount: 60_000 }],
    })

    expect(health.byCostCenter.JAG.currentMonth.breakEvenTarget).toBe(60_000)
    expect(health.byCostCenter.JAG.currentMonth.breakEvenDelta).toBe(-15_000)
    expect(health.byCostCenter.JAG.currentMonth.status).toBe('below')
  })

  it('marks a salon at break-even when revenue equals costs', () => {
    const health = buildCompanyHealth({
      year: 2026,
      currentMonth: 5,
      revenue: [{ costCenterId: 'PUL', month: 5, amount: 70_000 }],
      expenses: [{ costCenterId: 'PUL', month: 5, amount: 70_000 }],
    })

    expect(health.byCostCenter.PUL.currentMonth.result).toBe(0)
    expect(health.byCostCenter.PUL.currentMonth.status).toBe('even')
  })
})
