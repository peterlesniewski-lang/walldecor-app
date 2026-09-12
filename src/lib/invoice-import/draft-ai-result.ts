import type { AiJob, Prisma } from '@/generated/prisma'
import { aiInvoicePayloadSchema, aiInvoiceResultSchema } from '@/lib/ai/contracts'
import { applyInvoiceAiFields, invoiceManualFieldsSchema } from './contracts'

function auditSnapshot(draft: {
  version: number
  extractionRevision: number
  state: string
  skippedAt: Date | null
  latestAiJobId: string | null
  dataJson: string
  manualFieldsJson: string
}) {
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

/** Runs inside the queue completion transaction. Any storage/audit failure must
 * escape so both the job completion and draft merge roll back together. */
export async function applyInvoiceDraftAiResultInTransaction(
  tx: Prisma.TransactionClient,
  job: AiJob,
  rawResult: unknown,
): Promise<void> {
  if (job.kind !== 'INVOICE_EXTRACT') return

  const payload = aiInvoicePayloadSchema.parse(JSON.parse(job.payloadJson))
  const result = aiInvoiceResultSchema.parse(rawResult)
  const draft = await tx.invoiceImportDraft.findUnique({ where: { id: payload.draftId } })

  // Pre-foundation queue fixtures and legacy durable jobs may not have a draft.
  if (!draft) return

  const beforeJson = auditSnapshot(draft)
  const owner = await tx.user.findUnique({
    where: { id: job.ownerUserId },
    select: { role: true, isActive: true, mustChangePassword: true },
  })
  if (!owner || owner.role !== 'ADMIN' || !owner.isActive || owner.mustChangePassword) {
    await tx.invoiceDraftAudit.create({ data: {
      draftId: draft.id,
      action: 'AI_RESULT_STALE_SKIPPED',
      aiJobId: job.id,
      beforeJson,
      afterJson: beforeJson,
      resultJson: JSON.stringify({ reason: 'ACCESS_REVOKED' }),
    } })
    return
  }
  const eligible = draft.state === 'OPEN' &&
    draft.latestAiJobId === job.id &&
    draft.attachmentId === payload.attachmentId &&
    draft.extractionRevision === payload.revision

  if (!eligible) {
    await tx.invoiceDraftAudit.create({ data: {
      draftId: draft.id,
      action: 'AI_RESULT_STALE_SKIPPED',
      aiJobId: job.id,
      beforeJson,
      afterJson: beforeJson,
    } })
    return
  }

  const manualFields = invoiceManualFieldsSchema.parse(JSON.parse(draft.manualFieldsJson))
  const data = applyInvoiceAiFields(JSON.parse(draft.dataJson), manualFields, result)
  const updated = await tx.invoiceImportDraft.update({
    where: { id: draft.id },
    data: { dataJson: JSON.stringify(data), version: { increment: 1 } },
  })
  await tx.invoiceDraftAudit.create({ data: {
    draftId: draft.id,
    action: 'AI_RESULT_APPLIED',
    aiJobId: job.id,
    beforeJson,
    afterJson: auditSnapshot(updated),
  } })
}
