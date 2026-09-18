import { describe, expect, it } from 'vitest'
import {
  INVOICE_APPROVAL_MAX_AMOUNT,
  validateInvoiceApproval,
} from '@/lib/invoice-import/approval-policy'

const validPlnDraft = {
  documentType: 'INVOICE' as const,
  supplierName: 'Dostawca Sp. z o.o.',
  taxId: 'PL 123-456-78-90',
  invoiceNumber: 'FV/04/2026',
  issueDate: '2026-04-01',
  dueDate: null,
  currency: 'PLN',
  gross: 123,
  net: 100,
  vat: 23,
  bankAccount: null,
  paymentStatus: 'UNPAID' as const,
  paidAt: null,
  costCenterId: 'JAG' as const,
  tagIds: ['materials'],
  notes: null,
}

describe('invoice import approval policy', () => {
  it('rejects structured rate source precision that approval normalization would change', () => {
    const result = validateInvoiceApproval({ ...validPlnDraft, currency: 'EUR', gross: 10.005, net: null, vat: null,
      conversion: { mode: 'MANUAL_RATE', rate: '4.25', paymentDate: null, rateDate: null, tableNumber: null },
      reportingGross: 42.52, conversionConfirmed: true, conversionNote: 'Ręczny kurs 4.25',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EUR_AMOUNT_PRECISION', messagePolish: expect.stringContaining('grosz') }))
  })
  it('validates structured rate arithmetic independently and supports manual amounts', () => {
    const conversion = { mode: 'MANUAL_RATE', paymentDate: null, rate: '4.25', rateDate: null, tableNumber: null }
    const data = { ...validPlnDraft, currency: 'EUR', gross: 100, net: null, vat: null, conversion, reportingGross: 425, conversionConfirmed: true, conversionNote: 'Kurs ręczny 4.25' }
    expect(validateInvoiceApproval(data).ok).toBe(true)
    for (const patch of [{ reportingGross: 424.99 }, { paidAt: '2026-09-14' }, { currency: 'PLN' }]) {
      const result = validateInvoiceApproval({ ...data, ...patch })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain('INVALID_EUR_CONVERSION')
    }
    expect(validateInvoiceApproval({ ...data, reportingGross: 410, conversion: { ...conversion, mode: 'MANUAL_AMOUNT', rate: null } }).ok).toBe(true)
  })
  it('approves a complete PLN invoice at the cutover boundary', () => {
    expect(validateInvoiceApproval(validPlnDraft)).toEqual({
      ok: true,
      data: validPlnDraft,
      reporting: { gross: 123, net: 100, vat: 23 },
    })
  })

  function issueCodes(input: unknown): string[] {
    const result = validateInvoiceApproval(input)
    expect(result.ok).toBe(false)
    if (result.ok) return []
    expect(result.issues.every((issue) => issue.messagePolish.trim().length > 0)).toBe(true)
    return result.issues.map((issue) => issue.code)
  }

  it.each([
    ['CORRECTION', 'CORRECTION_UNSUPPORTED'],
    ['CREDIT_NOTE', 'CREDIT_NOTE_UNSUPPORTED'],
    ['PROFORMA', 'PROFORMA_UNSUPPORTED'],
    ['OTHER', 'OTHER_DOCUMENT_UNSUPPORTED'],
  ] as const)('blocks document type %s with its specific issue code', (documentType, code) => {
    expect(issueCodes({ ...validPlnDraft, documentType })).toContain(code)
  })

  it('requires an explicit INVOICE document type and does not accept null or absence', () => {
    expect(issueCodes({ ...validPlnDraft, documentType: null })).toContain('DOCUMENT_TYPE_REQUIRED')
    const withoutDocumentType: Record<string, unknown> = { ...validPlnDraft }
    Reflect.deleteProperty(withoutDocumentType, 'documentType')
    expect(issueCodes(withoutDocumentType)).toContain('DOCUMENT_TYPE_REQUIRED')
  })

  it('rejects dates before 2026-04-01 while accepting the exact boundary', () => {
    expect(issueCodes({ ...validPlnDraft, issueDate: '2026-03-31' })).toContain(
      'ISSUE_DATE_BEFORE_CUTOVER',
    )
    expect(validateInvoiceApproval({ ...validPlnDraft, issueDate: '2026-04-01' }).ok).toBe(true)
  })

  it.each([
    ['supplierName', null, 'SUPPLIER_NAME_REQUIRED'],
    ['invoiceNumber', null, 'INVOICE_NUMBER_REQUIRED'],
    ['issueDate', null, 'ISSUE_DATE_REQUIRED'],
    ['currency', null, 'CURRENCY_REQUIRED'],
    ['gross', null, 'GROSS_REQUIRED'],
    ['paymentStatus', null, 'PAYMENT_STATUS_REQUIRED'],
    ['costCenterId', null, 'COST_CENTER_REQUIRED'],
    ['tagIds', [], 'TAG_REQUIRED'],
  ] as const)('requires known approval field %s', (field, value, code) => {
    expect(issueCodes({ ...validPlnDraft, [field]: value })).toContain(code)
  })

  it('requires absent approval fields instead of filling them', () => {
    for (const [field, code] of [
      ['supplierName', 'SUPPLIER_NAME_REQUIRED'],
      ['invoiceNumber', 'INVOICE_NUMBER_REQUIRED'],
      ['issueDate', 'ISSUE_DATE_REQUIRED'],
      ['currency', 'CURRENCY_REQUIRED'],
      ['gross', 'GROSS_REQUIRED'],
      ['paymentStatus', 'PAYMENT_STATUS_REQUIRED'],
      ['costCenterId', 'COST_CENTER_REQUIRED'],
      ['tagIds', 'TAG_REQUIRED'],
    ] as const) {
      const input = { ...validPlnDraft } as Record<string, unknown>
      delete input[field]
      expect(issueCodes(input)).toContain(code)
    }
  })

  it('rejects malformed values through the strict draft contract without coercing strings', () => {
    expect(issueCodes({ ...validPlnDraft, currency: 'pln' })).toContain('INVALID_CURRENCY')
    expect(issueCodes({ ...validPlnDraft, gross: '' })).toContain('INVALID_AMOUNT')
    expect(issueCodes({ ...validPlnDraft, issueDate: '2026-02-31' })).toContain('INVALID_ISSUE_DATE')
    expect(issueCodes({ ...validPlnDraft, extraBusinessValue: 10 })).toContain('INVALID_DRAFT')
  })

  it('accepts explicit zero, rejects negative amounts separately, and rejects non-finite amounts', () => {
    expect(validateInvoiceApproval({ ...validPlnDraft, gross: 0, net: 0, vat: 0 }).ok).toBe(true)

    for (const field of ['gross', 'net', 'vat'] as const) {
      expect(issueCodes({ ...validPlnDraft, net: null, vat: null, [field]: -0.01 })).toContain(
        'NEGATIVE_AMOUNT',
      )
    }
    expect(issueCodes({ ...validPlnDraft, gross: Number.POSITIVE_INFINITY })).toContain(
      'INVALID_AMOUNT',
    )
  })

  it('bounds every authoritative nominal amount to safe integer cents', () => {
    const atLimit = validateInvoiceApproval({
      ...validPlnDraft,
      gross: INVOICE_APPROVAL_MAX_AMOUNT,
      net: null,
      vat: null,
    })
    expect(atLimit).toMatchObject({
      ok: true,
      data: { gross: INVOICE_APPROVAL_MAX_AMOUNT, net: null, vat: null },
      reporting: { gross: INVOICE_APPROVAL_MAX_AMOUNT, net: null, vat: null },
    })
    expect(issueCodes({
      ...validPlnDraft,
      gross: INVOICE_APPROVAL_MAX_AMOUNT + 1,
      net: null,
      vat: null,
    })).toContain('AMOUNT_OUT_OF_RANGE')
    expect(issueCodes({
      ...validPlnDraft,
      gross: 100,
      net: INVOICE_APPROVAL_MAX_AMOUNT + 1,
      vat: null,
    })).toContain('AMOUNT_OUT_OF_RANGE')
  })

  it('normalizes authoritative nominal data and reporting consistently to cents', () => {
    const result = validateInvoiceApproval({ ...validPlnDraft, gross: 1.005, net: 0.335, vat: 0.67 })
    expect(result).toMatchObject({
      ok: true,
      data: { gross: 1.01, net: 0.34, vat: 0.67 },
      reporting: { gross: 1.01, net: 0.34, vat: 0.67 },
    })
  })

  it.each([
    [10.075, 8.055, 2.02, 10.08, 8.06, 2.02],
    [100.005, 80.005, 20, 100.01, 80.01, 20],
  ] as const)(
    'rounds human decimal %s half-up and uses the same cents for data, reporting, and arithmetic',
    (gross, net, vat, expectedGross, expectedNet, expectedVat) => {
      const result = validateInvoiceApproval({ ...validPlnDraft, gross, net, vat })
      expect(result).toMatchObject({
        ok: true,
        data: { gross: expectedGross, net: expectedNet, vat: expectedVat },
        reporting: { gross: expectedGross, net: expectedNet, vat: expectedVat },
      })
    },
  )

  it('returns a normalized copy without mutating the input object', () => {
    const input = { ...validPlnDraft, gross: 10.075, net: 8.055, vat: 2.02 }
    const before = structuredClone(input)

    const result = validateInvoiceApproval(input)

    expect(input).toEqual(before)
    expect(result).toMatchObject({
      ok: true,
      data: { gross: 10.08, net: 8.06, vat: 2.02 },
    })
    if (result.ok) expect(result.data).not.toBe(input)
  })

  it('allows a one-cent nominal rounding difference and rejects a larger difference', () => {
    expect(validateInvoiceApproval({ ...validPlnDraft, gross: 100, net: 80, vat: 19.99 }).ok).toBe(true)
    expect(issueCodes({ ...validPlnDraft, gross: 100, net: 80, vat: 19.98 })).toContain(
      'NOMINAL_AMOUNT_MISMATCH',
    )
  })

  it('keeps optional unknowns null or absent and never replaces them with zero', () => {
    const withoutNetVat: Record<string, unknown> = { ...validPlnDraft }
    Reflect.deleteProperty(withoutNetVat, 'net')
    Reflect.deleteProperty(withoutNetVat, 'vat')
    const absent = validateInvoiceApproval(withoutNetVat)
    expect(absent).toMatchObject({ ok: true, reporting: { gross: 123, net: null, vat: null } })
    if (absent.ok) {
      expect('net' in absent.data).toBe(false)
      expect('vat' in absent.data).toBe(false)
    }

    const explicitNull = validateInvoiceApproval({ ...validPlnDraft, net: null, vat: null })
    expect(explicitNull).toMatchObject({
      ok: true,
      data: { net: null, vat: null, dueDate: null, paidAt: null, bankAccount: null, notes: null },
      reporting: { gross: 123, net: null, vat: null },
    })
  })

  it('uses only nominal amounts for PLN and ignores stale FX reporting fields', () => {
    expect(validateInvoiceApproval({
      ...validPlnDraft,
      reportingGross: -999,
      reportingNet: 1,
      reportingVat: 998,
      conversionConfirmed: true,
      conversionNote: 'stare przeliczenie',
    })).toMatchObject({
      ok: true,
      reporting: { gross: 123, net: 100, vat: 23 },
    })
  })

  it('requires honest explicit payment status but accepts UNKNOWN', () => {
    expect(validateInvoiceApproval({ ...validPlnDraft, paymentStatus: 'UNKNOWN' })).toMatchObject({
      ok: true,
      data: { paymentStatus: 'UNKNOWN' },
    })
  })

  it('does not invent paidAt when a paid invoice has no payment date', () => {
    const withoutPaidAt: Record<string, unknown> = { ...validPlnDraft }
    Reflect.deleteProperty(withoutPaidAt, 'paidAt')
    const result = validateInvoiceApproval({ ...withoutPaidAt, paymentStatus: 'PAID' })
    expect(result.ok).toBe(true)
    if (result.ok) expect('paidAt' in result.data).toBe(false)
  })

  it('preserves an optional foreign tax ID with all letters', () => {
    expect(validateInvoiceApproval({ ...validPlnDraft, taxId: 'DEabc-123XZ' })).toMatchObject({
      ok: true,
      data: { taxId: 'DEabc-123XZ' },
    })
  })

  it('preserves a separator-only raw tax ID in approved storage data', () => {
    expect(validateInvoiceApproval({ ...validPlnDraft, taxId: '---' })).toMatchObject({
      ok: true,
      data: { taxId: '---' },
    })
  })

  it('requires explicit conversion confirmation, reporting gross, and a meaningful note for FX', () => {
    const foreign = {
      ...validPlnDraft,
      currency: 'EUR',
      conversionConfirmed: true,
      reportingGross: 500,
      conversionNote: 'Wyciąg bankowy',
    }
    expect(issueCodes({ ...foreign, conversionConfirmed: false })).toContain('FX_CONFIRMATION_REQUIRED')
    expect(issueCodes({ ...foreign, reportingGross: null })).toContain('REPORTING_GROSS_REQUIRED')
    expect(issueCodes({ ...foreign, conversionNote: ' x ' })).toContain('CONVERSION_NOTE_REQUIRED')
  })

  it('accepts explicit zero FX reporting gross and keeps missing reporting net/VAT null', () => {
    expect(validateInvoiceApproval({
      ...validPlnDraft,
      currency: 'EUR',
      conversionConfirmed: true,
      reportingGross: 0,
      conversionNote: 'Kurs banku',
    })).toMatchObject({
      ok: true,
      reporting: { gross: 0, net: null, vat: null },
    })
  })

  it('validates supplied foreign reporting amounts and their arithmetic independently', () => {
    const foreign = {
      ...validPlnDraft,
      currency: 'EUR',
      conversionConfirmed: true,
      reportingGross: 430.005,
      reportingNet: 350.004,
      reportingVat: 80.001,
      conversionNote: 'Kurs banku',
    }
    expect(validateInvoiceApproval(foreign)).toMatchObject({
      ok: true,
      data: { reportingGross: 430.01, reportingNet: 350, reportingVat: 80 },
      reporting: { gross: 430.01, net: 350, vat: 80 },
    })
    expect(issueCodes({ ...foreign, reportingNet: -1, reportingVat: null })).toContain('NEGATIVE_AMOUNT')
    expect(issueCodes({ ...foreign, reportingGross: 430, reportingNet: 350, reportingVat: 79.98 })).toContain(
      'REPORTING_AMOUNT_MISMATCH',
    )
  })
})
