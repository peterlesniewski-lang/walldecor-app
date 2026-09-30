import type { PrismaClient } from '@/generated/prisma'
import { withAiQueueMutation } from '@/lib/ai/queue'
import { InvoiceImportError } from '@/lib/invoice-import/errors'
import { assertLegacyInvoiceWriteAllowed } from '@/lib/invoice-import/legacy-write-guard'
import { reconcileImportedKsefInvoice } from '@/lib/invoice-import/ksef-reconciliation-service'
import { buildKsefReconciliationSnapshot } from '@/lib/invoice-import/ksef-reconciliation-policy'
import {
  KsefApiClient,
  mapKsefMetadataToInvoice,
  type KsefEnvironment,
} from '@/lib/finance/ksef-client'
import { resolveSupplierRuleMatch } from '@/lib/finance/ksef-inbox'
import { applySupplierRulesToNewInvoices } from '@/lib/finance/ksef-rule-application'
import { buildKsefSyncDateRanges } from '@/lib/finance/ksef-sync-ranges'
import {
  fetchKsefInvoiceDetailWithRetry,
  wait,
  XML_DETAILS_THROTTLE_MS,
} from '@/lib/finance/ksef-detail-fetch'

const KSEF_SETTINGS = [
  'ksef_enabled',
  'ksef_environment',
  'ksef_company_nip',
  'ksef_token',
  'ksef_sync_from',
] as const

export type KsefSyncResult = {
  ok: true
  environment: KsefEnvironment
  fetched: number
  imported: number
  updated: number
  linked: number
  conflicts: number
  mappedByRules: number
  xmlDetailsFetched: number
  xmlDetailsFailed: number
  ranges: number
  truncated: boolean
}

/** Missing or disabled KSeF configuration; safe to show to an administrator. */
export class KsefSyncConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KsefSyncConfigError'
  }
}

type MappedKsefInvoice = ReturnType<typeof mapKsefMetadataToInvoice>
type InvoiceReader = Pick<PrismaClient, 'ksefInvoice'>
type PersistableKsefInvoice = Omit<MappedKsefInvoice, 'correctedKsefNumber' | 'correctedInvoiceNumber'>
type ExistingInvoiceDetails = {
  externalId?: string | null
  xmlContent?: string | null
  invoiceImportDraft?: { id: string } | null
  dueDate: Date | null
  bankAccount: string | null
  paymentDetailsFetchedAt?: Date | null
} | null

async function assertCurrentAdmin(db: Pick<PrismaClient, 'user'>, actorId: string) {
  const user = await db.user.findUnique({
    where: { id: actorId }, select: { role: true, isActive: true, mustChangePassword: true },
  })
  if (!user || user.role !== 'ADMIN' || !user.isActive || user.mustChangePassword) {
    throw new InvoiceImportError('FORBIDDEN', 403)
  }
}

function splitMappedInvoice(invoice: MappedKsefInvoice) {
  const { correctedKsefNumber, correctedInvoiceNumber, ...data } = invoice
  return { data, correctedKsefNumber, correctedInvoiceNumber }
}

function blocksAutomaticClassification(invoice: PersistableKsefInvoice) {
  return (
    invoice.documentStatus !== 'ACTIVE' ||
    (invoice.currency !== 'PLN' && invoice.reportingGrossAmount == null)
  )
}

function needsInvoiceXmlDetails(invoice: PersistableKsefInvoice, existing: ExistingInvoiceDetails) {
  // Complete metadata still cannot establish payment. New/imported documents
  // need their own XML once; an XML cache is checked before this predicate.
  if (!existing) return true
  if (existing.invoiceImportDraft) return existing.externalId !== invoice.externalId || !existing.xmlContent
  if (existing?.paymentDetailsFetchedAt) return false
  return (!invoice.dueDate && !existing?.dueDate) || (!invoice.bankAccount && !existing?.bankAccount)
}

async function findExistingInvoice(db: InvoiceReader, invoice: PersistableKsefInvoice) {
  const byExternalId = await db.ksefInvoice.findUnique({
    where: { externalId: invoice.externalId },
    include: { invoiceImportDraft: { select: { id: true } } },
  })
  if (byExternalId) return byExternalId

  if (!invoice.supplierNip) return null

  return db.ksefInvoice.findFirst({
    where: {
      supplierNip: invoice.supplierNip,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
    },
    include: { invoiceImportDraft: { select: { id: true } } },
  })
}

async function findCorrectedInvoiceId(db: InvoiceReader, {
  correctedKsefNumber,
  correctedInvoiceNumber,
  supplierNip,
  excludeId,
}: {
  correctedKsefNumber: string | null
  correctedInvoiceNumber: string | null
  supplierNip: string | null
  excludeId?: string
}) {
  if (correctedKsefNumber) {
    const original = await db.ksefInvoice.findUnique({
      where: { externalId: correctedKsefNumber },
      select: { id: true },
    })
    if (original && original.id !== excludeId) return original.id
  }

  if (!correctedInvoiceNumber) return null

  const original = await db.ksefInvoice.findFirst({
    where: {
      invoiceNumber: correctedInvoiceNumber,
      ...(supplierNip ? { supplierNip } : {}),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
    orderBy: { issueDate: 'desc' },
  })

  return original?.id ?? null
}

export async function runKsefSync(db: PrismaClient, actorId: string): Promise<KsefSyncResult> {
  await assertCurrentAdmin(db, actorId)
  const settings = await db.appSetting.findMany({
    where: { key: { in: [...KSEF_SETTINGS] } },
  })
  const map = new Map(settings.map((setting) => [setting.key, setting.value]))

  if (map.get('ksef_enabled') !== 'true') {
    throw new KsefSyncConfigError('Integracja KSeF jest wyłączona w ustawieniach.')
  }

  const token = map.get('ksef_token') ?? ''
  const companyNip = map.get('ksef_company_nip') ?? ''
  const environment = (map.get('ksef_environment') ?? 'test') as KsefEnvironment
  const syncFrom = map.get('ksef_sync_from') || new Date().toISOString().slice(0, 10)

  if (!token || !companyNip) {
    throw new KsefSyncConfigError('Brakuje tokena KSeF albo NIP firmy w ustawieniach.')
  }

  const client = new KsefApiClient({ environment })
  const authTokens = await client.authenticateWithToken({ companyNip, token })
  const rules = await db.ksefSupplierRule.findMany({
    where: { active: true },
    include: { tags: true },
  })

  let imported = 0
  let updated = 0
  let linked = 0
  let conflicts = 0
  let fetched = 0
  let truncated = false
  let mappedByRules = 0
  let xmlDetailsFetched = 0
  let xmlDetailsFailed = 0
  const ranges = buildKsefSyncDateRanges(syncFrom)

  for (const range of ranges) {
    let pageOffset = 0
    let hasMore = true

    while (hasMore && pageOffset < 20) {
      const response = await client.queryPurchaseInvoiceMetadata({
        accessToken: authTokens.accessToken.token,
        from: range.from,
        to: range.to,
        pageOffset,
        pageSize: 250,
      })

      fetched += response.invoices.length
      truncated ||= response.isTruncated
      hasMore = response.hasMore

      for (const metadata of response.invoices) {
        // Reject malformed provider fields before the legacy mapper or any
        // invoice/cache lookup. XML is validated again after downloading it.
        buildKsefReconciliationSnapshot(metadata, null)
        const mappedInvoice = mapKsefMetadataToInvoice(metadata)
        const {
          data: invoiceData,
          correctedKsefNumber,
          correctedInvoiceNumber,
        } = splitMappedInvoice(mappedInvoice)
        invoiceData.externalId = invoiceData.externalId.trim()
        const existingBeforeFetch = await findExistingInvoice(db, invoiceData)
        const observed = await db.invoiceKsefReconciliation.findUnique({
          where: { externalId: invoiceData.externalId }, select: { xmlContent: true },
        })
        let paymentDetailsFetchedAt: Date | null = null
        let xmlContent: string | null = observed?.xmlContent
          ?? (existingBeforeFetch?.externalId === invoiceData.externalId ? existingBeforeFetch.xmlContent ?? null : null)
        if (xmlContent === null && needsInvoiceXmlDetails(invoiceData, existingBeforeFetch)) {
          try {
            const details = await fetchKsefInvoiceDetailWithRetry({
              client,
              accessToken: authTokens.accessToken.token,
              ksefNumber: invoiceData.externalId,
            })
            invoiceData.dueDate = details.dueDate ?? invoiceData.dueDate
            invoiceData.bankAccount = details.bankAccount ?? invoiceData.bankAccount
            paymentDetailsFetchedAt = new Date()
            xmlContent = details.xml
            xmlDetailsFetched += 1
          } catch {
            xmlDetailsFailed += 1
          }
          // Throttle between full-XML downloads so a large backlog does not
          // trip KSeF rate limiting and silently drop payment due dates.
          await wait(XML_DETAILS_THROTTLE_MS)
        }
        const outcome = await withAiQueueMutation(db, () => new Date(), async (tx, _lease, now) => {
          await assertCurrentAdmin(tx, actorId)
          const reconciliation = await reconcileImportedKsefInvoice(tx, actorId, metadata, xmlContent, now)
          if (reconciliation.outcome === 'LINKED') return reconciliation
          // Network work stays outside the reservation. Eligibility is read
          // again after acquiring it, sharing the boundary with draft approval.
          const existing = await findExistingInvoice(tx, invoiceData)
          if (existing) await assertLegacyInvoiceWriteAllowed(tx, existing.id)
          const snapshot = buildKsefReconciliationSnapshot(metadata, xmlContent)
          const documentStatus = snapshot.documentStatus
          const correctsInvoiceId = await findCorrectedInvoiceId(tx, {
            correctedKsefNumber,
            correctedInvoiceNumber,
            supplierNip: invoiceData.supplierNip,
            excludeId: existing?.id,
          })
          const shouldBlockClassification = blocksAutomaticClassification({ ...invoiceData, documentStatus })

          if (existing) {
            await tx.ksefInvoice.update({
              where: { id: existing.id },
              data: {
                supplierName: invoiceData.supplierName,
                supplierNip: invoiceData.supplierNip,
                invoiceNumber: invoiceData.invoiceNumber,
                externalId: invoiceData.externalId,
                source: existing.source === 'MANUAL' ? 'MANUAL' : invoiceData.source,
                issueDate: invoiceData.issueDate,
                grossAmount: invoiceData.grossAmount,
                netAmount: invoiceData.netAmount,
                vatAmount: invoiceData.vatAmount,
                currency: invoiceData.currency,
                reportingGrossAmount: invoiceData.currency === 'PLN' ? null : existing.reportingGrossAmount,
                reportingNetAmount: invoiceData.currency === 'PLN' ? null : existing.reportingNetAmount,
                reportingVatAmount: invoiceData.currency === 'PLN' ? null : existing.reportingVatAmount,
                originalCurrency: invoiceData.originalCurrency,
                originalGrossAmount: invoiceData.originalGrossAmount,
                originalNetAmount: invoiceData.originalNetAmount,
                originalVatAmount: invoiceData.originalVatAmount,
                dueDate: invoiceData.dueDate ?? existing.dueDate,
                bankAccount: invoiceData.bankAccount ?? existing.bankAccount,
                paymentDetailsFetchedAt: paymentDetailsFetchedAt ?? existing.paymentDetailsFetchedAt,
                xmlContent: xmlContent ?? existing.xmlContent,
                xmlFetchedAt: paymentDetailsFetchedAt ?? existing.xmlFetchedAt,
                documentStatus,
                correctsInvoiceId: documentStatus === 'CORRECTION' ? correctsInvoiceId : null,
                ...(shouldBlockClassification && existing.status !== 'APPROVED'
                  ? {
                      status: 'NEW',
                      ruleMatchStatus: 'NO_RULE',
                      costCenterId: null,
                      subCategoryId: null,
                      supplierRuleId: null,
                    }
                  : {}),
              },
            })
            return 'UPDATED' as const
          }

          const ruleDecision = shouldBlockClassification
            ? { status: 'NO_RULE' as const }
            : resolveSupplierRuleMatch(
                { supplierName: invoiceData.supplierName, supplierNip: invoiceData.supplierNip },
                rules
              )
          const match = ruleDecision.status === 'MATCHED' ? ruleDecision.rule : null

          await tx.ksefInvoice.create({
            data: {
              ...invoiceData,
              documentStatus,
              paymentDetailsFetchedAt,
              xmlContent,
              xmlFetchedAt: paymentDetailsFetchedAt,
              correctsInvoiceId: documentStatus === 'CORRECTION' ? correctsInvoiceId : null,
              paymentStatus: snapshot.data.paymentStatus,
              paidAt: snapshot.data.paidAt ? new Date(`${snapshot.data.paidAt}T00:00:00.000Z`) : null,
              status: match ? 'MAPPED' : 'NEW',
              ruleMatchStatus: ruleDecision.status === 'CONFLICT' ? 'CONFLICT' : match ? 'MATCHED' : 'NO_RULE',
              costCenterId: match?.costCenterId ?? null,
              subCategoryId: match?.subCategoryId ?? null,
              supplierRuleId: match?.id ?? null,
              ...(match?.tags && match.tags.length > 0
                ? {
                    parts: {
                      create: {
                        label: invoiceData.invoiceNumber,
                        grossAmount: invoiceData.reportingGrossAmount ?? invoiceData.grossAmount,
                        order: 0,
                        tags: { create: match.tags.map((tag) => ({ tagId: tag.tagId })) },
                        allocations: { create: { costCenterId: match.costCenterId, percent: 100 } },
                      },
                    },
                  }
                : {}),
            },
          })
          return 'IMPORTED' as const
        })
        // The callback may be retried after a rolled-back SQLite transaction.
        if (outcome === 'IMPORTED') imported += 1
        else if (outcome === 'UPDATED') updated += 1
        else {
          linked += 1
          if (outcome.status === 'CONFLICT') conflicts += 1
        }
      }

      pageOffset += 1
    }
  }

  mappedByRules = await withAiQueueMutation(db, () => new Date(), async (tx) => {
    await assertCurrentAdmin(tx, actorId)
    return applySupplierRulesToNewInvoices(tx, rules)
  })

  return {
    ok: true,
    environment,
    fetched,
    imported,
    updated,
    linked,
    conflicts,
    mappedByRules,
    xmlDetailsFetched,
    xmlDetailsFailed,
    ranges: ranges.length,
    truncated,
  }
}

/** Another KSeF synchronization (manual or scheduled) is already running in this process. */
export class KsefSyncInProgressError extends Error {
  constructor() {
    super('Synchronizacja KSeF jest już w toku. Spróbuj ponownie za kilka minut.')
    this.name = 'KsefSyncInProgressError'
  }
}

// Route handlers and instrumentation can load separate module instances, so the
// flag lives on globalThis to keep manual and scheduled runs mutually exclusive.
const SYNC_LOCK = Symbol.for('walldecor.ksefSyncRunning')
type SyncLockHolder = { [SYNC_LOCK]?: boolean }

export async function withKsefSyncLock<T>(operation: () => Promise<T>): Promise<T> {
  const holder = globalThis as SyncLockHolder
  if (holder[SYNC_LOCK]) throw new KsefSyncInProgressError()
  holder[SYNC_LOCK] = true
  try {
    return await operation()
  } finally {
    holder[SYNC_LOCK] = false
  }
}
