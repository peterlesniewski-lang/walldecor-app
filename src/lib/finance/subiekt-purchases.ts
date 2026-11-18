import type { Prisma, PrismaClient } from '@/generated/prisma'
import { withAiQueueMutation } from '@/lib/ai/queue'
import { isCurrentAdmin } from '@/lib/finance/current-admin'
import { resolveSupplierRuleMatch } from '@/lib/finance/ksef-inbox'
import {
  SubiektBridgeError, describeSubiektBridgeError, fetchPurchaseDocuments, readSubiektBridgeConfig,
  type FetchLike, type PurchaseDocument, type SubiektBridgeErrorKind,
} from '@/lib/finance/subiekt-bridge-client'
import {
  SUBIEKT_SOURCE, isForeignPurchase, matchPurchases, reconcilePayments, subiektExternalId,
  type AppInvoiceForMatch, type SettlementRow,
} from '@/lib/finance/subiekt-purchase-matching'

/** Rolling import window after the first (backfill) run. */
export const SUBIEKT_PURCHASE_IMPORT_DAYS = 60
/** Manual invoices are often dated a few days off the GT issue date; match against a wider window than the fetched range. */
export const SUBIEKT_PURCHASE_MATCH_MARGIN_DAYS = 31
/** Reconciliation: current + 5 previous months (payment terms rarely exceed 60 days; forgotten items stay visible for half a year). */
export const SUBIEKT_RECONCILIATION_MONTHS = 6
export const SUBIEKT_PURCHASE_KEYS = {
  lastImportAt: 'subiekt_purchases.last_import_at',
  lastImportMessage: 'subiekt_purchases.last_import_message',
  /** Set after the first successful import from SUBIEKT_PURCHASES_IMPORT_FROM; later runs read only 60 days back. */
  backfillDone: 'subiekt_purchases.backfill_done',
} as const

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
export const warsawToday = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(now)
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}

/** [from, to] split into calendar-month chunks (the bridge returns ≤ 500 rows per call). */
export function monthChunks(from: string, to: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = []
  let cursor = from
  while (cursor <= to) {
    const start = new Date(`${cursor}T00:00:00.000Z`)
    const monthEnd = iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)))
    const chunkEnd = monthEnd < to ? monthEnd : to
    chunks.push({ from: cursor, to: chunkEnd })
    cursor = addDays(chunkEnd, 1)
  }
  return chunks
}

/** First run: IMPORT_FROM..today (backfill). Later runs: max(IMPORT_FROM, today − 60 days)..today. */
export function importRange(now: Date, importFrom: string, backfillDone: boolean) {
  const to = warsawToday(now)
  const rolling = addDays(to, -SUBIEKT_PURCHASE_IMPORT_DAYS)
  return { from: backfillDone && rolling > importFrom ? rolling : importFrom, to }
}

export function reconciliationRange(now: Date) {
  const to = warsawToday(now)
  const [year, month] = to.split('-').map(Number) as [number, number]
  return { from: iso(new Date(Date.UTC(year, month - SUBIEKT_RECONCILIATION_MONTHS, 1))), to }
}

export interface PurchaseFetchOptions { now?: Date; fetchImpl?: FetchLike; env?: Record<string, string | undefined> }

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
/** SUBIEKT_PURCHASES_IMPORT_FROM — first issue date eligible for import (production: 2026-01-01); null = import disabled. */
export function readImportFrom(env: Record<string, string | undefined> = process.env): string | null {
  const value = (env.SUBIEKT_PURCHASES_IMPORT_FROM ?? '').trim()
  if (!DATE_ONLY.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  // Rejects impossible dates such as 2026-02-30 (Date would silently roll them over).
  return Number.isFinite(parsed.getTime()) && iso(parsed) === value ? value : null
}

export type PurchaseRangeResult =
  | { ok: true; documents: PurchaseDocument[]; from: string; to: string }
  | { ok: false; kind: SubiektBridgeErrorKind; error: string }

/** All FZ/KFZ issued in [from, to] (month by month) or a Polish error; never partial. */
export async function fetchPurchaseRange(options: PurchaseFetchOptions & { from: string; to: string }): Promise<PurchaseRangeResult> {
  const config = readSubiektBridgeConfig(options.env ?? process.env)
  try {
    const documents: PurchaseDocument[] = []
    for (const chunk of monthChunks(options.from, options.to)) {
      const page = await fetchPurchaseDocuments(config, chunk, options.fetchImpl)
      documents.push(...page.rows)
    }
    return { ok: true, documents, from: options.from, to: options.to }
  } catch (error) {
    return { ok: false, kind: error instanceof SubiektBridgeError ? error.kind : 'unavailable', error: describeSubiektBridgeError(error) }
  }
}

export const MATCH_SELECT = {
  id: true, externalId: true, supplierName: true, supplierNip: true, invoiceNumber: true, issueDate: true,
  paymentStatus: true, paidAt: true, currency: true, grossAmount: true, reportingGrossAmount: true, documentStatus: true,
} as const satisfies Prisma.KsefInvoiceSelect
type InvoiceRow = Prisma.KsefInvoiceGetPayload<{ select: typeof MATCH_SELECT }>

export function toMatchInvoice(row: InvoiceRow): AppInvoiceForMatch {
  return {
    id: row.id, externalId: row.externalId, supplierName: row.supplierName, supplierNip: row.supplierNip,
    invoiceNumber: row.invoiceNumber, issueDate: row.issueDate.toISOString().slice(0, 10), paymentStatus: row.paymentStatus,
    paidAt: row.paidAt?.toISOString() ?? null,
    plnGross: row.currency === 'PLN' ? row.grossAmount : row.reportingGrossAmount,
    documentStatus: row.documentStatus,
  }
}

const issueDateWindow = (from: string, to: string, marginDays: number) => ({
  gte: new Date(`${addDays(from, -marginDays)}T00:00:00.000Z`),
  lte: new Date(`${addDays(to, marginDays)}T23:59:59.999Z`),
})

/** App invoices issued in [from − marginDays, to + marginDays] plus every invoice imported from Subiekt (regardless of date). */
export async function loadInvoicesForMatch(db: Pick<PrismaClient, 'ksefInvoice'>, from: string, to: string, marginDays = 0) {
  const rows = await db.ksefInvoice.findMany({
    where: { OR: [{ issueDate: issueDateWindow(from, to, marginDays) }, { source: SUBIEKT_SOURCE }] },
    select: MATCH_SELECT,
  })
  return rows.map(toMatchInvoice)
}

const rate = (value: number | null) => value === null ? '' : value.toFixed(4).replace('.', ',')

/** Owner decision: EU (WNT) invoice amount = Subiekt gross in PLN = what is paid to the supplier. */
export function toInvoiceAmounts(document: PurchaseDocument) {
  return {
    grossAmount: document.gross_total,
    netAmount: document.net_total,
    vatAmount: Math.round((document.gross_total - document.net_total) * 100) / 100,
  }
}

/**
 * Payment status of an imported document. `is_paid === null` means GT keeps no liability
 * (rozrachunek) for it — the purchase was settled at once (e.g. card / cash) — so it is PAID;
 * the payment date is unknown, hence paidAt stays null.
 *
 * KFZ with no liability: also PAID. Unpaid totals and aging (summarizeInvoicePayments) count every
 * non-PAID row whose documentStatus is not CANCELLED, corrections included, so an UNPAID KFZ would put
 * a negative amount into "do zapłaty" and the MISSING_DUE_DATE bucket. KSeF corrections avoid this the
 * same way: an invoice without a due date gets PAID when its XML is read (content route), and a
 * correction carries no separate payment of its own. A KFZ with a real liability (is_paid true/false)
 * keeps the status GT reports.
 */
export function importedPaymentStatus(document: Pick<PurchaseDocument, 'type' | 'is_paid'>): 'PAID' | 'UNPAID' {
  return document.is_paid === false ? 'UNPAID' : 'PAID'
}

export type PurchaseImportResult =
  | { ok: true; created: number; alreadyInApp: number; ambiguous: number; skippedDomestic: number; message: string }
  | { ok: false; kind: SubiektBridgeErrorKind | 'forbidden'; error: string }

const UNAUTHORIZED = { ok: false as const, kind: 'forbidden' as const, error: 'Brak uprawnień administratora.' }
const UNKNOWN_SUPPLIER = 'Nieznany dostawca'

/** Thrown inside a write transaction when the actor lost ADMIN rights mid-import. */
class ImportForbiddenError extends Error {}

/**
 * Imports foreign (EU) purchase invoices from Subiekt GT as KsefInvoice rows (source SUBIEKT).
 * Domestic invoices arrive from KSeF and are skipped; invoices already in the app are never modified.
 */
export async function importSubiektForeignPurchases(
  db: PrismaClient,
  options: PurchaseFetchOptions & { actorId: string },
): Promise<PurchaseImportResult> {
  const now = options.now ?? new Date()
  if (!(await isCurrentAdmin(db, options.actorId))) return UNAUTHORIZED
  const importFrom = readImportFrom(options.env ?? process.env)
  if (!importFrom) {
    return { ok: false, kind: 'not_configured', error: 'Import faktur UE jest wyłączony. Ustaw SUBIEKT_PURCHASES_IMPORT_FROM (RRRR-MM-DD) — od tej daty wystawienia faktury trafią do aplikacji.' }
  }
  const backfillDone = (await db.appSetting.findUnique({ where: { key: SUBIEKT_PURCHASE_KEYS.backfillDone } }))?.value === 'true'
  const range = importRange(now, importFrom, backfillDone)
  const fetched = await fetchPurchaseRange({ ...options, ...range })
  if (!fetched.ok) {
    await writeImportStatus(db, now, `Błąd: ${fetched.error}`)
    return fetched
  }
  const eligible = fetched.documents.filter((document) => document.issued_at >= importFrom)
  const foreign = eligible.filter((document) => isForeignPurchase(document))
  const skippedDomestic = eligible.length - foreign.length
  // Corrections after their originals so correctsInvoiceId can resolve within one run.
  foreign.sort((a, b) => (a.type === b.type ? a.id - b.id : a.type === 'FZ' ? -1 : 1))
  const match = matchPurchases(foreign, await loadInvoicesForMatch(db, fetched.from, fetched.to, SUBIEKT_PURCHASE_MATCH_MARGIN_DAYS))
  // A KFZ whose FZ was matched to an existing (e.g. manual) invoice links to that invoice.
  const matchedInvoiceByDocumentId = new Map(match.pairs.map((pair) => [pair.document.id, pair.invoice.id]))
  const rules = await db.ksefSupplierRule.findMany({ where: { active: true }, include: { tags: true } })

  let created = 0
  let alreadyInApp = match.pairs.length
  try {
    for (const document of match.unmatchedDocuments) {
      const outcome = await withAiQueueMutation(db, () => now, async (tx) => {
        if (!(await isCurrentAdmin(tx, options.actorId))) throw new ImportForbiddenError()
        const externalId = subiektExternalId(document.id)
        if (await tx.ksefInvoice.findUnique({ where: { externalId }, select: { id: true } })) return 'EXISTS' as const
        // Re-check NIP + number inside the writer reservation: an invoice may have been entered since the snapshot.
        const nearby = await tx.ksefInvoice.findMany({
          where: { issueDate: issueDateWindow(document.issued_at, document.issued_at, SUBIEKT_PURCHASE_MATCH_MARGIN_DAYS) },
          select: MATCH_SELECT,
        })
        if (matchPurchases([document], nearby.map(toMatchInvoice)).unmatchedDocuments.length === 0) return 'EXISTS' as const

        const supplierName = document.supplier_name ?? document.supplier_tax_id ?? UNKNOWN_SUPPLIER
        const invoiceNumber = document.original_number ?? document.number
        // Corrections are never auto-classified (same as KSeF sync): an admin decides how to book them.
        const decision = document.type === 'KFZ'
          ? { status: 'NO_RULE' as const }
          : resolveSupplierRuleMatch({ supplierName, supplierNip: document.supplier_tax_id }, rules)
        const rule = decision.status === 'MATCHED' ? decision.rule : null
        const parentId = document.type === 'KFZ' && document.parent_id !== null
          ? (await tx.ksefInvoice.findUnique({ where: { externalId: subiektExternalId(document.parent_id) }, select: { id: true } }))?.id
            ?? matchedInvoiceByDocumentId.get(document.parent_id) ?? null
          : null
        const amounts = toInvoiceAmounts(document)
        await tx.ksefInvoice.create({
          data: {
            source: SUBIEKT_SOURCE,
            externalId,
            supplierName,
            supplierNip: document.supplier_tax_id,
            invoiceNumber,
            issueDate: new Date(`${document.issued_at}T00:00:00.000Z`),
            ...amounts,
            currency: 'PLN',
            currencyConversionNote: document.currency === 'PLN'
              ? null
              : `Przeliczone w Subiekcie GT: ${document.currency} po kursie ${rate(document.exchange_rate)} (${document.number}).`,
            dueDate: document.due_date ? new Date(`${document.due_date}T00:00:00.000Z`) : null,
            // GT does not report the payment date in this tool, so paidAt stays empty.
            paymentStatus: importedPaymentStatus(document),
            documentStatus: document.type === 'KFZ' ? 'CORRECTION' : 'ACTIVE',
            correctsInvoiceId: parentId,
            status: rule ? 'MAPPED' : 'NEW',
            ruleMatchStatus: decision.status === 'CONFLICT' ? 'CONFLICT' : rule ? 'MATCHED' : 'NO_RULE',
            costCenterId: rule?.costCenterId ?? null,
            subCategoryId: rule?.subCategoryId ?? null,
            supplierRuleId: rule?.id ?? null,
            notes: `Subiekt GT: ${document.number}`,
            // Same as KSeF sync: a rule with tags creates one tagged part so cost reports treat both sources alike.
            ...(rule?.tags && rule.tags.length > 0
              ? {
                  parts: {
                    create: {
                      label: invoiceNumber,
                      grossAmount: amounts.grossAmount,
                      order: 0,
                      tags: { create: rule.tags.map((tag) => ({ tagId: tag.tagId })) },
                      allocations: { create: { costCenterId: rule.costCenterId, percent: 100 } },
                    },
                  },
                }
              : {}),
          },
        })
        return 'CREATED' as const
      })
      // The callback may be retried after a rolled-back SQLite transaction; count only the final outcome.
      if (outcome === 'CREATED') created += 1
      else alreadyInApp += 1
    }
  } catch (error) {
    if (error instanceof ImportForbiddenError) {
      await writeImportStatus(db, now, `Błąd: ${UNAUTHORIZED.error} Dodano ${created} faktur przed przerwaniem.`)
      return UNAUTHORIZED
    }
    console.error(JSON.stringify({ event: 'SUBIEKT_PURCHASE_IMPORT_FAILED', created, error: error instanceof Error ? error.name : 'unknown' }))
    const message = `Import faktur UE przerwany nieoczekiwanym błędem po dodaniu ${created} faktur. Ponowne uruchomienie dokończy import bez duplikatów.`
    await writeImportStatus(db, now, `Błąd: ${message}`)
    return { ok: false, kind: 'unavailable', error: message }
  }

  const message = `Faktury UE z Subiekta: dodano ${created}, już w aplikacji ${alreadyInApp}, niejednoznaczne ${match.ambiguous.length}, krajowe pominięte ${skippedDomestic}.`
  await writeImportStatus(db, now, message, { [SUBIEKT_PURCHASE_KEYS.backfillDone]: 'true' })
  return { ok: true, created, alreadyInApp, ambiguous: match.ambiguous.length, skippedDomestic, message }
}

async function writeImportStatus(db: Pick<PrismaClient, 'appSetting' | '$transaction'>, now: Date, message: string, extra: Record<string, string> = {}) {
  const values = { [SUBIEKT_PURCHASE_KEYS.lastImportAt]: now.toISOString(), [SUBIEKT_PURCHASE_KEYS.lastImportMessage]: message, ...extra }
  await db.$transaction(Object.entries(values).map(([key, value]) =>
    db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })))
}

export interface SettlementView {
  invoiceId: string
  subiektNumber: string
  originalNumber: string | null
  supplierName: string | null
  issuedAt: string
  remaining: number | null
  grossPln: number
  appGrossPln: number | null
  paidAt: string | null
  amountDiffers: boolean
}

const toView = ({ document, invoice, amountDiffers }: SettlementRow): SettlementView => ({
  invoiceId: invoice.id, subiektNumber: document.number, originalNumber: document.original_number, supplierName: document.supplier_name,
  issuedAt: document.issued_at, remaining: document.remaining, grossPln: document.gross_total, appGrossPln: invoice.plnGross,
  paidAt: invoice.paidAt?.slice(0, 10) ?? null, amountDiffers,
})

export type ReconciliationResult =
  | {
      ok: true; from: string; to: string; checkedAt: string
      settleInSubiekt: SettlementView[]
      paidOnlyInSubiekt: SettlementView[]
      paidInAppMissingInSubiekt: Array<{ invoiceId: string; supplierName: string; invoiceNumber: string; issueDate: string; paidAt: string | null }>
      ambiguous: Array<{ subiektNumber: string; candidates: number }>
    }
  | { ok: false; kind: SubiektBridgeErrorKind; error: string }

/** Read-only: compares app payment status with Subiekt liabilities for all FZ/KFZ in the window. */
export async function reconcileSubiektPayments(db: PrismaClient, options: PurchaseFetchOptions = {}): Promise<ReconciliationResult> {
  const now = options.now ?? new Date()
  // No import floor here: reconciliation covers domestic KSeF invoices that were in the app long before this feature.
  const fetched = await fetchPurchaseRange({ ...options, ...reconciliationRange(now) })
  if (!fetched.ok) return fetched
  const invoices = await loadInvoicesForMatch(db, fetched.from, fetched.to, SUBIEKT_PURCHASE_MATCH_MARGIN_DAYS)
  const windowInvoices = invoices.filter((i) => i.issueDate >= fetched.from && i.issueDate <= fetched.to)
  const result = reconcilePayments(matchPurchases(fetched.documents, invoices), windowInvoices)
  const byIssue = (a: { issuedAt: string }, b: { issuedAt: string }) => a.issuedAt.localeCompare(b.issuedAt)
  return {
    ok: true, from: fetched.from, to: fetched.to, checkedAt: now.toISOString(),
    settleInSubiekt: result.settleInSubiekt.map(toView).sort(byIssue),
    paidOnlyInSubiekt: result.paidOnlyInSubiekt.map(toView).sort(byIssue),
    paidInAppMissingInSubiekt: result.paidInAppMissingInSubiekt.map((i) => ({
      invoiceId: i.id, supplierName: i.supplierName, invoiceNumber: i.invoiceNumber, issueDate: i.issueDate, paidAt: i.paidAt?.slice(0, 10) ?? null,
    })),
    ambiguous: result.ambiguous.map((a) => ({ subiektNumber: a.document.number, candidates: a.invoiceIds.length })),
  }
}
