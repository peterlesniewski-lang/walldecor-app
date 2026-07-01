import { describe, expect, it } from 'vitest'
import {
  buildActualEntryFromKsefInvoice,
  findMatchingSupplierRule,
  normalizeSupplierNip,
  supplierMatchesRule,
} from '@/lib/finance/ksef-inbox'
import {
  KsefInvoiceCreateSchema,
  KsefInvoiceCurrencyConversionSchema,
  KsefInvoicePaymentSchema,
  KsefInvoiceQuerySchema,
} from '@/lib/validations/ksef-inbox'

describe('normalizeSupplierNip', () => {
  it('removes non-digit separators from a Polish NIP', () => {
    expect(normalizeSupplierNip('525-000-71-33')).toBe('5250007133')
    expect(normalizeSupplierNip(' PL 525 000 71 33 ')).toBe('5250007133')
  })
})

describe('KsefInvoiceCreateSchema', () => {
  it('accepts a valid manually entered supplier invoice', () => {
    const result = KsefInvoiceCreateSchema.safeParse({
      supplierName: 'Google Cloud Poland sp. z o.o.',
      supplierNip: '5250007133',
      invoiceNumber: 'FV/07/2026/1',
      issueDate: '2026-07-01',
      grossAmount: 1230,
      netAmount: 1000,
      vatAmount: 230,
      currency: 'PLN',
    })

    expect(result.success).toBe(true)
  })

  it('rejects an invoice without a supplier, valid date, or positive amount', () => {
    const result = KsefInvoiceCreateSchema.safeParse({
      supplierName: '',
      supplierNip: '',
      invoiceNumber: 'FV/07/2026/1',
      issueDate: '01-07-2026',
      grossAmount: 0,
      currency: 'PLN',
    })

    expect(result.success).toBe(false)
  })
})

describe('KsefInvoiceQuerySchema', () => {
  it('accepts pagination options for 50, 100, and 200 rows per page', () => {
    expect(KsefInvoiceQuerySchema.parse({ page: '2', pageSize: '100' })).toEqual({
      page: 2,
      pageSize: 100,
    })

    expect(KsefInvoiceQuerySchema.safeParse({ pageSize: '50' }).success).toBe(true)
    expect(KsefInvoiceQuerySchema.safeParse({ pageSize: '200' }).success).toBe(true)
  })

  it('accepts supplier search and gross amount range filters', () => {
    expect(KsefInvoiceQuerySchema.parse({
      search: '  525-000-71-33  ',
      amountMin: '100.50',
      amountMax: '500',
    })).toEqual({
      page: 1,
      pageSize: 50,
      search: '525-000-71-33',
      amountMin: 100.5,
      amountMax: 500,
    })
  })

  it('accepts payment and payment deadline filters', () => {
    expect(KsefInvoiceQuerySchema.parse({
      paymentStatus: 'UNPAID',
      paymentDeadline: 'DUE_0_7',
      pageSize: '100',
    })).toMatchObject({
      paymentStatus: 'UNPAID',
      paymentDeadline: 'DUE_0_7',
      pageSize: 100,
    })
  })
})

describe('KsefInvoicePaymentSchema', () => {
  it('accepts paid status with optional due date', () => {
    expect(KsefInvoicePaymentSchema.parse({
      paymentStatus: 'PAID',
      paidAt: '2026-07-01T10:00:00.000Z',
      dueDate: '2026-07-15T00:00:00.000Z',
    })).toMatchObject({
      paymentStatus: 'PAID',
      paidAt: '2026-07-01T10:00:00.000Z',
      dueDate: '2026-07-15T00:00:00.000Z',
    })
  })
})

describe('KsefInvoiceCurrencyConversionSchema', () => {
  it('requires positive PLN gross amount and a conversion note', () => {
    expect(KsefInvoiceCurrencyConversionSchema.safeParse({
      reportingGrossAmount: 430,
      reportingNetAmount: 350,
      reportingVatAmount: 80,
      currencyConversionNote: 'EUR x 4.30',
    }).success).toBe(true)

    expect(KsefInvoiceCurrencyConversionSchema.safeParse({
      reportingGrossAmount: 0,
      currencyConversionNote: '',
    }).success).toBe(false)
  })
})

describe('findMatchingSupplierRule', () => {
  const rules = [
    {
      id: 'rule-name',
      supplierNamePattern: 'google',
      supplierNip: null,
      costCenterId: 'GLOBAL',
      subCategoryId: 'sub-google',
      active: true,
    },
    {
      id: 'rule-nip',
      supplierNamePattern: null,
      supplierNip: '5250007133',
      costCenterId: 'JAG',
      subCategoryId: 'sub-jag',
      active: true,
    },
  ]

  it('matches normalized supplier NIP before supplier name patterns', () => {
    const match = findMatchingSupplierRule(
      { supplierName: 'Google Cloud Poland', supplierNip: '525-000-71-33' },
      rules
    )

    expect(match?.id).toBe('rule-nip')
  })

  it('falls back to case-insensitive supplier name pattern matching', () => {
    const match = findMatchingSupplierRule(
      { supplierName: 'GOOGLE Ireland Ltd', supplierNip: '' },
      rules
    )

    expect(match?.id).toBe('rule-name')
  })

  it('checks whether one rule matches a supplier invoice', () => {
    expect(supplierMatchesRule(
      { supplierName: 'Decodore sp. z o.o.', supplierNip: '951-260-75-66' },
      {
        id: 'rule-decodore',
        supplierNamePattern: null,
        supplierNip: '9512607566',
        costCenterId: 'GLOBAL',
        subCategoryId: 'sub-goods',
        active: true,
      }
    )).toBe(true)
  })
})

describe('buildActualEntryFromKsefInvoice', () => {
  it('converts approved invoice data into a monthly actual-cost upsert payload', () => {
    const actual = buildActualEntryFromKsefInvoice({
      issueDate: new Date('2026-07-15T12:00:00.000Z'),
      grossAmount: 123.456,
      costCenterId: 'GLOBAL',
      subCategoryId: 'sub-cost',
    })

    expect(actual).toEqual({
      year: 2026,
      month: 7,
      amount: 123.46,
      costCenterId: 'GLOBAL',
      subCategoryId: 'sub-cost',
    })
  })
})
