import { describe, expect, it } from 'vitest'
import { convertEurAmounts, parseCanonicalRate, invoiceEurConversionSchema } from '@/lib/invoice-import/eur-conversion'
import { invoiceDraftDataSchema, INVOICE_MANUAL_FIELD_NAMES, applyInvoiceAiFields } from '@/lib/invoice-import/contracts'

describe('exact EUR conversion', () => {
  it('roundtrips nullable conversion and protects metadata from AI', () => {
    const conversion = { mode: 'MANUAL_AMOUNT', paymentDate: null, rate: null, rateDate: null, tableNumber: null }
    expect(invoiceDraftDataSchema.parse({ conversion })).toEqual({ conversion })
    expect(invoiceDraftDataSchema.parse({ conversion: null })).toEqual({ conversion: null })
    expect(INVOICE_MANUAL_FIELD_NAMES).toContain('conversion')
    const extracted = { documentType: null, supplierName: null, taxId: null, invoiceNumber: null, issueDate: null, dueDate: null, currency: null, gross: null, net: null, vat: null, bankAccount: null, paymentStatus: null, warnings: [] }
    expect(applyInvoiceAiFields({ conversion }, ['conversion'], extracted).conversion).toEqual(conversion)
  })
  it('multiplies decimal values and rounds half up once to cents', () => {
    expect(convertEurAmounts({ gross: 360.20 }, '4.25')).toEqual({ reportingGross: 1530.85, reportingNet: null, reportingVat: null })
    expect(convertEurAmounts({ gross: '0.01', net: null, vat: '0' }, '4.255')).toEqual({ reportingGross: 0.04, reportingNet: null, reportingVat: 0 })
    expect(convertEurAmounts({ gross: '1.005' }, '1')).toHaveProperty('reportingGross', 1.01)
    expect(parseCanonicalRate('4.25000000')).toBe('4.25')
  })
  it.each(['0', '-1', 'NaN', 'Infinity', '4,25', '1e3', '10001', '1.123456789', ' 4.25', '04.25'])('rejects invalid rate %s', (rate) => {
    expect(() => parseCanonicalRate(rate)).toThrow()
  })
  it.each([-1, Infinity, NaN, Number.MAX_SAFE_INTEGER])('rejects invalid or unsafe amount %s', (gross) => {
    expect(() => convertEurAmounts({ gross }, '4.25')).toThrow()
  })
  it('accepts numeric scientific notation without accepting noncanonical string amounts and bounds the converted result', () => {
    expect(convertEurAmounts({ gross: 1e-7 }, '4.25').reportingGross).toBe(0)
    expect(() => convertEurAmounts({ gross: '1e-3' }, '4.25')).toThrow()
    expect(() => convertEurAmounts({ gross: 90_000_000_000_000 }, '10000')).toThrow()
  })
  it('requires complete source metadata and refuses invented fields', () => {
    const conversion = { mode: 'NBP', paymentDate: '2026-09-14', rate: '4.3228', rateDate: '2026-09-11', tableNumber: '177/A/NBP/2026' }
    expect(invoiceEurConversionSchema.safeParse(conversion).success).toBe(true)
    for (const patch of [{ rateDate: null }, { tableNumber: null }, { mode: 'MANUAL_AMOUNT' }, { secret: 'x' }, { rateDate: '2026-09-14' }]) {
      expect(invoiceEurConversionSchema.safeParse({ ...conversion, ...patch }).success).toBe(false)
    }
  })
})
