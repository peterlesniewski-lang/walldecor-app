import { describe, expect, it } from 'vitest'
import {
  INVOICE_AI_MERGE_FIELDS,
  INVOICE_ATTACHMENT_ALLOWED_MIME_TYPES,
  INVOICE_ATTACHMENT_MAX_BYTES,
  INVOICE_ATTACHMENT_MAX_PDF_PAGES,
  INVOICE_IMPORT_MAX_FILES,
  applyInvoiceAiFields,
  invoiceDraftDataSchema,
  invoiceManualFieldsSchema,
} from '@/lib/invoice-import/contracts'

const unknownInvoice = {
  documentType: null,
  supplierName: null,
  taxId: null,
  invoiceNumber: null,
  issueDate: null,
  dueDate: null,
  currency: null,
  gross: null,
  net: null,
  vat: null,
  bankAccount: null,
  paymentStatus: null,
  warnings: ['Unreadable document'],
}

describe('invoice import pure contracts', () => {
  it('exports the agreed upload limits and MIME allowlist', () => {
    expect({
      files: INVOICE_IMPORT_MAX_FILES,
      bytes: INVOICE_ATTACHMENT_MAX_BYTES,
      pdfPages: INVOICE_ATTACHMENT_MAX_PDF_PAGES,
      mimeTypes: INVOICE_ATTACHMENT_ALLOWED_MIME_TYPES,
    }).toEqual({
      files: 20,
      bytes: 10 * 1024 * 1024,
      pdfPages: 10,
      mimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    })
  })

  it('accepts a partial nullable draft without inventing missing values', () => {
    const parsed = invoiceDraftDataSchema.parse({
      taxId: 'DEabc-123XZ',
      gross: -123.45,
      paymentStatus: null,
      costCenterId: null,
      notes: null,
      conversionConfirmed: false,
    })

    expect(parsed).toEqual({
      taxId: 'DEabc-123XZ',
      gross: -123.45,
      paymentStatus: null,
      costCenterId: null,
      notes: null,
      conversionConfirmed: false,
    })
    expect('issueDate' in parsed).toBe(false)
  })

  it('rejects invalid dates, lowercase currency, non-finite amounts, and unknown fields', () => {
    for (const value of [
      { issueDate: '2026-02-31' },
      { dueDate: '2026-09-11T00:00:00.000Z' },
      { paidAt: '11-09-2026' },
      { currency: 'pln' },
      { gross: Number.POSITIVE_INFINITY },
      { commit: true },
    ]) {
      expect(invoiceDraftDataSchema.safeParse(value).success).toBe(false)
    }
  })

  it('keeps nullable and optional meanings distinct', () => {
    expect(invoiceDraftDataSchema.safeParse({}).success).toBe(true)
    expect(invoiceDraftDataSchema.safeParse({ supplierName: null, paidAt: null }).success).toBe(true)
    expect(invoiceDraftDataSchema.safeParse({ conversionConfirmed: null }).success).toBe(false)
    expect(invoiceDraftDataSchema.safeParse({ tagIds: null }).success).toBe(false)
  })

  it('accepts only unique, bounded draft field names as manual protection', () => {
    expect(invoiceManualFieldsSchema.parse(['supplierName', 'gross', 'costCenterId'])).toEqual([
      'supplierName',
      'gross',
      'costCenterId',
    ])
    expect(invoiceManualFieldsSchema.safeParse(['gross', 'gross']).success).toBe(false)
    expect(invoiceManualFieldsSchema.safeParse(['warnings']).success).toBe(false)
    expect(invoiceDraftDataSchema.safeParse({ tagIds: ['tag-a', 'tag-a'] }).success).toBe(false)
    expect(invoiceDraftDataSchema.safeParse({ tagIds: ['x'.repeat(192)] }).success).toBe(false)
  })

  it('turns all explicit AI unknowns into null draft values without copying warnings', () => {
    expect(applyInvoiceAiFields({}, [], unknownInvoice)).toEqual({
      documentType: null,
      supplierName: null,
      taxId: null,
      invoiceNumber: null,
      issueDate: null,
      dueDate: null,
      currency: null,
      gross: null,
      net: null,
      vat: null,
      bankAccount: null,
      paymentStatus: null,
    })
  })

  it('merges only the twelve unprotected AI fields and preserves explicit manual clears', () => {
    const current = {
      supplierName: null,
      gross: -50,
      costCenterId: 'JAG' as const,
      tagIds: ['tag-labor'],
      notes: 'Checked by admin',
      reportingGross: 215,
      conversionNote: 'Bank statement rate',
      conversionConfirmed: false,
    }
    const aiResult = {
      ...unknownInvoice,
      supplierName: 'AI Supplier',
      taxId: 'FRABc9XZ',
      gross: 200,
      currency: 'EUR',
    }

    expect(INVOICE_AI_MERGE_FIELDS).toEqual([
      'documentType', 'supplierName', 'taxId', 'invoiceNumber', 'issueDate', 'dueDate',
      'currency', 'gross', 'net', 'vat', 'bankAccount', 'paymentStatus',
    ])
    expect(applyInvoiceAiFields(current, ['supplierName', 'gross'], aiResult)).toMatchObject({
      supplierName: null,
      gross: -50,
      taxId: 'FRABc9XZ',
      currency: 'EUR',
      costCenterId: 'JAG',
      tagIds: ['tag-labor'],
      notes: 'Checked by admin',
      reportingGross: 215,
      conversionNote: 'Bank statement rate',
      conversionConfirmed: false,
    })
  })

  it('rejects AI attempts to provide manual-only classification or FX fields', () => {
    expect(() => applyInvoiceAiFields({}, [], { ...unknownInvoice, costCenterId: 'PUL' })).toThrow()
    expect(() => applyInvoiceAiFields({}, [], { ...unknownInvoice, reportingGross: 100 })).toThrow()
  })

  it('rejects unknown current draft data instead of silently dropping it', () => {
    expect(() => applyInvoiceAiFields({ unknown: 'value' }, [], unknownInvoice)).toThrow()
  })
})
