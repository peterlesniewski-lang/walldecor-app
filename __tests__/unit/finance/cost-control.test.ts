import { describe, expect, it } from 'vitest'
import {
  calculateHistoricalContributionMargin,
  calculatePaymentAgingBucket,
  resolveSupplierRuleDecision,
  suggestCorrectionPartsFromOriginal,
  validateCostParts,
  validateResolvedAllocation,
} from '@/lib/finance/cost-control'

describe('calculatePaymentAgingBucket', () => {
  const now = new Date('2026-07-01T10:00:00.000Z')

  it('counts due today as 0-7 days and yesterday as overdue using Europe/Warsaw business dates', () => {
    expect(calculatePaymentAgingBucket(new Date('2026-07-01T00:00:00.000Z'), now)).toBe('DUE_0_7')
    expect(calculatePaymentAgingBucket(new Date('2026-06-30T00:00:00.000Z'), now)).toBe('OVERDUE')
  })

  it('returns missing due date bucket when due date is null', () => {
    expect(calculatePaymentAgingBucket(null, now)).toBe('MISSING_DUE_DATE')
  })
})

describe('validateCostParts', () => {
  it('requires part amounts to equal the invoice gross amount', () => {
    const result = validateCostParts(1000, [
      { id: 'p1', grossAmount: 700, allocations: [{ costCenterId: 'JAG', percent: 100 }] },
      { id: 'p2', grossAmount: 200, allocations: [{ costCenterId: 'PUL', percent: 100 }] },
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Suma części faktury musi być równa kwocie brutto faktury.')
  })
})

describe('validateResolvedAllocation', () => {
  it('accepts GLOBAL as a full central allocation', () => {
    expect(validateResolvedAllocation([{ costCenterId: 'GLOBAL', percent: 100 }])).toEqual({ ok: true })
  })

  it('rejects allocation totals below 100 percent', () => {
    expect(validateResolvedAllocation([
      { costCenterId: 'JAG', percent: 80 },
      { costCenterId: 'PUL', percent: 10 },
    ])).toEqual({ ok: false, error: 'Suma alokacji musi wynosić 100%.' })
  })
})

describe('resolveSupplierRuleDecision', () => {
  it('prefers exact NIP over name pattern', () => {
    const decision = resolveSupplierRuleDecision(
      { supplierName: 'Google Ireland', supplierNip: '525-000-71-33' },
      [
        { id: 'name', active: true, priority: 100, supplierNamePattern: 'google', supplierNip: null },
        { id: 'nip', active: true, priority: 100, supplierNamePattern: null, supplierNip: '5250007133' },
      ]
    )

    expect(decision).toEqual({ status: 'MATCHED', ruleId: 'nip' })
  })

  it('returns rule conflict for equally specific rules with the same priority', () => {
    const decision = resolveSupplierRuleDecision(
      { supplierName: 'REMI Spółka Jawna', supplierNip: null },
      [
        { id: 'a', active: true, priority: 100, supplierNamePattern: 'remi', supplierNip: null },
        { id: 'b', active: true, priority: 100, supplierNamePattern: 'remi spółka', supplierNip: null },
      ]
    )

    expect(decision.status).toBe('CONFLICT')
    expect(decision.conflictingRuleIds).toEqual(['a', 'b'])
  })
})

describe('suggestCorrectionPartsFromOriginal', () => {
  it('suggests correction parts using original split proportions', () => {
    expect(suggestCorrectionPartsFromOriginal(-100, [
      { label: 'Towar', grossAmount: 700 },
      { label: 'Transport', grossAmount: 300 },
    ])).toEqual([
      { label: 'Towar', grossAmount: -70 },
      { label: 'Transport', grossAmount: -30 },
    ])
  })
})

describe('calculateHistoricalContributionMargin', () => {
  it('uses revenue minus COGS and variable costs over closed months', () => {
    const margin = calculateHistoricalContributionMargin([
      { revenue: 10000, cogs: 4000, variableCosts: 1000 },
      { revenue: 12000, cogs: 4800, variableCosts: 1200 },
      { revenue: 8000, cogs: 3200, variableCosts: 800 },
    ])

    expect(margin).toBe(0.5)
  })
})
