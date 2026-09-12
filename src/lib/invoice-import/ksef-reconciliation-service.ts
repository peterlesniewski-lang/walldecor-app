import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { InvoiceImportDraft, InvoiceKsefReconciliation, Prisma, PrismaClient } from '@/generated/prisma'
import { withAiQueueMutation } from '@/lib/ai/queue'
import type { KsefInvoiceMetadata } from '@/lib/finance/ksef-client'
import { INVOICE_MANUAL_FIELD_NAMES, invoiceManualFieldsSchema, type InvoiceManualField, type InvoiceDraftData } from './contracts'
import { InvoiceImportError } from './errors'
import { invoiceBusinessIdentity, isPossibleInvoiceDuplicate } from './identity'
import {
  applyKsefSnapshotToDraft, buildKsefReconciliationSnapshot, compareKsefReconciliation,
  ksefReconciliationSnapshotSchema, KsefReconciliationPolicyError, type KsefReconciliationSnapshot,
} from './ksef-reconciliation-policy'
import {
  KSEF_RECONCILIATION_STATE_SELECT, draftKsefReconciliationDto, hashKsefComparisonData, parseKsefDraftData,
  parseStoredKsefReconciliation, serializeKsefReconciliationSnapshot, summarizeDraftKsefReconciliations,
  type DraftKsefReconciliationDto, type KsefReconciliationStatus,
} from './ksef-reconciliation-state'

type Transaction = Prisma.TransactionClient
const idSchema = z.string().trim().min(1).max(191)
const draftStateSchema = z.enum(['OPEN', 'APPROVED', 'ARCHIVED'])
const resolutionSchema = z.strictObject({
  reconciliationId: idSchema,
  expectedDraftVersion: z.number().int().positive(),
  expectedLinkVersion: z.number().int().positive(),
  action: z.enum(['KEEP_LOCAL', 'APPLY_TO_DRAFT']),
  idempotencyKey: z.string().trim().min(8).max(191),
})
type ResolutionRequest = z.infer<typeof resolutionSchema> & { draftId: string }
const resultSchema = z.strictObject({
  draftId: idSchema, version: z.number().int().positive(), reconciliationId: idSchema,
  reconciliationVersion: z.number().int().positive(), outcome: z.enum(['KEPT_LOCAL', 'APPLIED_TO_DRAFT']),
})

export type KsefObservationResult = { outcome: 'NOT_MATCHED' } | {
  outcome: 'LINKED'; draftId: string; linkId: string; status: KsefReconciliationStatus; changed: boolean
}
export type DraftKsefReconciliationsDto = {
  draftId: string; draftVersion: number; draftState: 'OPEN' | 'APPROVED' | 'ARCHIVED'; links: DraftKsefReconciliationDto[]
}
export type KsefResolutionResult = z.infer<typeof resultSchema>

async function authorizeAdmin(tx: Transaction, actorId: string) {
  const user = await tx.user.findUnique({ where: { id: actorId },
    select: { role: true, isActive: true, mustChangePassword: true } })
  if (!user || user.role !== 'ADMIN' || !user.isActive || user.mustChangePassword) {
    throw new InvoiceImportError('FORBIDDEN', 403)
  }
}

function parseDraftState(state: string): DraftKsefReconciliationsDto['draftState'] {
  const parsed = draftStateSchema.safeParse(state)
  if (!parsed.success) throw new InvoiceImportError('CORRUPT_DATA', 500)
  return parsed.data
}

function parseManualFields(value: string): InvoiceManualField[] {
  try { return invoiceManualFieldsSchema.parse(JSON.parse(value)) }
  catch { throw new InvoiceImportError('CORRUPT_DATA', 500) }
}

function draftAuditState(draft: InvoiceImportDraft) {
  return { id: draft.id, version: draft.version, state: draft.state, invoiceId: draft.invoiceId,
    latestAiJobId: draft.latestAiJobId, skippedAt: draft.skippedAt,
    data: parseKsefDraftData(draft.dataJson), manualFields: parseManualFields(draft.manualFieldsJson) }
}

function linkAuditState(link: InvoiceKsefReconciliation) {
  return { id: link.id, externalId: link.externalId, version: link.version, status: link.status,
    snapshot: parseStoredKsefReconciliation(link), snapshotHash: link.snapshotHash,
    resolvedDataHash: link.resolvedDataHash }
}

function matchesDraftIdentity(data: InvoiceDraftData, snapshot: KsefReconciliationSnapshot) {
  if (!data.invoiceNumber || !data.issueDate) return false
  return isPossibleInvoiceDuplicate(invoiceBusinessIdentity(snapshot.data), invoiceBusinessIdentity({
    supplierName: data.supplierName ?? '', taxId: data.taxId,
    invoiceNumber: data.invoiceNumber, issueDate: data.issueDate,
  }))
}

async function matchingDraft(tx: Transaction, snapshot: KsefReconciliationSnapshot): Promise<InvoiceImportDraft | null> {
  // The bound invoice keeps the previous identity after revocation/manual edits.
  // Amounts, classification and payment deliberately do not participate.
  const candidates = await tx.invoiceImportDraft.findMany({
    where: { OR: [{ state: 'OPEN' }, { invoiceId: { not: null } }] },
    include: { invoice: { select: { supplierName: true, supplierNip: true, invoiceNumber: true, issueDate: true } } },
  })
  const matches = candidates.filter((draft) => {
    parseDraftState(draft.state)
    const data = parseKsefDraftData(draft.dataJson)
    return matchesDraftIdentity(data, snapshot) || (draft.invoice != null && matchesDraftIdentity({
      supplierName: draft.invoice.supplierName, taxId: draft.invoice.supplierNip,
      invoiceNumber: draft.invoice.invoiceNumber, issueDate: draft.invoice.issueDate.toISOString().slice(0, 10),
    }, snapshot))
  })
  const bound = matches.filter((draft) => draft.invoiceId !== null)
  const preferred = bound.length ? bound : matches.filter((draft) => draft.state === 'OPEN')
  if (preferred.length > 1) throw new InvoiceImportError('KSEF_AMBIGUOUS_MATCH', 409)
  return preferred[0] ?? null
}

/**
 * Caller MUST already hold withAiQueueMutation's SQLite writer reservation.
 * This transaction only records observations, versions and immutable audits;
 * it never modifies invoices, expenses, parts, source metadata or originals.
 */
export async function reconcileImportedKsefInvoice(
  tx: Transaction, actorId: string, metadata: KsefInvoiceMetadata,
  xmlContent: string | null, now: Date,
): Promise<KsefObservationResult> {
  await authorizeAdmin(tx, actorId)
  const externalId = ksefReconciliationSnapshotSchema.shape.externalId.safeParse(metadata?.ksefNumber)
  if (!externalId.success) throw new KsefReconciliationPolicyError()
  const existing = await tx.invoiceKsefReconciliation.findUnique({ where: { externalId: externalId.data } })
  if (existing) parseStoredKsefReconciliation(existing)
  const xml = xmlContent ?? existing?.xmlContent ?? null
  const snapshot = buildKsefReconciliationSnapshot(metadata, xml)
  const draft = existing
    ? await tx.invoiceImportDraft.findUniqueOrThrow({ where: { id: existing.draftId } })
    : await matchingDraft(tx, snapshot)
  if (!draft) return { outcome: 'NOT_MATCHED' }
  parseDraftState(draft.state)
  const data = parseKsefDraftData(draft.dataJson)
  const serialized = serializeKsefReconciliationSnapshot(snapshot)
  if (existing && existing.snapshotHash === serialized.snapshotHash) {
    return { outcome: 'LINKED', draftId: draft.id, linkId: existing.id,
      status: draftKsefReconciliationDto(data, existing).status, changed: false }
  }
  const status = compareKsefReconciliation(data, snapshot).length ? 'CONFLICT' : 'MATCHED'
  const values = { ...serialized, status, xmlContent: xml, resolvedDataHash: null, updatedAt: now }
  const link = existing
    ? await tx.invoiceKsefReconciliation.update({ where: { id: existing.id }, data: { ...values, version: { increment: 1 } } })
    : await tx.invoiceKsefReconciliation.create({ data: { ...values, externalId: snapshot.externalId, draftId: draft.id, createdAt: now } })
  const updated = await tx.invoiceImportDraft.update({ where: { id: draft.id }, data: { version: { increment: 1 }, updatedAt: now } })
  await tx.invoiceDraftAudit.create({ data: {
    draftId: draft.id, actorId, action: 'KSEF_OBSERVED', createdAt: now,
    beforeJson: JSON.stringify({ draft: draftAuditState(draft), link: existing ? linkAuditState(existing) : null }),
    afterJson: JSON.stringify({ draft: draftAuditState(updated), link: linkAuditState(link) }),
  } })
  return { outcome: 'LINKED', draftId: draft.id, linkId: link.id, status, changed: true }
}

export async function getDraftKsefReconciliations(db: PrismaClient, actorId: string, draftIdInput: string): Promise<DraftKsefReconciliationsDto> {
  return db.$transaction(async (tx) => {
    await authorizeAdmin(tx, actorId)
    const parsedId = idSchema.safeParse(draftIdInput)
    if (!parsedId.success) throw new InvoiceImportError('INVALID_INPUT', 422)
    const draft = await tx.invoiceImportDraft.findUnique({ where: { id: parsedId.data },
      include: { ksefReconciliations: {
        select: KSEF_RECONCILIATION_STATE_SELECT, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      } } })
    if (!draft) throw new InvoiceImportError('NOT_FOUND', 404)
    const data = parseKsefDraftData(draft.dataJson)
    return { draftId: draft.id, draftVersion: draft.version, draftState: parseDraftState(draft.state),
      links: draft.ksefReconciliations.map((link) => draftKsefReconciliationDto(data, link)) }
  })
}

/** Intended for the approval transaction, after the caller's authorization. */
export async function assertDraftKsefReconciled(tx: Transaction, draft: Pick<InvoiceImportDraft, 'id' | 'dataJson'>): Promise<void> {
  const links = await tx.invoiceKsefReconciliation.findMany({
    where: { draftId: draft.id }, select: KSEF_RECONCILIATION_STATE_SELECT,
  })
  if (summarizeDraftKsefReconciliations(draft.dataJson, links).conflictCount) {
    throw new InvoiceImportError('KSEF_CONFLICT', 409)
  }
}

function resolutionHash(request: ResolutionRequest) {
  return createHash('sha256').update(JSON.stringify({ action: request.action, draftId: request.draftId,
    reconciliationId: request.reconciliationId, expectedDraftVersion: request.expectedDraftVersion,
    expectedLinkVersion: request.expectedLinkVersion })).digest('hex')
}

async function existingReceipt(tx: Transaction, actorId: string, request: ResolutionRequest, hash: string): Promise<KsefResolutionResult | null> {
  const receipt = await tx.invoiceDraftAudit.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey: request.idempotencyKey } } })
  if (!receipt) return null
  const outcome = request.action === 'KEEP_LOCAL' ? 'KEPT_LOCAL' : 'APPLIED_TO_DRAFT'
  if (receipt.requestHash !== hash || receipt.draftId !== request.draftId || receipt.action !== `KSEF_${outcome}`) {
    throw new InvoiceImportError('IDEMPOTENCY_CONFLICT', 409)
  }
  try {
    const result = resultSchema.parse(JSON.parse(receipt.resultJson ?? 'null'))
    if (result.draftId !== request.draftId || result.reconciliationId !== request.reconciliationId || result.outcome !== outcome
      || result.version !== request.expectedDraftVersion + 1 || result.reconciliationVersion !== request.expectedLinkVersion + 1) {
      throw new Error('Receipt result mismatch')
    }
    return result
  } catch { throw new InvoiceImportError('CORRUPT_RECEIPT', 500) }
}

function appliedManualFields(current: InvoiceManualField[], previous: InvoiceDraftData, next: InvoiceDraftData, snapshot: KsefReconciliationSnapshot) {
  const incoming = snapshot.data
  const fields = new Set<InvoiceManualField>([...current, 'documentType', 'supplierName', 'invoiceNumber', 'issueDate', 'currency', 'gross'])
  for (const field of ['taxId', 'net', 'vat', 'dueDate', 'bankAccount'] as const) {
    if (incoming[field] !== null) fields.add(field)
  }
  if (incoming.paymentStatus !== 'UNKNOWN') {
    fields.add('paymentStatus')
    if (incoming.paidAt !== null || incoming.paymentStatus === 'PARTIAL' || incoming.paymentStatus === 'UNPAID') fields.add('paidAt')
  }
  if (previous.conversionConfirmed !== next.conversionConfirmed) fields.add('conversionConfirmed')
  return INVOICE_MANUAL_FIELD_NAMES.filter((field) => fields.has(field))
}

export async function resolveDraftKsefReconciliation(db: PrismaClient, actorId: string, draftIdInput: string, input: unknown): Promise<KsefResolutionResult> {
  return withAiQueueMutation(db, () => new Date(), async (tx, _lease, now) => {
    await authorizeAdmin(tx, actorId)
    const parsedId = idSchema.safeParse(draftIdInput)
    const parsed = resolutionSchema.safeParse(input)
    if (!parsedId.success || !parsed.success) throw new InvoiceImportError('INVALID_INPUT', 422)
    const request = { ...parsed.data, draftId: parsedId.data }
    const hash = resolutionHash(request)
    const prior = await existingReceipt(tx, actorId, request, hash)
    if (prior) return prior
    const draft = await tx.invoiceImportDraft.findUnique({ where: { id: request.draftId } })
    const link = await tx.invoiceKsefReconciliation.findUnique({ where: { id: request.reconciliationId } })
    if (!draft || !link || link.draftId !== draft.id) throw new InvoiceImportError('NOT_FOUND', 404)
    if (draft.version !== request.expectedDraftVersion || link.version !== request.expectedLinkVersion) {
      throw new InvoiceImportError('STALE_VERSION', 409)
    }
    const state = parseDraftState(draft.state)
    if (state === 'ARCHIVED' || (request.action === 'APPLY_TO_DRAFT' && state !== 'OPEN')) {
      throw new InvoiceImportError('INVALID_STATE', 409)
    }
    const snapshot = parseStoredKsefReconciliation(link)
    const current = parseKsefDraftData(draft.dataJson)
    const manualFields = parseManualFields(draft.manualFieldsJson)
    const outcome = request.action === 'KEEP_LOCAL' ? 'KEPT_LOCAL' : 'APPLIED_TO_DRAFT'
    const updates: Prisma.InvoiceImportDraftUpdateInput = { version: { increment: 1 }, updatedAt: now }
    if (request.action === 'APPLY_TO_DRAFT') {
      const next = applyKsefSnapshotToDraft(current, snapshot)
      updates.dataJson = JSON.stringify(next)
      updates.manualFieldsJson = JSON.stringify(appliedManualFields(manualFields, current, next, snapshot))
      updates.latestAiJob = { disconnect: true }
      updates.skippedAt = null
      if (draft.latestAiJobId) {
        await tx.aiJob.updateMany({ where: { id: draft.latestAiJobId, status: 'QUEUED' }, data: {
          status: 'CANCELLED', resultJson: null, errorCode: null, workerId: null, leaseToken: null, leaseUntil: null,
        } })
      }
    }
    const updated = await tx.invoiceImportDraft.update({ where: { id: draft.id }, data: updates })
    const updatedLink = await tx.invoiceKsefReconciliation.update({ where: { id: link.id }, data: {
      status: outcome, version: { increment: 1 }, updatedAt: now,
      resolvedDataHash: request.action === 'KEEP_LOCAL' ? hashKsefComparisonData(current) : null,
    } })
    const result: KsefResolutionResult = { draftId: draft.id, version: updated.version,
      reconciliationId: link.id, reconciliationVersion: updatedLink.version, outcome }
    await tx.invoiceDraftAudit.create({ data: {
      draftId: draft.id, actorId, action: `KSEF_${outcome}`, idempotencyKey: request.idempotencyKey,
      requestHash: hash, resultJson: JSON.stringify(result), createdAt: now,
      beforeJson: JSON.stringify({ draft: draftAuditState(draft), link: linkAuditState(link) }),
      afterJson: JSON.stringify({ draft: draftAuditState(updated), link: linkAuditState(updatedLink) }),
    } })
    return result
  })
}
