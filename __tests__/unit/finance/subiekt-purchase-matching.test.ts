import { describe, expect, it } from 'vitest'
import type { PurchaseDocument } from '@/lib/finance/subiekt-bridge-client'
import {
  isForeignPurchase, matchPurchases, numberKey, reconcilePayments, subiektExternalId, type AppInvoiceForMatch,
} from '@/lib/finance/subiekt-purchase-matching'

const doc = (over: Partial<PurchaseDocument> = {}): PurchaseDocument => ({
  id: 30, type: 'FZ', number: 'FZ 1/MAG/10/2026', original_number: 'RE-2026-0042', issued_at: '2026-10-03', parent_id: null,
  supplier_name: 'Tapeten Fabrik GmbH', supplier_tax_id: 'DE123456789', currency: 'EUR', exchange_rate: 4.25,
  net_total: 4250, gross_total: 4250, ksef_number: null, payable: 4250, remaining: 4250, is_paid: false, due_date: '2026-10-17', ...over,
})
const inv = (over: Partial<AppInvoiceForMatch> = {}): AppInvoiceForMatch => ({
  id: 'inv-1', externalId: null, supplierNip: 'DE 123 456 789', invoiceNumber: 're-2026-0042', paymentStatus: 'UNPAID', paidAt: null,
  plnGross: 4250, documentStatus: 'ACTIVE', issueDate: '2026-10-03', supplierName: 'Tapeten', ...over,
})

describe('isForeignPurchase', () => {
  it('should treat a EUR invoice as foreign', () => { expect(isForeignPurchase(doc())).toBe(true) })
  it('should treat a PLN invoice from a DE VAT id as foreign', () => { expect(isForeignPurchase(doc({ currency: 'PLN' }))).toBe(true) })
  it('should treat a PLN invoice with a digits-only NIP as domestic', () => { expect(isForeignPurchase(doc({ currency: 'PLN', supplier_tax_id: '5260000000' }))).toBe(false) })
  it('should treat a PL-prefixed NIP in PLN as domestic', () => { expect(isForeignPurchase(doc({ currency: 'PLN', supplier_tax_id: 'PL 526-000-00-00' }))).toBe(false) })
  it('should treat a Polish 10-digit NIP in EUR as domestic (arrives via KSeF)', () => { expect(isForeignPurchase(doc({ currency: 'EUR', supplier_tax_id: '526-000-00-00' }))).toBe(false) })
  it('should treat a EUR invoice without a tax id and without a KSeF number as foreign', () => { expect(isForeignPurchase(doc({ supplier_tax_id: null }))).toBe(true) })
  it('should never treat a document with a KSeF number as foreign', () => { expect(isForeignPurchase(doc({ ksef_number: '5260000000-20261003-ABCDEF-01' }))).toBe(false) })
  it('should treat a lowercase DE VAT id with spaces as foreign', () => { expect(isForeignPurchase(doc({ currency: 'PLN', supplier_tax_id: 'de 123 456 789' }))).toBe(true) })
})

describe('numberKey', () => {
  it('should ignore case and whitespace', () => { expect(numberKey(' re 2026-0042 ')).toBe('RE2026-0042') })
})

describe('matchPurchases', () => {
  it('should prefer the subiekt externalId over number matching', () => {
    const result = matchPurchases([doc()], [inv({ id: 'a' }), inv({ id: 'b', externalId: subiektExternalId(30), invoiceNumber: 'X' })])
    expect(result.pairs.map((p) => p.invoice.id)).toEqual(['b'])
  })

  it('should match a domestic invoice by its KSeF number', () => {
    const result = matchPurchases([doc({ ksef_number: 'K-1', original_number: 'FV 1' })], [inv({ id: 'k', externalId: 'K-1', invoiceNumber: 'other' })])
    expect(result.pairs[0]?.invoice.id).toBe('k')
  })

  it('should match a manually entered EU invoice by tax digits and original number', () => {
    expect(matchPurchases([doc()], [inv({ supplierNip: '123456789' })]).pairs).toHaveLength(1)
  })

  it('should report two candidate invoices as ambiguous instead of picking one', () => {
    const result = matchPurchases([doc()], [inv({ id: 'a' }), inv({ id: 'b' })])
    expect([result.pairs.length, result.ambiguous.map((a) => a.document.id)]).toEqual([0, [30]])
  })

  describe('number-only fallback (missing NIP)', () => {
    const ambiguousIds = (result: ReturnType<typeof matchPurchases>) => ({
      pairs: result.pairs.length, ambiguous: result.ambiguous.map((a) => [a.document.id, a.invoiceIds]), unmatched: result.unmatchedDocuments.length,
    })

    it('should report a document as ambiguous when an app invoice without NIP has the same number', () => {
      expect(ambiguousIds(matchPurchases([doc()], [inv({ id: 'm', supplierNip: null })]))).toEqual({ pairs: 0, ambiguous: [[30, ['m']]], unmatched: 0 })
    })

    it('should treat an empty-string NIP like a missing one', () => {
      expect(ambiguousIds(matchPurchases([doc()], [inv({ id: 'm', supplierNip: '' })])).ambiguous).toEqual([[30, ['m']]])
    })

    it('should report a document without tax id as ambiguous when any app invoice has the same number', () => {
      const ksef = inv({ id: 'k', externalId: '5260000000-20261003-ABCDEF-01', supplierNip: '5260000000' })
      expect(ambiguousIds(matchPurchases([doc({ supplier_tax_id: null })], [ksef]))).toEqual({ pairs: 0, ambiguous: [[30, ['k']]], unmatched: 0 })
    })

    it('should accept a number-only hit exactly 31 days apart', () => {
      expect(ambiguousIds(matchPurchases([doc()], [inv({ id: 'm', supplierNip: null, issueDate: '2026-11-03' })])).ambiguous).toEqual([[30, ['m']]])
    })

    it('should ignore a number-only hit more than 31 days apart', () => {
      expect(ambiguousIds(matchPurchases([doc()], [inv({ id: 'm', supplierNip: null, issueDate: '2026-09-01' })]))).toEqual({ pairs: 0, ambiguous: [], unmatched: 1 })
    })

    it('should ignore an app invoice with a different non-empty NIP when the document has a tax id', () => {
      expect(ambiguousIds(matchPurchases([doc()], [inv({ id: 'x', supplierNip: '5260000000' })]))).toEqual({ pairs: 0, ambiguous: [], unmatched: 1 })
    })

    it('should not use the fallback for a document without an original number', () => {
      expect(ambiguousIds(matchPurchases([doc({ supplier_tax_id: null, original_number: null })], [inv({ id: 'm', supplierNip: null, invoiceNumber: '' })])))
        .toEqual({ pairs: 0, ambiguous: [], unmatched: 1 })
    })

    it('should still pair by NIP and number when that match is unique', () => {
      const result = matchPurchases([doc()], [inv({ id: 'nip' }), inv({ id: 'no-nip', supplierNip: null })])
      expect([result.pairs.map((p) => p.invoice.id), result.ambiguous.length]).toEqual([['nip'], 0])
    })
  })

  it('should not reuse one app invoice for two Subiekt documents', () => {
    const result = matchPurchases([doc({ id: 30 }), doc({ id: 31 })], [inv()])
    expect([result.pairs.length, result.unmatchedDocuments.map((d) => d.id)]).toEqual([1, [31]])
  })
})

describe('reconcilePayments', () => {
  it('should list an invoice paid in the app but open in Subiekt as to be settled in Subiekt', () => {
    const result = reconcilePayments(matchPurchases([doc()], [inv({ paymentStatus: 'PAID', paidAt: '2026-10-15' })]), [])
    expect(result.settleInSubiekt.map((r) => r.document.number)).toEqual(['FZ 1/MAG/10/2026'])
  })

  it('should list an invoice paid in Subiekt but unpaid in the app separately', () => {
    const result = reconcilePayments(matchPurchases([doc({ remaining: 0, is_paid: true })], [inv()]), [])
    expect(result.paidOnlyInSubiekt).toHaveLength(1)
  })

  it('should skip documents without a liability (is_paid null)', () => {
    const result = reconcilePayments(matchPurchases([doc({ is_paid: null, remaining: null })], [inv({ paymentStatus: 'PAID' })]), [])
    expect([result.settleInSubiekt.length, result.paidOnlyInSubiekt.length]).toEqual([0, 0])
  })

  it('should flag a PLN amount difference above one grosz', () => {
    const result = reconcilePayments(matchPurchases([doc()], [inv({ paymentStatus: 'PAID', plnGross: 4249.5 })]), [])
    expect(result.settleInSubiekt[0]?.amountDiffers).toBe(true)
  })

  it('should list paid app invoices in the window with no Subiekt document, excluding cancelled ones', () => {
    const paidElsewhere = inv({ id: 'z', invoiceNumber: 'NOPE', paymentStatus: 'PAID' })
    const cancelled = inv({ id: 'c', invoiceNumber: 'GONE', paymentStatus: 'PAID', documentStatus: 'CANCELLED' })
    const result = reconcilePayments(matchPurchases([], [paidElsewhere, cancelled]), [paidElsewhere, cancelled])
    expect(result.paidInAppMissingInSubiekt.map((i) => i.id)).toEqual(['z'])
  })
})
