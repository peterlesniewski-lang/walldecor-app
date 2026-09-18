import { describe, expect, it } from 'vitest'
import {
  invoiceBusinessIdentity,
  isPossibleInvoiceDuplicate,
  normalizeInvoiceNumberForComparison,
  normalizeSupplierNameForComparison,
  normalizeTaxIdForComparison,
} from '@/lib/invoice-import/identity'

describe('invoice import business identity', () => {
  it('keeps all foreign tax ID letters and digits while removing separators', () => {
    expect(normalizeTaxIdForComparison(' de-ABC 123.xZ/9 ')).toBe('DEABC123XZ9')
    expect(normalizeTaxIdForComparison('DE123')).not.toBe(normalizeTaxIdForComparison('FR123'))
  })

  it('treats an optional PL prefix followed by exactly ten digits as equivalent to Polish digits', () => {
    expect(normalizeTaxIdForComparison('PL 123-456-78-90')).toBe('1234567890')
    expect(normalizeTaxIdForComparison('1234567890')).toBe('1234567890')
    expect(normalizeTaxIdForComparison('PL123')).toBe('PL123')
  })

  it('normalizes supplier names without dropping collision-relevant punctuation', () => {
    expect(normalizeSupplierNameForComparison('  ACME,\tSp.   Z O.O.  ')).toBe('acme, sp. z o.o.')
    expect(normalizeSupplierNameForComparison('ＡＣＭＥ Sp. z o.o.')).toBe('acme sp. z o.o.')
    expect(normalizeSupplierNameForComparison('ACME, Ltd.')).not.toBe(
      normalizeSupplierNameForComparison('ACME Ltd'),
    )
    expect(normalizeSupplierNameForComparison('Straße GmbH')).toBe(
      normalizeSupplierNameForComparison('STRASSE GMBH'),
    )
  })

  it('normalizes invoice number case and whitespace but preserves slash, dash, and punctuation', () => {
    expect(normalizeInvoiceNumberForComparison('  ＦＶ /  12-A  ')).toBe('fv / 12-a')
    expect(normalizeInvoiceNumberForComparison('FV/12-A')).not.toBe(
      normalizeInvoiceNumberForComparison('FV-12-A'),
    )
  })

  it('builds canonical keys and retains an absent tax ID as null', () => {
    expect(invoiceBusinessIdentity({
      supplierName: '  ACME Sp. z o.o. ',
      taxId: null,
      invoiceNumber: ' FV/ 1 ',
      issueDate: '2026-04-01',
    })).toEqual({
      supplierNameKey: 'acme sp. z o.o.',
      taxIdKey: null,
      invoiceNumberKey: 'fv/ 1',
      issueDateKey: '2026-04-01',
    })
  })

  it('canonicalizes a separator-only raw tax ID to missing identity', () => {
    expect(invoiceBusinessIdentity({
      supplierName: 'ACME',
      taxId: '--- ...',
      invoiceNumber: 'FV/1',
      issueDate: '2026-04-01',
    }).taxIdKey).toBeNull()
  })

  it('matches the same date and number using equal present tax IDs', () => {
    const left = invoiceBusinessIdentity({
      supplierName: 'Supplier old name',
      taxId: 'PL 123-456-78-90',
      invoiceNumber: 'FV/1',
      issueDate: '2026-04-01',
    })
    const right = invoiceBusinessIdentity({
      supplierName: 'Supplier new name',
      taxId: '1234567890',
      invoiceNumber: 'fv/1',
      issueDate: '2026-04-01',
    })

    expect(isPossibleInvoiceDuplicate(left, right)).toBe(true)
  })

  it('falls back to equal supplier names when at least one tax ID is absent', () => {
    const withTaxId = invoiceBusinessIdentity({
      supplierName: ' ACME, GmbH ',
      taxId: 'DE123',
      invoiceNumber: 'INV-9',
      issueDate: '2026-08-20',
    })
    const withoutTaxId = invoiceBusinessIdentity({
      supplierName: 'acme,   gmbh',
      invoiceNumber: 'inv-9',
      issueDate: '2026-08-20',
    })

    expect(isPossibleInvoiceDuplicate(withTaxId, withoutTaxId)).toBe(true)
  })

  it('treats defensive empty canonical tax IDs as missing and falls back to supplier name', () => {
    const base = invoiceBusinessIdentity({
      supplierName: 'ACME',
      taxId: null,
      invoiceNumber: 'FV/10',
      issueDate: '2026-08-20',
    })
    const sameSupplier = { ...base, taxIdKey: '' }
    const differentSupplier = {
      ...base,
      supplierNameKey: normalizeSupplierNameForComparison('Other Supplier'),
      taxIdKey: '',
    }

    expect(isPossibleInvoiceDuplicate(sameSupplier, { ...base, taxIdKey: '' })).toBe(true)
    expect(isPossibleInvoiceDuplicate(sameSupplier, differentSupplier)).toBe(false)
  })

  it('does not conflate different present tax IDs even when supplier name matches', () => {
    const left = invoiceBusinessIdentity({
      supplierName: 'Same Supplier',
      taxId: 'DE123',
      invoiceNumber: 'INV/7',
      issueDate: '2026-07-10',
    })
    const right = invoiceBusinessIdentity({
      supplierName: 'same supplier',
      taxId: 'FR123',
      invoiceNumber: 'inv/7',
      issueDate: '2026-07-10',
    })

    expect(isPossibleInvoiceDuplicate(left, right)).toBe(false)
  })

  it('does not conflate dotless Turkish i with ASCII i in the no-tax-ID supplier fallback', () => {
    const ascii = invoiceBusinessIdentity({
      supplierName: 'BIL',
      taxId: null,
      invoiceNumber: 'FV/16',
      issueDate: '2026-07-10',
    })
    const dotless = invoiceBusinessIdentity({
      supplierName: 'BıL',
      taxId: null,
      invoiceNumber: 'FV/16',
      issueDate: '2026-07-10',
    })

    expect(isPossibleInvoiceDuplicate(ascii, dotless)).toBe(false)
  })

  it('does not conflate dotless Turkish i with ASCII i in invoice numbers', () => {
    const ascii = invoiceBusinessIdentity({
      supplierName: 'Same Supplier',
      taxId: null,
      invoiceNumber: 'BIL/16',
      issueDate: '2026-07-10',
    })
    const dotless = invoiceBusinessIdentity({
      supplierName: 'Same Supplier',
      taxId: null,
      invoiceNumber: 'BıL/16',
      issueDate: '2026-07-10',
    })

    expect(isPossibleInvoiceDuplicate(ascii, dotless)).toBe(false)
  })

  it('requires the same normalized date and invoice number before comparing supplier identity', () => {
    const base = invoiceBusinessIdentity({
      supplierName: 'ACME',
      taxId: null,
      invoiceNumber: 'FV/1',
      issueDate: '2026-04-01',
    })
    const otherNumber = invoiceBusinessIdentity({
      supplierName: 'ACME',
      taxId: null,
      invoiceNumber: 'FV-1',
      issueDate: '2026-04-01',
    })
    const otherDate = invoiceBusinessIdentity({
      supplierName: 'ACME',
      taxId: null,
      invoiceNumber: 'FV/1',
      issueDate: '2026-04-02',
    })

    expect(isPossibleInvoiceDuplicate(base, otherNumber)).toBe(false)
    expect(isPossibleInvoiceDuplicate(base, otherDate)).toBe(false)
  })
})
