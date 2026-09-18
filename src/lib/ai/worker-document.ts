import { z } from 'zod'
import type { AiQueueLease, PrismaClient } from '@/generated/prisma'
import { getInvoiceOriginal, type InvoiceFileEnvironment } from '@/lib/invoice-import/file-service'
import { aiInvoicePayloadSchema } from './contracts'
import { withAiQueueMutation, type AiQueueClock, type AiQueueTransaction } from './queue'
import { AiQueueError } from './queue-errors'

const id = z.string().trim().min(1).max(191)

export const invoiceWorkerDocumentRequestSchema = z.strictObject({
  workerId: id,
  jobId: id,
  leaseToken: z.uuid(),
  attachmentId: id,
})

export type InvoiceWorkerDocumentRequest = z.infer<typeof invoiceWorkerDocumentRequestSchema>

function deny(): never {
  throw new AiQueueError('LEASE_LOST', 409)
}

async function assertCurrentBinding(
  tx: AiQueueTransaction,
  globalLease: AiQueueLease,
  request: InvoiceWorkerDocumentRequest,
  now: Date,
): Promise<{ ownerUserId: string; draftId: string }> {
  if (
    globalLease.workerId !== request.workerId ||
    globalLease.leaseToken !== request.leaseToken ||
    !globalLease.leaseUntil ||
    globalLease.leaseUntil <= now
  ) deny()

  const job = await tx.aiJob.findUnique({
    where: { id: request.jobId },
    select: {
      kind: true,
      status: true,
      payloadJson: true,
      ownerUserId: true,
      workerId: true,
      leaseToken: true,
      leaseUntil: true,
    },
  })
  if (
    !job ||
    job.kind !== 'INVOICE_EXTRACT' ||
    job.status !== 'RUNNING' ||
    job.workerId !== request.workerId ||
    job.leaseToken !== request.leaseToken ||
    !job.leaseUntil ||
    job.leaseUntil <= now
  ) deny()

  let storedPayload: unknown
  try { storedPayload = JSON.parse(job.payloadJson) }
  catch { deny() }
  const payload = aiInvoicePayloadSchema.safeParse(storedPayload)
  if (!payload.success || payload.data.attachmentId !== request.attachmentId) deny()

  const [owner, draft] = await Promise.all([
    tx.user.findUnique({
      where: { id: job.ownerUserId },
      select: { role: true, isActive: true, mustChangePassword: true },
    }),
    tx.invoiceImportDraft.findUnique({
      where: { id: payload.data.draftId },
      select: {
        state: true,
        extractionRevision: true,
        attachmentId: true,
        latestAiJobId: true,
        attachment: { select: { state: true } },
      },
    }),
  ])
  if (
    !owner ||
    owner.role !== 'ADMIN' ||
    !owner.isActive ||
    owner.mustChangePassword ||
    !draft ||
    draft.state !== 'OPEN' ||
    draft.extractionRevision !== payload.data.revision ||
    draft.attachmentId !== payload.data.attachmentId ||
    draft.latestAiJobId !== request.jobId ||
    draft.attachment.state !== 'READY'
  ) deny()

  return { ownerUserId: job.ownerUserId, draftId: payload.data.draftId }
}

/**
 * Resolves exactly the original bound to the currently fenced invoice job.
 * Queue validation uses the shared writer-first transaction, while filesystem
 * and native document inspection deliberately happen after that transaction.
 */
export async function getInvoiceWorkerDocument(
  db: PrismaClient,
  rawRequest: unknown,
  environment: InvoiceFileEnvironment,
  clock: AiQueueClock = () => new Date(),
) {
  const parsed = invoiceWorkerDocumentRequestSchema.safeParse(rawRequest)
  if (!parsed.success) throw new AiQueueError('INVALID_INPUT', 400)
  const request = parsed.data
  const binding = await withAiQueueMutation(db, clock, (tx, lease, now) =>
    assertCurrentBinding(tx, lease, request, now))

  let original: Awaited<ReturnType<typeof getInvoiceOriginal>>
  try {
    original = await getInvoiceOriginal(db, binding.ownerUserId, binding.draftId, environment)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error &&
      ['FORBIDDEN', 'NOT_FOUND', 'INVALID_INPUT'].includes(String(error.code))) deny()
    throw error
  }

  const current = await withAiQueueMutation(db, clock, (tx, lease, now) =>
    assertCurrentBinding(tx, lease, request, now))
  if (current.ownerUserId !== binding.ownerUserId || current.draftId !== binding.draftId ||
    original.byteSize !== original.bytes.byteLength) deny()

  return {
    bytes: original.bytes,
    mimeType: original.mimeType,
    byteSize: original.byteSize,
    sha256: original.sha256,
  }
}
