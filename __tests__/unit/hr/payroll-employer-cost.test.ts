import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMPLOYER_RATES,
  allocateEmployerCost,
  applicableEmployerRates,
  calculateEmployerCostGrosze,
  defaultCostSplitMonth,
  estimateEmployerCostGrosze,
  payrollSettlementTypeFor,
  resolveCostSplit,
  resolveEmployerRates,
  type EmployerRateRow,
} from '@/lib/payroll/employer-cost'

// Synthetic amounts only — no real payroll data.
const august = { year: 2026, month: 8 }
const UOP = DEFAULT_EMPLOYER_RATES.UOP
const NO_EXEMPTIONS = { withoutFunds: false, withoutContributions: false }

function rateRow(overrides: Partial<EmployerRateRow> = {}): EmployerRateRow {
  return { settlementType: 'UOP', effectiveFrom: '2026-04', ...UOP, ...overrides }
}

describe('payroll settlement type', () => {
  it('should map UoP employment to the UOP settlement type', () => {
    expect(payrollSettlementTypeFor('UoP')).toBe('UOP')
  })

  it('should map the management board employment type to ZARZAD', () => {
    expect(payrollSettlementTypeFor('Zarząd')).toBe('ZARZAD')
  })

  it('should leave B2B outside payroll because its cost arrives as an invoice', () => {
    expect(payrollSettlementTypeFor('B2B')).toBeNull()
  })

  it('should leave an employee without employment type outside payroll', () => {
    expect(payrollSettlementTypeFor(null)).toBeNull()
  })
})

describe('employer rates', () => {
  it('should fall back to default rates when settings have no row for the type', () => {
    expect(resolveEmployerRates([], 'UZ', august)).toEqual({ rates: DEFAULT_EMPLOYER_RATES.UZ, source: 'DEFAULT', effectiveFrom: null })
  })

  it('should use the latest settings row effective in the period', () => {
    const rows = [rateRow({ effectiveFrom: '2026-01', accidentBp: 180 }), rateRow({ effectiveFrom: '2026-04', accidentBp: 167 })]
    expect(resolveEmployerRates(rows, 'UOP', august).rates.accidentBp).toBe(167)
  })

  it('should ignore settings rows effective after the period', () => {
    const rows = [rateRow({ effectiveFrom: '2026-01', accidentBp: 180 }), rateRow({ effectiveFrom: '2026-09', accidentBp: 150 })]
    expect(resolveEmployerRates(rows, 'UOP', august).rates.accidentBp).toBe(180)
  })

  it('should apply December rates to December and new-year rates from January', () => {
    const rows = [rateRow({ effectiveFrom: '2025-01', accidentBp: 180 }), rateRow({ effectiveFrom: '2026-01', accidentBp: 167 })]
    expect([
      resolveEmployerRates(rows, 'UOP', { year: 2025, month: 12 }).rates.accidentBp,
      resolveEmployerRates(rows, 'UOP', { year: 2026, month: 1 }).rates.accidentBp,
    ]).toEqual([180, 167])
  })

  it('should drop labour and guarantee funds for an employee exempt from funds', () => {
    const rates = applicableEmployerRates(UOP, { withoutFunds: true, withoutContributions: false })
    expect([rates.labourFundBp, rates.guaranteeFundBp, rates.pensionBp]).toEqual([0, 0, UOP.pensionBp])
  })

  it('should drop every employer contribution for an employee exempt from contributions', () => {
    const rates = applicableEmployerRates(UOP, { withoutFunds: false, withoutContributions: true })
    expect(calculateEmployerCostGrosze(10_000_00, rates)).toBe(10_000_00)
  })

  it('should not add employer contributions for the management board by default', () => {
    expect(calculateEmployerCostGrosze(10_000_00, DEFAULT_EMPLOYER_RATES.ZARZAD)).toBe(10_000_00)
  })
})

describe('employer cost calculation', () => {
  it('should add UoP employer contributions on top of gross', () => {
    // 9.76% + 6.50% + 1.67% + 2.45% + 0.10% of 10 000,00 = 2 048,00
    expect(calculateEmployerCostGrosze(10_000_00, applicableEmployerRates(UOP, NO_EXEMPTIONS))).toBe(12_048_00)
  })

  it('should round every contribution to grosze separately', () => {
    // 1,03 zł: 0,1005 → 0,10; 0,06695 → 0,07; 0,0172 → 0,02; 0,0252 → 0,03; 0,0010 → 0,00 = 0,22
    // (rounding the 0,2109 total once would give 0,21)
    expect(calculateEmployerCostGrosze(1_03, UOP)).toBe(1_25)
  })

  it('should return zero employer cost for zero gross', () => {
    expect(calculateEmployerCostGrosze(0, UOP)).toBe(0)
  })

  it('should keep a negative correction symmetric to a positive one', () => {
    expect(calculateEmployerCostGrosze(-10_000_00, UOP)).toBe(-12_048_00)
  })
})

describe('cost split', () => {
  const splits = [{ effectiveFrom: '2026-05', jagPercent: 50 }]

  it('should default to 100% of the employee salon cost center without a split', () => {
    expect(resolveCostSplit([], 'PUL', august)).toEqual({ jagPercent: 0, source: 'COST_CENTER' })
  })

  it('should require a split for an employee assigned to GLOBAL', () => {
    expect(resolveCostSplit([], 'GLOBAL', august)).toBeNull()
  })

  it('should use the split effective in the period over the cost center', () => {
    expect(resolveCostSplit(splits, 'GLOBAL', august)).toEqual({ jagPercent: 50, source: 'SPLIT' })
  })

  it('should not use a split before its effective month', () => {
    expect(resolveCostSplit(splits, 'JAG', { year: 2026, month: 4 })).toEqual({ jagPercent: 100, source: 'COST_CENTER' })
  })

  it('should allocate the whole amount without losing a grosz on odd splits', () => {
    const allocation = allocateEmployerCost(100_01, { jagPercent: 50 })
    expect(allocation.reduce((sum, row) => sum + row.amountGrosze, 0)).toBe(100_01)
  })

  it('should allocate a 100/0 split to a single salon only', () => {
    expect(allocateEmployerCost(5_000_00, { jagPercent: 100 })).toEqual([{ costCenterId: 'JAG', amountGrosze: 5_000_00 }])
  })

  it('should allocate a 30/70 split proportionally', () => {
    expect(allocateEmployerCost(10_000_00, { jagPercent: 30 })).toEqual([
      { costCenterId: 'JAG', amountGrosze: 3_000_00 },
      { costCenterId: 'PUL', amountGrosze: 7_000_00 },
    ])
  })
})

describe('default split month', () => {
  it('should start a split at April 2026 for someone employed earlier', () => {
    expect(defaultCostSplitMonth('2025-01-01T00:00:00.000Z')).toBe('2026-04')
  })

  it('should start a split at the first month of a later hire', () => {
    expect(defaultCostSplitMonth('2026-06-15T00:00:00.000Z')).toBe('2026-06')
  })
})

describe('employer cost estimate', () => {
  it('should estimate from the monthly base salary and rates', () => {
    expect(estimateEmployerCostGrosze({ amountGrosze: 10_000_00, basis: 'MONTHLY_GROSS' }, UOP)).toBe(12_048_00)
  })

  it('should not estimate an hourly base without hours', () => {
    expect(estimateEmployerCostGrosze({ amountGrosze: 40_00, basis: 'HOURLY_GROSS' }, UOP)).toBeNull()
  })

  it('should not estimate without a base salary', () => {
    expect(estimateEmployerCostGrosze(null, UOP)).toBeNull()
  })
})
