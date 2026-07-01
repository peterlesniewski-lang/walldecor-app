import { describe, expect, it } from 'vitest'
import { buildCostEventDraftFromKsefInvoice } from '@/lib/finance/cost-events'

describe('buildCostEventDraftFromKsefInvoice', () => {
  it('blocks non-PLN invoices until manual PLN conversion is provided', () => {
    expect(() => buildCostEventDraftFromKsefInvoice({
      id: 'inv-eur',
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
  })

  it('uses invoice-level classification when no parts exist', () => {
    const draft = buildCostEventDraftFromKsefInvoice({
      id: 'inv-1',
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
