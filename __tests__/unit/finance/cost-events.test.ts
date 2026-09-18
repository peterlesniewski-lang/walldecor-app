import { describe, expect, it } from 'vitest'
import { buildCostEventDraftFromKsefInvoice } from '@/lib/finance/cost-events'

describe('buildCostEventDraftFromKsefInvoice', () => {
  it('blocks non-PLN invoices until manual PLN conversion is provided', () => {
    expect(() => buildCostEventDraftFromKsefInvoice({
      id: 'inv-eur',
      source: 'KSEF',
      currency: 'EUR',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'SaaS Vendor',
      supplierNip: null,
      invoiceNumber: 'EUR/1',
      grossAmount: 100,
      netAmount: 100,
      vatAmount: 0,
      parts: [],
    })).toThrow('Faktura w walucie obcej wymaga ręcznego przeliczenia na PLN przed zatwierdzeniem.')
  })

  it('uses ADMIN-entered PLN reporting amounts for foreign-currency invoices', () => {
    const draft = buildCostEventDraftFromKsefInvoice({
      id: 'inv-eur',
      source: 'MANUAL',
      currency: 'EUR',
      originalCurrency: 'EUR',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'SaaS Vendor',
      supplierNip: null,
      invoiceNumber: 'EUR/1',
      grossAmount: 100,
      netAmount: 100,
      vatAmount: 0,
      reportingGrossAmount: 430,
      reportingNetAmount: 430,
      reportingVatAmount: 0,
      currencyConversionNote: 'EUR x 4.30',
      costCenterId: 'GLOBAL',
      subCategoryId: 'legacy-sub',
      parts: [],
    })

    expect(draft.currency).toBe('PLN')
    expect(draft.grossAmount).toBe(430)
    expect(draft.originalCurrency).toBe('EUR')
    expect(draft.originalGrossAmount).toBe(100)
    expect(draft.source).toBe('MANUAL')
    expect(draft.netAmount).toBe(430)
    expect(draft.vatAmount).toBe(0)
  })

  it('preserves KSEF as the source instead of guessing from the helper name', () => {
    const draft = buildCostEventDraftFromKsefInvoice({
      id: 'inv-ksef',
      source: 'KSEF',
      currency: 'PLN',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'Polish Supplier',
      supplierNip: '9462595618',
      invoiceNumber: 'KSEF/1',
      grossAmount: 123,
      netAmount: 100,
      vatAmount: 23,
      parts: [],
    })

    expect(draft.source).toBe('KSEF')
  })

  it('rejects an unknown source without replacing it with a default', () => {
    expect(() => buildCostEventDraftFromKsefInvoice({
      id: 'inv-unknown-source',
      source: 'EMAIL',
      currency: 'PLN',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'Supplier',
      supplierNip: null,
      invoiceNumber: 'EMAIL/1',
      grossAmount: 123,
      netAmount: 100,
      vatAmount: 23,
      parts: [],
    })).toThrow('Unsupported invoice source: EMAIL')
  })

  it.each([undefined, null])('keeps missing foreign-currency reporting net and VAT null instead of using nominal amounts (%s)', (reportingAmount) => {
    const draft = buildCostEventDraftFromKsefInvoice({
      id: 'inv-fx-partial',
      source: 'MANUAL',
      currency: 'EUR',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'Foreign Supplier',
      supplierNip: 'DEABC123',
      invoiceNumber: 'EUR/2',
      grossAmount: 100,
      netAmount: 81.3,
      vatAmount: 18.7,
      reportingGrossAmount: 430,
      reportingNetAmount: reportingAmount,
      reportingVatAmount: reportingAmount,
      parts: [],
    })

    expect(draft.netAmount).toBeNull()
    expect(draft.vatAmount).toBeNull()
  })

  it('retains explicit zero reporting net and VAT for a foreign-currency invoice', () => {
    const draft = buildCostEventDraftFromKsefInvoice({
      id: 'inv-fx-zero',
      source: 'MANUAL',
      currency: 'EUR',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'Foreign Supplier',
      supplierNip: null,
      invoiceNumber: 'EUR/3',
      grossAmount: -10,
      netAmount: -8,
      vatAmount: -2,
      reportingGrossAmount: -43,
      reportingNetAmount: 0,
      reportingVatAmount: 0,
      parts: [],
    })

    expect(draft.grossAmount).toBe(-43)
    expect(draft.netAmount).toBe(0)
    expect(draft.vatAmount).toBe(0)
  })

  it('uses nominal net and VAT fallback for PLN invoices', () => {
    const draft = buildCostEventDraftFromKsefInvoice({
      id: 'inv-pln',
      source: 'MANUAL',
      currency: 'PLN',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'Polish Supplier',
      supplierNip: null,
      invoiceNumber: 'PLN/1',
      grossAmount: 123,
      netAmount: 100,
      vatAmount: 23,
      parts: [],
    })

    expect(draft.netAmount).toBe(100)
    expect(draft.vatAmount).toBe(23)
  })

  it('uses invoice-level classification when no parts exist', () => {
    const draft = buildCostEventDraftFromKsefInvoice({
      id: 'inv-1',
      source: 'KSEF',
      currency: 'PLN',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'REMI',
      supplierNip: '9462595618',
      invoiceNumber: 'FV/1',
      grossAmount: 1000,
      netAmount: 813,
      vatAmount: 187,
      costCenterId: 'GLOBAL',
      subCategoryId: 'legacy-sub',
      parts: [],
    })

    expect(draft.parts).toEqual([
      {
        label: 'FV/1',
        grossAmount: 1000,
        tagIds: [],
        allocations: [{ costCenterId: 'GLOBAL', percent: 100, fallbackUsed: false }],
      },
    ])
  })
})
