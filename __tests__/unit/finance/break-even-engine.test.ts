import { describe, expect, it } from 'vitest'
import { calculateBreakEven, calculateHistoricalSuggestion, resolveBreakEvenMargin, parseBreakEvenPeriod, type BreakEvenCalculationInput } from '@/lib/finance/break-even-engine'
import type { BreakEvenSource, BreakEvenRevenueBasis } from '@/lib/finance/break-even-types'

const margin = { id: 'margin', margin: 0.4, effectiveFrom: '2026-01-01T00:00:00.000Z', note: null }
const cost = { id: 'rent', name: 'Czynsz', costCenterId: 'JAG' as const, supplierNip: null, supplierName: null, expectedNetAmount: 1000, effectiveFrom: '2026-01', effectiveTo: null, active: true }
const basis = (center = 'JAG', net = 10000, gross = 12300): BreakEvenRevenueBasis => ({ id: center, year: 2026, month: 9, costCenterId: center, netAmount: net, grossAmountSnapshot: gross })
const source = (patch: Partial<BreakEvenSource> = {}): BreakEvenSource => ({ partId: 'p1', eventId: 'e1', sourceInvoiceId: 'i1', title: 'FV', supplierName: 'Supplier', supplierNip: null, costCenterId: 'JAG', grossAmount: 1230, netAmount: 1000, netEstimated: false, tags: ['fixed'], matchedFixedCostId: null, ...patch })
const input = (patch: Partial<BreakEvenCalculationInput> = {}): BreakEvenCalculationInput => ({ year: 2026, month: 9, margins: [margin], fixedCosts: [cost], matches: [], revenue: [{ costCenterId: 'JAG', amount: 12300 }], revenueBases: [basis()], sources: [], historicalSuggestion: { status: 'incomplete', margin: null, revenueNet: 0, purchasesNet: 0, months: [], warnings: [] }, warningSummary: { plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] }, ...patch })
const match = { id: 'm1', fixedCostId: 'rent', year: 2026, month: 9, costEventPartId: 'p1', costCenterId: 'JAG', actualNetAmount: null }

describe('break-even explicit company margin and selected costs', () => {
  it('uses shared manual margin as of month, ignoring later settings', () => {
    const future = { ...margin, id: 'future', margin: 0.9, effectiveFrom: '2026-10-01T00:00:00Z' }
    expect(resolveBreakEvenMargin([future, margin], '2026-09')).toEqual(margin)
    const result = calculateBreakEven(input({ margins: [future, margin], fixedCosts: [cost, { ...cost, id: 'pul', costCenterId: 'PUL', expectedNetAmount: 2000 }] }))
    expect(result.byCostCenter.JAG.targetNet).toBe(2500)
    expect(result.byCostCenter.PUL.targetNet).toBe(5000)
    expect(result.byCostCenter.JAG.hr).toEqual({ status: 'missing', amount: null })
    expect(result.byCostCenter.JAG.status).toBe('provisional')
  })
  it('includes expected recurring cost before invoice and completely replaces it with actual', () => {
    const before = calculateBreakEven(input()).byCostCenter.JAG
    expect(before.expectedFixedNet).toBe(1000)
    const after = calculateBreakEven(input({ sources: [source({ netAmount: 1200 })], matches: [match] })).byCostCenter.JAG
    expect(after.fixedNet).toBe(1200)
    expect(after.expectedFixedNet).toBe(0)
    expect(after.actualFixedNet).toBe(1200)
    expect(after.omittedFixedCount).toBe(0)
  })
  it('sums multiple matched invoices and negative corrections once', () => {
    const result = calculateBreakEven(input({ sources: [source(), source({ partId: 'refund', netAmount: -100, grossAmount: -123 })], matches: [match, { ...match, id: 'm2', costEventPartId: 'refund' }] })).byCostCenter.JAG
    expect(result.fixedNet).toBe(900)
    expect(result.fixedCosts[0].status).toBe('actual')
  })
  it('accepts exact override for proportional VAT part without silently changing raw source', () => {
    const result = calculateBreakEven(input({ sources: [source({ netEstimated: true, netAmount: 800 })], matches: [{ ...match, actualNetAmount: 900 }] })).byCostCenter.JAG
    expect(result.actualFixedNet).toBe(900)
    expect(result.fixedCosts[0].netEstimated).toBe(false)
  })
  it('rejects a variable-tagged part as a fixed match', () => {
    const result = calculateBreakEven(input({ sources: [source({ tags: ['variable'] })], matches: [match] })).byCostCenter.JAG
    expect(result.variableNet).toBe(1000)
    expect(result.fixedCosts[0].status).toBe('invalid')
    expect(result.targetNet).toBeNull()
  })
  it('uses observed variable separately and does not subtract goods or cogs again', () => {
    const result = calculateBreakEven(input({ sources: [source({ tags: ['goods', 'variable'], netAmount: 6000 }), source({ partId: 'var', tags: ['variable'], netAmount: 200 }), source({ partId: 'one', tags: ['one-off'], netAmount: 100 }), source({ partId: 'salary', tags: ['payroll', 'variable'], netAmount: 1000 })] })).byCostCenter.JAG
    expect(result.variableNet).toBe(200)
    expect(result.targetNet).toBe(3000)
    expect(result.fixedOnlyTargetNet).toBe(2500)
    expect(result.targetGross).toBe(3690)
    expect(result.operatingResultNet).toBe(2800)
    expect(result.goodsNet).toBe(6000)
  })
  it('does not add unselected fixed costs and flags omitted/unclassified/GLOBAL sources', () => {
    const report = calculateBreakEven(input({ sources: [source(), source({ partId: 'unknown', tags: [] }), source({ partId: 'global', costCenterId: 'GLOBAL' })] }))
    expect(report.byCostCenter.JAG.fixedNet).toBe(1000)
    expect(report.byCostCenter.JAG.omittedFixedNet).toBe(1000)
    expect(report.byCostCenter.JAG.warnings.join(' ')).toContain('bez klasyfikacji')
    expect(report.warnings.join(' ')).toContain('GLOBAL')
  })
  it('ignores inactive, future and expired templates', () => {
    const result = calculateBreakEven(input({ fixedCosts: [{ ...cost, active: false }, { ...cost, id: 'future', effectiveFrom: '2026-10' }, { ...cost, id: 'expired', effectiveTo: '2026-08' }] })).byCostCenter.JAG
    expect(result.fixedCosts).toEqual([])
    expect(result.targetNet).toBeNull()
  })
  it('blocks stale gross snapshot, but keeps provisional NET target available', () => {
    const result = calculateBreakEven(input({ revenueBases: [basis('JAG', 10000, 12299)] })).byCostCenter.JAG
    expect(result.revenueNet).toBeNull()
    expect(result.targetNet).toBe(2500)
    expect(result.targetGross).toBeNull()
    expect(result.deltaGross).toBeNull()
    expect(result.operatingResultNet).toBeNull()
  })
  it('invalidates a net basis after a one-grosz gross revenue change', () => {
    const result = calculateBreakEven(input({ revenue: [{ costCenterId: 'JAG', amount: 12300.01 }] })).byCostCenter.JAG
    expect(result.revenueNet).toBeNull()
    expect(result.targetGross).toBeNull()
    expect(result.deltaGross).toBeNull()
    expect(result.warnings.join(' ')).toContain('Obrót brutto zmienił się')
  })
  it('warns about manually matched unclassified costs without claiming they were excluded', () => {
    const result = calculateBreakEven(input({ sources: [source({ tags: ['rent'] })], matches: [match] })).byCostCenter.JAG
    expect(result.actualFixedNet).toBe(1000)
    expect(result.fixedCosts[0].status).toBe('actual')
    expect(result.warnings.join(' ')).toContain('nie ma potwierdzonej klasyfikacji')
    expect(result.warnings.join(' ')).not.toContain('Nie są uwzględnione w progu')
  })
  it('does not fabricate gross VAT basis with zero or missing turnover', () => {
    const result = calculateBreakEven(input({ revenue: [{ costCenterId: 'JAG', amount: 0 }], revenueBases: [basis('JAG', 0, 0)] })).byCostCenter.JAG
    expect(result.revenueNet).toBe(0)
    expect(result.targetNet).toBe(2500)
    expect(result.targetGross).toBeNull()
  })
  it('blocks target with missing variable net or invalid invoice match', () => {
    expect(calculateBreakEven(input({ sources: [source({ tags: ['variable'], netAmount: null })] })).byCostCenter.JAG.targetNet).toBeNull()
    const broken = calculateBreakEven(input({ matches: [match] })).byCostCenter.JAG
    expect(broken.fixedCosts[0].status).toBe('invalid')
    expect(broken.fixedNet).toBe(1000)
    expect(broken.targetNet).toBeNull()
  })
  it('does not infer a margin from historical suggestion', () => {
    const report = calculateBreakEven(input({ margins: [], historicalSuggestion: { status: 'available', margin: 0.4, revenueNet: 10000, purchasesNet: 6000, months: [], warnings: [] } }))
    expect(report.margin).toBeNull()
    expect(report.byCostCenter.JAG.targetNet).toBeNull()
  })
})

describe('historical purchase based indicative margin', () => {
  const months = () => ['2026-06', '2026-07', '2026-08'].map((period) => ({ period, revenue: [{ costCenterId: 'JAG', amount: 12300 }, { costCenterId: 'PUL', amount: 12300 }], bases: [basis(), basis('PUL')], sources: [source({ tags: ['goods'], netAmount: 12000, costCenterId: 'GLOBAL' })], warnings: [] }))
  it('weights revenue and all purchases across company including GLOBAL', () => {
    const result = calculateHistoricalSuggestion(months())
    expect(result.status).toBe('available')
    expect(result.margin).toBe(0.4)
    expect(result.purchasesNet).toBe(36000)
  })
  it('refuses silent 100% when no purchase classifications and missing net sources', () => {
    const rows = months(); rows[0].sources = []
    expect(calculateHistoricalSuggestion(rows).margin).toBeNull()
    rows[0].sources = [source({ tags: ['goods'], netAmount: null })]
    expect(calculateHistoricalSuggestion(rows).margin).toBeNull()
  })
  it('does not suggest from stale revenue or unconverted invoice warnings', () => {
    const rows = months(); rows[0].bases[0].grossAmountSnapshot = 1
    expect(calculateHistoricalSuggestion(rows).status).toBe('incomplete')
    const unconverted = months(); unconverted[0].warnings = ['EUR bez przeliczenia']
    expect(calculateHistoricalSuggestion(unconverted).margin).toBeNull()
  })
})

describe('period validation', () => {
  it.each(['year=NaN&month=1', 'year=2026&month=13', 'year=2026&month=1.5', 'year=&month=1'])('rejects %s', (query) => expect(parseBreakEvenPeriod(new URLSearchParams(query))).toBeNull())
})
