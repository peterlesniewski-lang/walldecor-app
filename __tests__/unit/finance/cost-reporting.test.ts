import { describe, expect, it } from 'vitest'
import { buildBreakEvenReport, buildCostWarningTotal, filterConfidentialCostEvents, sumAllocatedCostsByCenter, summarizeSupplierSpend } from '@/lib/finance/cost-reporting'

describe('summarizeSupplierSpend', () => {
  it('groups approved cost events by supplier NIP when available', () => {
    const rows = summarizeSupplierSpend([
      { supplierName: 'REMI', supplierNip: '9462595618', grossAmount: 100 },
      { supplierName: 'REMI sp.j.', supplierNip: '9462595618', grossAmount: 50 },
      { supplierName: 'No NIP', supplierNip: null, grossAmount: 25 },
    ])

    expect(rows).toEqual([
      { key: '9462595618', supplierName: 'REMI', supplierNip: '9462595618', grossAmount: 150 },
      { key: 'No NIP', supplierName: 'No NIP', supplierNip: null, grossAmount: 25 },
    ])
  })
})

describe('buildCostWarningTotal', () => {
  it('sums costs that can make reports incomplete', () => {
    expect(buildCostWarningTotal([
      { status: 'NEW', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 100 },
      { status: 'MAPPED', documentStatus: 'CORRECTION', currency: 'PLN', grossAmount: 50 },
      { status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'EUR', grossAmount: 200 },
    ])).toBe(350)
  })
})

describe('filterConfidentialCostEvents', () => {
  it('hides confidential events from managers', () => {
    expect(filterConfidentialCostEvents([
      { id: 'public', isConfidential: false },
      { id: 'private', isConfidential: true },
    ], 'MANAGER')).toEqual([{ id: 'public', isConfidential: false }])
  })
})

describe('sumAllocatedCostsByCenter', () => {
  it('sums part amounts by allocation percentage', () => {
    expect(sumAllocatedCostsByCenter([
      {
        parts: [
          {
            grossAmount: 1000,
            allocations: [
              { costCenterId: 'JAG', percent: 60 },
              { costCenterId: 'PUL', percent: 40 },
            ],
          },
        ],
      },
    ])).toEqual({ JAG: 600, PUL: 400, GLOBAL: 0 })
  })
})

describe('buildBreakEvenReport', () => {
  it('shows missing contribution margin instead of inventing break-even turnover', () => {
    const report = buildBreakEvenReport({
      revenue: [{ costCenterId: 'JAG', amount: 10000 }],
      allocatedCosts: [{ costCenterId: 'JAG', fixedCosts: 5000, variableCosts: 1000, cogs: 2000 }],
      contributionMargins: {},
      warningAmount: 0,
    })

    expect(report.byCostCenter.JAG.breakEvenTurnover).toBeNull()
    expect(report.byCostCenter.JAG.warning).toBe('missing contribution margin')
  })

  it('calculates break-even turnover from fixed costs and contribution margin', () => {
    const report = buildBreakEvenReport({
      revenue: [{ costCenterId: 'JAG', amount: 15000 }],
      allocatedCosts: [{ costCenterId: 'JAG', fixedCosts: 6000, variableCosts: 1000, cogs: 2000 }],
      contributionMargins: { JAG: 0.5 },
      warningAmount: 100,
    })

    expect(report.byCostCenter.JAG.breakEvenTurnover).toBe(12000)
    expect(report.byCostCenter.JAG.delta).toBe(3000)
    expect(report.warningAmount).toBe(100)
  })
})
