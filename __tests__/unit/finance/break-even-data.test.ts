import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBreakEvenSources, loadBreakEvenReport, type BreakEvenEventInput } from '@/lib/finance/break-even-data'
const prismaMock = vi.hoisted(() => ({
  costEvent: { findMany: vi.fn() }, breakEvenFixedCostMatch: { findMany: vi.fn() }, breakEvenMarginSetting: { findMany: vi.fn() },
  breakEvenFixedCost: { findMany: vi.fn() }, breakEvenRevenueBasis: { findMany: vi.fn() }, revenue: { findMany: vi.fn() }, ksefInvoice: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
const event = (patch: Partial<BreakEvenEventInput> = {}): BreakEvenEventInput => ({ id: 'e', status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 1230, netAmount: 1000, vatAmount: 230, sourceInvoiceId: 'invoice', supplierName: 'Dostawca', supplierNip: '123', reference: 'FV1', sourceInvoice: { status: 'APPROVED', documentStatus: 'ACTIVE', invoiceImportDraft: null }, parts: [{ id: 'part', label: 'Czynsz', grossAmount: 1230, tags: [{ tag: { slug: 'fixed' } }], allocations: [{ costCenterId: 'JAG', percent: 100 }] }], ...patch })
const build = (events: BreakEvenEventInput[]) => buildBreakEvenSources(events, [], 2026, 9)

describe('source amounts and document scope', () => {
  it('uses approved normalized PLN for imported foreign invoices and preserves allocations', () => {
    // Approval has already converted original EUR into the CostEvent PLN amount.
    const foreign = event({ sourceInvoice: { status: 'APPROVED', documentStatus: 'ACTIVE', invoiceImportDraft: { state: 'APPROVED' } } })
    foreign.parts[0].allocations = [{ costCenterId: 'JAG', percent: 60 }, { costCenterId: 'PUL', percent: 40 }]
    const result = build([foreign])
    expect(result.sources.map((row) => row.netAmount)).toEqual([600, 400])
    expect(result.sources.map((row) => row.grossAmount)).toEqual([738, 492])
    expect(result.sources[0].netEstimated).toBe(false)
  })
  it('does not treat nominal EUR as PLN or include unapproved archived/cancelled documents', () => {
    const result = build([event({ currency: 'EUR' }), event({ status: 'VOID' }), event({ documentStatus: 'VOID' }), event({ sourceInvoice: { status: 'APPROVED', documentStatus: 'CANCELLED', invoiceImportDraft: null } }), event({ sourceInvoice: { status: 'APPROVED', documentStatus: 'ACTIVE', invoiceImportDraft: { state: 'ARCHIVED' } } }), event({ sourceInvoice: { status: 'MAPPED', documentStatus: 'ACTIVE', invoiceImportDraft: null } })])
    expect(result.sources).toEqual([])
    expect(result.warnings.join(' ')).toContain('PLN')
  })
  it('includes signed approved corrections and rejects inconsistent net', () => {
    const correction = event({ documentStatus: 'CORRECTION', grossAmount: -123, netAmount: -100, vatAmount: -23, parts: [{ ...event().parts[0], grossAmount: -123 }] })
    expect(build([correction]).sources[0].netAmount).toBe(-100)
    expect(build([event({ netAmount: 1300 })]).sources[0].netAmount).toBeNull()
    expect(build([event({ netAmount: -100 })]).sources[0].netAmount).toBeNull()
  })
  it('flags proportional net of mixed split parts instead of claiming exact VAT', () => {
    const split = event({ parts: [{ ...event().parts[0], grossAmount: 615 }, { ...event().parts[0], id: 'other', grossAmount: 615 }] })
    const result = build([split])
    expect(result.sources.map((row) => row.netAmount)).toEqual([500, 500])
    expect(result.sources.every((row) => row.netEstimated)).toBe(true)
  })
  it('does not guess VAT when both net and VAT are missing', () => {
    expect(build([event({ netAmount: null, vatAmount: null })]).sources[0].netAmount).toBeNull()
    expect(build([event({ netAmount: null })]).sources[0].netAmount).toBe(1000)
  })
  it('flags incomplete allocation and avoids undercounting into an apparently exact source', () => {
    const invalid = event(); invalid.parts[0].allocations[0].percent = 50
    expect(build([invalid]).sources).toEqual([])
    expect(build([invalid]).warnings.join(' ')).toContain('pełnej alokacji')
  })
})

describe('report data loading', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-18T12:00:00Z'))
    vi.clearAllMocks()
    Object.values(prismaMock).forEach((model) => model.findMany.mockResolvedValue([]))
    prismaMock.breakEvenMarginSetting.findMany.mockResolvedValue([{ id: 'margin', margin: 0.4, effectiveFrom: new Date('2026-01-01T00:00:00Z'), note: null }])
  })
  function completeHistory() {
    prismaMock.revenue.findMany.mockResolvedValue([{ costCenterId: 'JAG', amount: 1230 }, { costCenterId: 'PUL', amount: 1230 }])
    prismaMock.breakEvenRevenueBasis.findMany.mockImplementation(async ({ where }) => ['JAG', 'PUL'].map((costCenterId) => ({ id: costCenterId, ...where, costCenterId, netAmount: 1000, grossAmountSnapshot: 1230 })))
    prismaMock.costEvent.findMany.mockResolvedValue([event({ parts: [{ ...event().parts[0], tags: [{ tag: { slug: 'goods' } }] }] })])
    prismaMock.ksefInvoice.findMany.mockImplementation(async ({ where }) => [{ status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 1230, reportingGrossAmount: null, invoiceImportDraft: null, costEvent: { status: 'APPROVED', documentStatus: 'ACTIVE', eventDate: where.issueDate.gte } }])
  }
  it('makes a historical suggestion only when approved invoices have active costs in their month', async () => {
    completeHistory()
    const result = await loadBreakEvenReport(2026, 9)
    expect(result.report.historicalSuggestion.status).toBe('available')
    expect(result.report.historicalSuggestion.margin).toBe(0.5)
    expect(prismaMock.ksefInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ costEvent: { select: { status: true, documentStatus: true, eventDate: true } } }) }))
  })
  it.each([
    ['missing', null],
    ['voided status', { status: 'VOID', documentStatus: 'ACTIVE', eventDate: new Date('2026-07-01T00:00:00Z') }],
    ['cancelled document', { status: 'APPROVED', documentStatus: 'CANCELLED', eventDate: new Date('2026-07-01T00:00:00Z') }],
    ['another month', { status: 'APPROVED', documentStatus: 'ACTIVE', eventDate: new Date('2026-08-01T00:00:00Z') }],
  ])('blocks apparently complete history when an approved invoice cost is %s', async (_label, costEvent) => {
    completeHistory()
    prismaMock.ksefInvoice.findMany.mockImplementation(async ({ where }) => [
      { status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 1230, reportingGrossAmount: null, invoiceImportDraft: null, costEvent: { status: 'APPROVED', documentStatus: 'ACTIVE', eventDate: where.issueDate.gte } },
      ...(where.issueDate.gte.getUTCMonth() === 6 ? [{ status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 999, reportingGrossAmount: null, invoiceImportDraft: null, costEvent }] : []),
    ])
    const result = await loadBreakEvenReport(2026, 9)
    expect(result.report.historicalSuggestion.status).toBe('incomplete')
    expect(result.report.historicalSuggestion.margin).toBeNull()
    expect(result.report.historicalSuggestion.warnings).toContain('2026-07: Zatwierdzone faktury bez aktywnego kosztu w wybranym miesiącu: 1. Sprawdź powiązanie i datę kosztu.')
  })
  it('warns in the current report when an approved invoice has no reporting cost', async () => {
    completeHistory()
    prismaMock.ksefInvoice.findMany.mockImplementation(async ({ where }) => [{ status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 1230, reportingGrossAmount: null, invoiceImportDraft: null, costEvent: where.issueDate.gte.getUTCMonth() === 8 ? null : { status: 'APPROVED', documentStatus: 'ACTIVE', eventDate: where.issueDate.gte } }])
    const result = await loadBreakEvenReport(2026, 9)
    expect(result.report.warnings.join(' ')).toContain('Zatwierdzone faktury bez aktywnego kosztu')
    expect(result.report.historicalSuggestion.status).toBe('available')
  })
  it('retains PLN warning total and separates unconverted currencies within selected month', async () => {
    prismaMock.ksefInvoice.findMany.mockResolvedValue([
      { status: 'NEW', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 100, reportingGrossAmount: null, invoiceImportDraft: null },
      { status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'EUR', grossAmount: 20, reportingGrossAmount: null, invoiceImportDraft: null },
      { status: 'MAPPED', documentStatus: 'ACTIVE', currency: 'USD', grossAmount: 30, reportingGrossAmount: 120, invoiceImportDraft: { state: 'APPROVED' } },
      { status: 'NEW', documentStatus: 'CANCELLED', currency: 'PLN', grossAmount: 40, reportingGrossAmount: null, invoiceImportDraft: null },
      { status: 'NEW', documentStatus: 'ACTIVE', currency: 'GBP', grossAmount: 50, reportingGrossAmount: null, invoiceImportDraft: { state: 'ARCHIVED' } },
    ])
    const result = await loadBreakEvenReport(2026, 9)
    expect(result.report.warningSummary).toEqual({ plnAmount: 220, unconvertedCount: 1, unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }] })
    expect(result.settings.margins[0].effectiveFrom).toBe('2026-01')
    expect(prismaMock.ksefInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { issueDate: { gte: new Date('2026-09-01T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z') } } }))
    expect(result.report.historicalSuggestion.months).toEqual(['2026-06', '2026-07', '2026-08'])
  })
})
