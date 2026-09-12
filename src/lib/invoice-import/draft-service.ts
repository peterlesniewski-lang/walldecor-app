import { z } from 'zod'
import type { AiJob, InvoiceAttachment, InvoiceImportDraft, Prisma, PrismaClient } from '@/generated/prisma'
import { aiJobKindSchema, aiJobStatusSchema, aiInvoiceResultSchema } from '@/lib/ai/contracts'
import { aiPauseReason, sanitizeAiFailureCode, type AiFailureCode, type AiPauseReason } from '@/lib/ai/queue-errors'
import { enqueueAiJobInTransaction, withAiQueueMutation } from '@/lib/ai/queue'
import {
  INVOICE_ATTACHMENT_ALLOWED_MIME_TYPES,
  INVOICE_ATTACHMENT_MAX_BYTES,
  INVOICE_ATTACHMENT_MAX_PDF_PAGES,
  INVOICE_IMPORT_MAX_FILES,
  INVOICE_MANUAL_FIELD_NAMES,
  invoiceDraftDataSchema,
  invoiceManualFieldsSchema,
  type InvoiceDraftData,
  type InvoiceManualField,
} from './contracts'
import { InvoiceImportError } from './errors'
import { KSEF_RECONCILIATION_STATE_SELECT, summarizeDraftKsefReconciliations, type StoredKsefReconciliationState } from './ksef-reconciliation-state'

type Transaction = Prisma.TransactionClient
type DraftState = 'OPEN' | 'APPROVED' | 'ARCHIVED'
const DRAFT_READ_INCLUDE = { attachment: true, latestAiJob: true,
  ksefReconciliations: { select: KSEF_RECONCILIATION_STATE_SELECT } } as const satisfies Prisma.InvoiceImportDraftInclude

const idSchema = z.string().trim().min(1).max(191)
const draftStateSchema = z.enum(['OPEN', 'APPROVED', 'ARCHIVED'])
const storageKeySchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/,
)
const originalNameSchema = z.string().trim().min(1).max(255).refine(
  (value) => !/[\\/\p{Cc}]/u.test(value) && value !== '.' && value !== '..',
)
const readyMetadataSchema = z.strictObject({
  storageKey: storageKeySchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  originalName: originalNameSchema,
  mimeType: z.enum(INVOICE_ATTACHMENT_ALLOWED_MIME_TYPES),
  byteSize: z.number().int().min(1).max(INVOICE_ATTACHMENT_MAX_BYTES),
  pageCount: z.number().int().min(1).max(INVOICE_ATTACHMENT_MAX_PDF_PAGES).nullable(),
}).superRefine((value, context) => {
  if (value.mimeType === 'application/pdf' && value.pageCount === null) {
    context.addIssue({ code: 'custom', path: ['pageCount'], message: 'PDF page count is required' })
  }
  if (value.mimeType !== 'application/pdf' && value.pageCount !== null) {
    context.addIssue({ code: 'custom', path: ['pageCount'], message: 'Image page count must be null' })
  }
})
const listFiltersSchema = z.strictObject({
  batchId: idSchema.optional(),
  state: draftStateSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
})

export interface InvoiceImportBatchDto {
  id: string
  ownerUserId: string
  createdAt: Date
}

export interface InvoiceDraftLatestJobDto {
  id: string
  kind: 'INVOICE_EXTRACT'
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED'
  errorCode: AiFailureCode | null
  blockedReason: AiPauseReason | null
  attempts: number
  warnings: string[]
  createdAt: Date
  updatedAt: Date
}

export interface InvoiceDraftSummaryDto {
  id: string
  batchId: string
  version: number
  extractionRevision: number
  state: DraftState
  skippedAt: Date | null
  invoiceId: string | null
  ksef: { linkedCount: number; conflictCount: number }
  display: {
    fileName: string
    supplierName: string | null
    invoiceNumber: string | null
    gross: number | null
    currency: string | null
  }
  latestJob: InvoiceDraftLatestJobDto | null
  createdAt: Date
  updatedAt: Date
}

export interface InvoiceDraftDetailDto extends InvoiceDraftSummaryDto {
  data: InvoiceDraftData
  manualFields: InvoiceManualField[]
  attachment: {
    id: string
    sha256: string
    originalName: string
    mimeType: string
    byteSize: number
    pageCount: number | null
    state: string
    createdAt: Date
    updatedAt: Date
  }
}

type DraftWithRelations = InvoiceImportDraft & {
  attachment: InvoiceAttachment
  latestAiJob: AiJob | null
  ksefReconciliations: StoredKsefReconciliationState[]
}

function invalidInput(): never {
  throw new InvoiceImportError('INVALID_INPUT', 422)
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) invalidInput()
  return parsed.data
}

async function authorizeAdmin(db: Pick<PrismaClient, 'user'>, actorId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: actorId },
    select: { role: true, isActive: true, mustChangePassword: true },
  })
  if (!user || user.role !== 'ADMIN' || !user.isActive || user.mustChangePassword) {
    throw new InvoiceImportError('FORBIDDEN', 403)
  }
}

function parseStoredJson<T>(schema: z.ZodType<T>, value: string): T {
  try {
    return schema.parse(JSON.parse(value))
  } catch {
    throw new InvoiceImportError('CORRUPT_DATA', 500)
  }
}

function latestJobDto(job: AiJob | null, pauseReason: string | null): InvoiceDraftLatestJobDto | null {
  if (!job) return null
  try {
    const kind = aiJobKindSchema.parse(job.kind)
    if (kind !== 'INVOICE_EXTRACT') throw new Error('Wrong draft job kind')
    const status = aiJobStatusSchema.parse(job.status)
    const errorCode = job.errorCode ? sanitizeAiFailureCode(job.errorCode) : null
    let warnings: string[] = []
    if (status === 'SUCCEEDED') {
      warnings = aiInvoiceResultSchema.parse(JSON.parse(job.resultJson ?? 'null')).warnings
    }
    return {
      id: job.id,
      kind,
      status,
      errorCode,
      blockedReason: status === 'QUEUED'
        ? (pauseReason ? aiPauseReason(sanitizeAiFailureCode(pauseReason)) : null)
        : status === 'BLOCKED' && errorCode ? aiPauseReason(errorCode) : null,
      attempts: job.attempts,
      warnings,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }
  } catch (error) {
    if (error instanceof InvoiceImportError) throw error
    throw new InvoiceImportError('CORRUPT_DATA', 500)
  }
}

function summaryDto(draft: DraftWithRelations, pauseReason: string | null): InvoiceDraftSummaryDto {
  const data = parseStoredJson(invoiceDraftDataSchema, draft.dataJson)
  return {
    id: draft.id,
    batchId: draft.batchId,
    version: draft.version,
    extractionRevision: draft.extractionRevision,
    state: parseInput(draftStateSchema, draft.state),
    skippedAt: draft.skippedAt,
    invoiceId: draft.invoiceId,
    ksef: summarizeDraftKsefReconciliations(draft.dataJson, draft.ksefReconciliations),
    display: {
      fileName: draft.attachment.originalName,
      supplierName: data.supplierName ?? null,
      invoiceNumber: data.invoiceNumber ?? null,
      gross: data.gross ?? null,
      currency: data.currency ?? null,
    },
    latestJob: latestJobDto(draft.latestAiJob, pauseReason),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  }
}

function detailDto(draft: DraftWithRelations, pauseReason: string | null): InvoiceDraftDetailDto {
  return {
    ...summaryDto(draft, pauseReason),
    data: parseStoredJson(invoiceDraftDataSchema, draft.dataJson),
    manualFields: parseStoredJson(invoiceManualFieldsSchema, draft.manualFieldsJson),
    attachment: {
      id: draft.attachment.id,
      sha256: draft.attachment.sha256,
      originalName: draft.attachment.originalName,
      mimeType: draft.attachment.mimeType,
      byteSize: draft.attachment.byteSize,
      pageCount: draft.attachment.pageCount,
      state: draft.attachment.state,
      createdAt: draft.attachment.createdAt,
      updatedAt: draft.attachment.updatedAt,
    },
  }
}

function auditSnapshot(draft: InvoiceImportDraft) {
  return JSON.stringify({
    version: draft.version,
    extractionRevision: draft.extractionRevision,
    state: draft.state,
    skippedAt: draft.skippedAt,
    latestAiJobId: draft.latestAiJobId,
    data: JSON.parse(draft.dataJson),
    manualFields: JSON.parse(draft.manualFieldsJson),
  })
}

async function findDraftForMutation(tx: Transaction, draftId: string): Promise<DraftWithRelations> {
  const draft = await tx.invoiceImportDraft.findUnique({
    where: { id: draftId },
    include: DRAFT_READ_INCLUDE,
  })
  if (!draft) throw new InvoiceImportError('NOT_FOUND', 404)
  return draft
}

function assertExpectedVersion(draft: InvoiceImportDraft, expectedVersion: number) {
  if (draft.version !== expectedVersion) throw new InvoiceImportError('STALE_VERSION', 409)
}

function assertOpen(draft: InvoiceImportDraft) {
  if (draft.state !== 'OPEN') throw new InvoiceImportError('INVALID_STATE', 409)
}

async function createAudit(
  tx: Transaction,
  draftId: string,
  action: string,
  actorId: string,
  beforeJson: string | null,
  afterJson: string,
  aiJobId?: string,
) {
  await tx.invoiceDraftAudit.create({ data: {
    draftId,
    action,
    actorId,
    aiJobId,
    beforeJson,
    afterJson,
  } })
}

async function cancelLatestQueuedJob(tx: Transaction, draft: DraftWithRelations) {
  if (draft.latestAiJob?.status !== 'QUEUED') return
  await tx.aiJob.updateMany({
    where: { id: draft.latestAiJob.id, status: 'QUEUED' },
    data: {
      status: 'CANCELLED',
      resultJson: null,
      errorCode: null,
      workerId: null,
      leaseToken: null,
      leaseUntil: null,
    },
  })
}

async function mutateExisting(
  db: PrismaClient,
  actorId: string,
  draftIdInput: string,
  expectedVersionInput: number,
  operation: (tx: Transaction, draft: DraftWithRelations, now: Date) => Promise<InvoiceImportDraft>,
  resumePausedQueue = false,
): Promise<InvoiceDraftDetailDto> {
  const draftId = parseInput(idSchema, draftIdInput)
  const expectedVersion = parseInput(z.number().int().min(1), expectedVersionInput)
  return withAiQueueMutation(db, () => new Date(), async (tx, lease, now) => {
    await authorizeAdmin(tx, actorId)
    const draft = await findDraftForMutation(tx, draftId)
    assertExpectedVersion(draft, expectedVersion)
    const updated = await operation(tx, draft, now)
    if (resumePausedQueue) {
      await tx.aiQueueLease.update({ where: { id: 'shared-ai' }, data: { pauseReason: null } })
    }
    const hydrated = await tx.invoiceImportDraft.findUniqueOrThrow({
      where: { id: updated.id }, include: DRAFT_READ_INCLUDE,
    })
    return detailDto(hydrated, resumePausedQueue ? null : lease.pauseReason)
  })
}

export async function createBatch(db: PrismaClient, actorId: string): Promise<InvoiceImportBatchDto> {
  return withAiQueueMutation(db, () => new Date(), async (tx) => {
    await authorizeAdmin(tx, actorId)
    return tx.invoiceImportBatch.create({ data: { ownerUserId: actorId } })
  })
}

export async function registerReadyDraft(
  db: PrismaClient,
  actorId: string,
  batchIdInput: string,
  rawMetadata: unknown,
): Promise<{ draft: InvoiceDraftDetailDto; deduplicated: boolean }> {
  const batchId = parseInput(idSchema, batchIdInput)
  const metadata = parseInput(readyMetadataSchema, rawMetadata)
  return withAiQueueMutation(db, () => new Date(), async (tx, lease) => {
    await authorizeAdmin(tx, actorId)
    const batch = await tx.invoiceImportBatch.findFirst({ where: { id: batchId, ownerUserId: actorId } })
    if (!batch) throw new InvoiceImportError('NOT_FOUND', 404)

    const duplicate = await tx.invoiceAttachment.findUnique({
      where: { sha256: metadata.sha256 },
      include: { draft: { include: DRAFT_READ_INCLUDE } },
    })
    if (duplicate) {
      if (duplicate.state !== 'READY' || !duplicate.draft) {
        throw new InvoiceImportError('DUPLICATE_UNAVAILABLE', 409)
      }
      return { draft: detailDto(duplicate.draft, lease.pauseReason), deduplicated: true }
    }

    const draftCount = await tx.invoiceImportDraft.count({ where: { batchId } })
    if (draftCount >= INVOICE_IMPORT_MAX_FILES) throw new InvoiceImportError('BATCH_LIMIT', 409)

    const attachment = await tx.invoiceAttachment.create({ data: {
      ...metadata,
      state: 'READY',
      createdById: actorId,
    } })
    const draft = await tx.invoiceImportDraft.create({ data: {
      batchId,
      attachmentId: attachment.id,
      extractionRevision: 1,
    } })
    const job = await enqueueAiJobInTransaction(tx, actorId, {
      kind: 'INVOICE_EXTRACT',
      payload: { draftId: draft.id, attachmentId: attachment.id, revision: 1 },
    })
    const updated = await tx.invoiceImportDraft.update({
      where: { id: draft.id }, data: { latestAiJobId: job.id },
    })
    await createAudit(tx, draft.id, 'CREATED', actorId, null, auditSnapshot(updated), job.id)
    const hydrated = await tx.invoiceImportDraft.findUniqueOrThrow({
      where: { id: draft.id }, include: DRAFT_READ_INCLUDE,
    })
    return { draft: detailDto(hydrated, lease.pauseReason), deduplicated: false }
  })
}

export async function listDrafts(
  db: PrismaClient,
  actorId: string,
  rawFilters: { batchId?: string; state?: DraftState; limit?: number } = {},
): Promise<InvoiceDraftSummaryDto[]> {
  const filters = parseInput(listFiltersSchema, rawFilters)
  await authorizeAdmin(db, actorId)
  const [drafts, lease] = await Promise.all([
    db.invoiceImportDraft.findMany({
      where: { batchId: filters.batchId, state: filters.state },
      include: DRAFT_READ_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filters.limit,
    }),
    db.aiQueueLease.findUnique({ where: { id: 'shared-ai' } }),
  ])
  return drafts.map((draft) => summaryDto(draft, lease?.pauseReason ?? null))
}

export async function getDraft(db: PrismaClient, actorId: string, draftIdInput: string): Promise<InvoiceDraftDetailDto> {
  const draftId = parseInput(idSchema, draftIdInput)
  await authorizeAdmin(db, actorId)
  const [draft, lease] = await Promise.all([
    db.invoiceImportDraft.findUnique({
      where: { id: draftId }, include: DRAFT_READ_INCLUDE,
    }),
    db.aiQueueLease.findUnique({ where: { id: 'shared-ai' } }),
  ])
  if (!draft) throw new InvoiceImportError('NOT_FOUND', 404)
  return detailDto(draft, lease?.pauseReason ?? null)
}

export async function editDraft(
  db: PrismaClient,
  actorId: string,
  draftId: string,
  expectedVersion: number,
  rawPatch: unknown,
): Promise<InvoiceDraftDetailDto> {
  const patch = parseInput(invoiceDraftDataSchema, rawPatch)
  return mutateExisting(db, actorId, draftId, expectedVersion, async (tx, draft) => {
    assertOpen(draft)
    const currentData = parseStoredJson(invoiceDraftDataSchema, draft.dataJson)
    const currentManualFields = parseStoredJson(invoiceManualFieldsSchema, draft.manualFieldsJson)
    const definedEntries = Object.entries(patch).filter(([, value]) => value !== undefined) as Array<[InvoiceManualField, unknown]>
    const patchValues = Object.fromEntries(definedEntries) as InvoiceDraftData
    const conversionBasisFields = ['currency', 'gross', 'net', 'vat'] as const
    const touchesConversionBasis = conversionBasisFields.some((field) =>
      definedEntries.some(([changedField]) => changedField === field),
    )
    let nextData = invoiceDraftDataSchema.parse({ ...currentData, ...patchValues })
    if (patchValues.conversionConfirmed === true) {
      if (nextData.currency == null || nextData.currency === 'PLN' || typeof nextData.gross !== 'number') {
        invalidInput()
      }
    } else if (touchesConversionBasis) {
      nextData = invoiceDraftDataSchema.parse({ ...nextData, conversionConfirmed: false })
    }
    const changedFields = new Set<InvoiceManualField>([
      ...currentManualFields,
      ...definedEntries.map(([field]) => field),
    ])
    if (patchValues.conversionConfirmed === true) {
      for (const field of conversionBasisFields) changedFields.add(field)
    } else if (touchesConversionBasis) {
      changedFields.add('conversionConfirmed')
    }
    const manualFields = INVOICE_MANUAL_FIELD_NAMES.filter((field) => changedFields.has(field))
    const beforeJson = auditSnapshot(draft)
    const updated = await tx.invoiceImportDraft.update({
      where: { id: draft.id },
      data: {
        dataJson: JSON.stringify(nextData),
        manualFieldsJson: JSON.stringify(manualFields),
        version: { increment: 1 },
      },
    })
    await createAudit(tx, draft.id, 'EDITED', actorId, beforeJson, auditSnapshot(updated))
    return updated
  })
}

export async function skipDraft(
  db: PrismaClient,
  actorId: string,
  draftId: string,
  expectedVersion: number,
): Promise<InvoiceDraftDetailDto> {
  return mutateExisting(db, actorId, draftId, expectedVersion, async (tx, draft, now) => {
    assertOpen(draft)
    const beforeJson = auditSnapshot(draft)
    const updated = await tx.invoiceImportDraft.update({
      where: { id: draft.id }, data: { skippedAt: now, version: { increment: 1 } },
    })
    await createAudit(tx, draft.id, 'SKIPPED', actorId, beforeJson, auditSnapshot(updated))
    return updated
  })
}

export async function archiveDraft(
  db: PrismaClient,
  actorId: string,
  draftId: string,
  expectedVersion: number,
): Promise<InvoiceDraftDetailDto> {
  return mutateExisting(db, actorId, draftId, expectedVersion, async (tx, draft) => {
    assertOpen(draft)
    const beforeJson = auditSnapshot(draft)
    await cancelLatestQueuedJob(tx, draft)
    const updated = await tx.invoiceImportDraft.update({
      where: { id: draft.id }, data: { state: 'ARCHIVED', latestAiJobId: null, version: { increment: 1 } },
    })
    await createAudit(tx, draft.id, 'ARCHIVED', actorId, beforeJson, auditSnapshot(updated))
    return updated
  })
}

export async function restoreDraft(
  db: PrismaClient,
  actorId: string,
  draftId: string,
  expectedVersion: number,
): Promise<InvoiceDraftDetailDto> {
  return mutateExisting(db, actorId, draftId, expectedVersion, async (tx, draft) => {
    if (draft.state !== 'ARCHIVED') throw new InvoiceImportError('INVALID_STATE', 409)
    const beforeJson = auditSnapshot(draft)
    const updated = await tx.invoiceImportDraft.update({
      where: { id: draft.id }, data: { state: 'OPEN', latestAiJobId: null, version: { increment: 1 } },
    })
    await createAudit(tx, draft.id, 'RESTORED', actorId, beforeJson, auditSnapshot(updated))
    return updated
  })
}

export async function requestExtraction(
  db: PrismaClient,
  actorId: string,
  draftId: string,
  expectedVersion: number,
): Promise<InvoiceDraftDetailDto> {
  return mutateExisting(db, actorId, draftId, expectedVersion, async (tx, draft) => {
    assertOpen(draft)
    if (draft.attachment.state !== 'READY') throw new InvoiceImportError('ATTACHMENT_NOT_READY', 409)
    const revision = draft.extractionRevision + 1
    const beforeJson = auditSnapshot(draft)
    await cancelLatestQueuedJob(tx, draft)
    const job = await enqueueAiJobInTransaction(tx, actorId, {
      kind: 'INVOICE_EXTRACT',
      payload: { draftId: draft.id, attachmentId: draft.attachmentId, revision },
    })
    const updated = await tx.invoiceImportDraft.update({
      where: { id: draft.id },
      data: { extractionRevision: revision, latestAiJobId: job.id, version: { increment: 1 } },
    })
    await createAudit(tx, draft.id, 'EXTRACTION_REQUESTED', actorId, beforeJson, auditSnapshot(updated), job.id)
    return updated
  }, true)
}
