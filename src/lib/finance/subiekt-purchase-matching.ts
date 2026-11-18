import type { PurchaseDocument } from '@/lib/finance/subiekt-bridge-client'
import { normalizeSupplierNip } from '@/lib/finance/ksef-inbox'

/** Pure matching between Subiekt GT purchase documents and app invoices. No I/O. */

export const SUBIEKT_SOURCE = 'SUBIEKT'
export const subiektExternalId = (documentId: number) => `subiekt:${documentId}`

export interface AppInvoiceForMatch {
  id: string
  externalId: string | null
  supplierName: string
  supplierNip: string | null
  invoiceNumber: string
  issueDate: string
  paymentStatus: string
  paidAt: string | null
  /** Amount in PLN used for reporting (reportingGrossAmount ?? grossAmount for PLN). */
  plnGross: number | null
  documentStatus: string
}

export const numberKey = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, '').toUpperCase()

function documentKey(taxId: string | null, number: string | null): string | null {
  const tax = normalizeSupplierNip(taxId)
  const num = numberKey(number)
  return tax && num ? `${tax}|${num}` : null
}

/**
 * Foreign = will never arrive via KSeF. A KSeF number or a Polish NIP (even on a EUR
 * invoice) means the document belongs to the KSeF flow and must not be imported twice.
 */
export function isForeignPurchase(document: Pick<PurchaseDocument, 'currency' | 'supplier_tax_id' | 'ksef_number'>): boolean {
  if (document.ksef_number) return false
  const taxId = (document.supplier_tax_id ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (/^[A-Z]{2}/.test(taxId) && !taxId.startsWith('PL')) return true
  if (/^(PL)?\d{10}$/.test(taxId)) return false
  return document.currency !== 'PLN'
}

export interface MatchedPair { document: PurchaseDocument; invoice: AppInvoiceForMatch; via: 'SUBIEKT_ID' | 'KSEF' | 'NUMBER' }

export interface MatchResult {
  pairs: MatchedPair[]
  ambiguous: Array<{ document: PurchaseDocument; invoiceIds: string[] }>
  unmatchedDocuments: PurchaseDocument[]
  matchedInvoiceIds: Set<string>
}

/** Max distance between issue dates for a number-only (no NIP) candidate. */
export const NUMBER_ONLY_MATCH_DAYS = 31
const DAY_MS = 24 * 60 * 60 * 1000
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS

export function matchPurchases(documents: PurchaseDocument[], invoices: AppInvoiceForMatch[]): MatchResult {
  const byExternalId = new Map<string, AppInvoiceForMatch>()
  const byKey = new Map<string, AppInvoiceForMatch[]>()
  const byNumber = new Map<string, AppInvoiceForMatch[]>()
  for (const invoice of invoices) {
    if (invoice.externalId) byExternalId.set(invoice.externalId, invoice)
    const key = documentKey(invoice.supplierNip, invoice.invoiceNumber)
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), invoice])
    const number = numberKey(invoice.invoiceNumber)
    if (number) byNumber.set(number, [...(byNumber.get(number) ?? []), invoice])
  }
  /**
   * Safety net when the NIP cannot be compared (document without tax digits, or an app invoice
   * entered without NIP): same number and issue dates ≤ 31 days apart. Such a hit is never paired
   * automatically — the owner rule is "when unsure, do not create" — so the document becomes ambiguous.
   * Already-paired invoices count too: a second document with the same number must not slip through.
   */
  const numberOnlyCandidates = (document: PurchaseDocument) => {
    const number = numberKey(document.original_number)
    if (!number) return []
    const documentHasTax = normalizeSupplierNip(document.supplier_tax_id) !== ''
    return (byNumber.get(number) ?? []).filter((invoice) =>
      (!documentHasTax || normalizeSupplierNip(invoice.supplierNip) === '')
      && daysApart(invoice.issueDate, document.issued_at) <= NUMBER_ONLY_MATCH_DAYS)
  }
  const used = new Set<string>()
  const result: MatchResult = { pairs: [], ambiguous: [], unmatchedDocuments: [], matchedInvoiceIds: used }
  const take = (document: PurchaseDocument, invoice: AppInvoiceForMatch, via: MatchedPair['via']) => {
    used.add(invoice.id)
    result.pairs.push({ document, invoice, via })
  }
  for (const document of documents) {
    const bySubiekt = byExternalId.get(subiektExternalId(document.id))
    if (bySubiekt && !used.has(bySubiekt.id)) { take(document, bySubiekt, 'SUBIEKT_ID'); continue }
    const byKsef = document.ksef_number ? byExternalId.get(document.ksef_number) : undefined
    if (byKsef && !used.has(byKsef.id)) { take(document, byKsef, 'KSEF'); continue }
    const key = documentKey(document.supplier_tax_id, document.original_number)
    const candidates = (key ? byKey.get(key) ?? [] : []).filter((invoice) => !used.has(invoice.id))
    if (candidates.length === 1) take(document, candidates[0] as AppInvoiceForMatch, 'NUMBER')
    else if (candidates.length > 1) result.ambiguous.push({ document, invoiceIds: candidates.map((c) => c.id) })
    else {
      const numberOnly = numberOnlyCandidates(document)
      if (numberOnly.length > 0) result.ambiguous.push({ document, invoiceIds: numberOnly.map((c) => c.id) })
      else result.unmatchedDocuments.push(document)
    }
  }
  return result
}

export interface SettlementRow { document: PurchaseDocument; invoice: AppInvoiceForMatch; amountDiffers: boolean }

export interface PaymentReconciliation {
  /** Paid in the app, liability still open in Subiekt — tick these in Subiekt. */
  settleInSubiekt: SettlementRow[]
  /** Liability settled in Subiekt, app invoice not marked paid. */
  paidOnlyInSubiekt: SettlementRow[]
  /** Paid app invoices in the window without any Subiekt document (not entered in GT yet?). */
  paidInAppMissingInSubiekt: AppInvoiceForMatch[]
  ambiguous: MatchResult['ambiguous']
}

const differs = (document: PurchaseDocument, invoice: AppInvoiceForMatch) =>
  invoice.plnGross !== null && Math.abs(Math.round(invoice.plnGross * 100) - Math.round(document.gross_total * 100)) > 1

/** `windowInvoices` = app invoices issued inside the reconciled window (for the „missing in Subiekt” list). */
export function reconcilePayments(match: MatchResult, windowInvoices: AppInvoiceForMatch[]): PaymentReconciliation {
  const settleInSubiekt: SettlementRow[] = []
  const paidOnlyInSubiekt: SettlementRow[] = []
  for (const { document, invoice } of match.pairs) {
    if (document.is_paid === null || invoice.documentStatus === 'CANCELLED') continue
    const row = { document, invoice, amountDiffers: differs(document, invoice) }
    if (invoice.paymentStatus === 'PAID' && !document.is_paid) settleInSubiekt.push(row)
    else if (invoice.paymentStatus !== 'PAID' && document.is_paid) paidOnlyInSubiekt.push(row)
  }
  const paidInAppMissingInSubiekt = windowInvoices.filter((invoice) =>
    invoice.paymentStatus === 'PAID' && invoice.documentStatus !== 'CANCELLED' && !match.matchedInvoiceIds.has(invoice.id))
  return { settleInSubiekt, paidOnlyInSubiekt, paidInAppMissingInSubiekt, ambiguous: match.ambiguous }
}
