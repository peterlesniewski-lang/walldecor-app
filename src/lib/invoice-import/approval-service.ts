import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { InvoiceImportDraft, KsefInvoice, Prisma, PrismaClient } from '@/generated/prisma'
import { withAiQueueMutation } from '@/lib/ai/queue'
import { isSingleChoiceTagGroup } from '@/lib/finance/cost-tags'
import { invalidateClosedInvoicePeriods } from './closed-periods'
import { invoiceDraftDataSchema } from './contracts'
import { findExistingInvoiceDuplicate } from './duplicate-lookup'
import { validateInvoiceApproval, type ApprovalIssue, type ApprovedInvoiceData } from './approval-policy'
import { assertDraftKsefReconciled } from './ksef-reconciliation-service'

type Transaction = Prisma.TransactionClient
type Action = 'APPROVE' | 'REVOKE'

const draftIdSchema = z.string().min(1).max(191)
const mutationInputSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(191),
  confirmedPeriodIds: z.array(z.string().min(1).max(191))
    .max(24)
    .refine((ids) => new Set(ids).size === ids.length)
    .default([]),
})
const resultIdSchema = z.string().min(1).max(191).refine((id) => id.trim().length > 0)
const periodSchema = z.strictObject({
  id: resultIdSchema, year: z.number().int(), month: z.number().int(), closedAt: z.string(),
})
const resultBase = {
  draftId: resultIdSchema, version: z.number().int().positive(), invoiceId: resultIdSchema,
  invalidatedPeriods: z.array(periodSchema).optional(),
}
const resultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ ...resultBase, outcome: z.literal('APPROVED'), costEventId: resultIdSchema }),
  z.strictObject({ ...resultBase, outcome: z.literal('REVOKED'), costEventId: resultIdSchema }),
  z.strictObject({
    outcome: z.literal('DUPLICATE'), draftId: resultIdSchema, version: z.number().int().positive(),
    invoiceId: resultIdSchema, costEventId: z.null(), existingDraftId: resultIdSchema.optional(),
  }),
])

export type InvoiceDraftMutationResult = z.infer<typeof resultSchema>

export class InvoiceApprovalError extends Error {
  constructor(
    readonly code: string,
    readonly status: 403 | 404 | 409 | 422 | 500,
    readonly issues?: ApprovalIssue[],
  ) {
    super(code)
    this.name = 'InvoiceApprovalError'
  }
}

function fail(code: string, status: 403 | 404 | 409 | 422 | 500, issues?: ApprovalIssue[]): never {
  throw new InvoiceApprovalError(code, status, issues)
}

function parseRequest(draftIdInput: string, input: unknown) {
  const draftId = draftIdSchema.safeParse(draftIdInput)
  const parsed = mutationInputSchema.safeParse(input)
  if (!draftId.success || !parsed.success) fail('INVALID_INPUT', 422)
  return { draftId: draftId.data, ...parsed.data }
}

function requestHash(action: Action, draftId: string, expectedVersion: number, confirmedPeriodIds: string[]) {
  return createHash('sha256').update(JSON.stringify({
    action, draftId, expectedVersion, confirmedPeriodIds: [...confirmedPeriodIds].sort(),
  })).digest('hex')
}

async function authorizeAdmin(tx: Transaction, actorId: string) {
  const user = await tx.user.findUnique({
    where: { id: actorId }, select: { role: true, isActive: true, mustChangePassword: true },
  })
  if (!user || user.role !== 'ADMIN' || !user.isActive || user.mustChangePassword) fail('FORBIDDEN', 403)
}

async function existingReceipt(
  tx: Transaction, actorId: string, idempotencyKey: string, hash: string,
  action: Action, draftId: string,
): Promise<InvoiceDraftMutationResult | null> {
  const receipt = await tx.invoiceDraftAudit.findUnique({
    where: { actorId_idempotencyKey: { actorId, idempotencyKey } },
  })
  if (!receipt) return null
  const expectedAction = action === 'APPROVE' ? ['APPROVED', 'APPROVAL_DUPLICATE'] : ['REVOKED']
  if (receipt.requestHash !== hash || receipt.draftId !== draftId || !expectedAction.includes(receipt.action)) {
    fail('IDEMPOTENCY_CONFLICT', 409)
  }
  try {
    const result = resultSchema.parse(JSON.parse(receipt.resultJson ?? 'null'))
    const outcomeMatches = (receipt.action === 'APPROVED' && result.outcome === 'APPROVED')
      || (receipt.action === 'APPROVAL_DUPLICATE' && result.outcome === 'DUPLICATE')
      || (receipt.action === 'REVOKED' && result.outcome === 'REVOKED')
    if (result.draftId !== draftId || !outcomeMatches) throw new Error('Receipt/result mismatch')
    return result
  } catch { fail('CORRUPT_RECEIPT', 500) }
}

function approvalIssues(code: string, field: ApprovalIssue['field'], messagePolish: string): never {
  fail('APPROVAL_VALIDATION_FAILED', 422, [{ field, code, messagePolish }])
}

function parseApprovalData(value: string) {
  let raw: unknown
  try { raw = JSON.parse(value) }
  catch { approvalIssues('INVALID_DRAFT', '$', 'Dane szkicu są nieprawidłowe.') }
  const parsed = invoiceDraftDataSchema.safeParse(raw)
  const validation = validateInvoiceApproval(parsed.success ? parsed.data : raw)
  if (!validation.ok) fail('APPROVAL_VALIDATION_FAILED', 422, validation.issues)
  return validation
}

async function validateClassification(tx: Transaction, data: ApprovedInvoiceData) {
  if (!await tx.costCenter.findUnique({ where: { id: data.costCenterId } })) {
    approvalIssues('COST_CENTER_NOT_FOUND', 'costCenterId', 'Wybrane centrum kosztów nie istnieje.')
  }
  const tags = await tx.costTag.findMany({ where: { id: { in: data.tagIds } }, include: { group: true } })
  if (tags.length !== data.tagIds.length) {
    approvalIssues('TAG_NOT_FOUND', 'tagIds', 'Co najmniej jeden wybrany tag nie istnieje.')
  }
  if (tags.some((tag) => !tag.active)) {
    approvalIssues('TAG_INACTIVE', 'tagIds', 'Nieaktywny tag nie może zostać użyty.')
  }
  const counts = new Map<string, number>()
  for (const tag of tags) counts.set(tag.group.slug, (counts.get(tag.group.slug) ?? 0) + 1)
  if ([...counts].some(([group, count]) => isSingleChoiceTagGroup(group) && count > 1)) {
    approvalIssues('CONTRADICTORY_TAGS', 'tagIds', 'W grupie jednokrotnego wyboru można wskazać tylko jeden tag.')
  }
  if ((counts.get('behavior') ?? 0) !== 1) {
    approvalIssues('BEHAVIOR_TAG_REQUIRED', 'tagIds', 'Wybierz dokładnie jeden tag charakteru kosztu.')
  }
  return tags
}

const utcDate = (value: string) => new Date(`${value}T00:00:00.000Z`)

function draftSnapshot(draft: InvoiceImportDraft) {
  let data: unknown = null
  try { data = JSON.parse(draft.dataJson) } catch { data = null }
  return { id: draft.id, version: draft.version, state: draft.state, invoiceId: draft.invoiceId,
    latestAiJobId: draft.latestAiJobId, skippedAt: draft.skippedAt, data }
}

function invoiceSnapshot(invoice: KsefInvoice) {
  return { id: invoice.id, source: invoice.source, status: invoice.status,
    documentStatus: invoice.documentStatus, supplierName: invoice.supplierName,
    supplierNip: invoice.supplierNip, invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate, grossAmount: invoice.grossAmount, netAmount: invoice.netAmount,
    vatAmount: invoice.vatAmount, currency: invoice.currency,
    reportingGrossAmount: invoice.reportingGrossAmount,
    reportingNetAmount: invoice.reportingNetAmount, reportingVatAmount: invoice.reportingVatAmount }
}

async function saveReceipt(tx: Transaction, values: {
  draftId: string; action: 'APPROVED' | 'APPROVAL_DUPLICATE' | 'REVOKED'; actorId: string
  idempotencyKey: string; hash: string; before: unknown; after: unknown; result: InvoiceDraftMutationResult
}) {
  await tx.invoiceDraftAudit.create({ data: {
    draftId: values.draftId, action: values.action, actorId: values.actorId,
    idempotencyKey: values.idempotencyKey, requestHash: values.hash,
    beforeJson: JSON.stringify(values.before), afterJson: JSON.stringify(values.after),
    resultJson: JSON.stringify(values.result),
  } })
}

async function clearCurrentInvoiceParts(tx: Transaction, invoiceId: string) {
  const partIds = (await tx.ksefInvoicePart.findMany({ where: { invoiceId }, select: { id: true } })).map((part) => part.id)
  if (!partIds.length) return
  await tx.ksefInvoicePartTag.deleteMany({ where: { partId: { in: partIds } } })
  await tx.ksefInvoicePartAllocation.deleteMany({ where: { partId: { in: partIds } } })
  await tx.ksefInvoicePart.deleteMany({ where: { id: { in: partIds } } })
}

async function cancelLatestQueuedJob(tx: Transaction, draft: InvoiceImportDraft) {
  if (!draft.latestAiJobId) return
  await tx.aiJob.updateMany({ where: { id: draft.latestAiJobId, status: 'QUEUED' }, data: {
    status: 'CANCELLED', resultJson: null, errorCode: null, workerId: null, leaseToken: null, leaseUntil: null,
  } })
}

function invoiceValues(data: ApprovedInvoiceData, reporting: { gross: number; net: number | null; vat: number | null }, actorId: string, now: Date) {
  const foreign = data.currency !== 'PLN'
  return {
    supplierName: data.supplierName, supplierNip: data.taxId ?? null, invoiceNumber: data.invoiceNumber,
    issueDate: utcDate(data.issueDate), grossAmount: data.gross, netAmount: data.net ?? null,
    vatAmount: data.vat ?? null, currency: data.currency, reportingGrossAmount: reporting.gross,
    reportingNetAmount: reporting.net, reportingVatAmount: reporting.vat,
    originalCurrency: foreign ? data.currency : null, originalGrossAmount: foreign ? data.gross : null,
    originalNetAmount: foreign ? data.net ?? null : null, originalVatAmount: foreign ? data.vat ?? null : null,
    currencyConversionNote: foreign ? data.conversionNote ?? null : null,
    convertedById: foreign ? actorId : null, convertedAt: foreign ? now : null,
    status: 'APPROVED', documentStatus: 'ACTIVE', paymentStatus: data.paymentStatus,
    paidAt: data.paidAt ? utcDate(data.paidAt) : null, dueDate: data.dueDate ? utcDate(data.dueDate) : null,
    bankAccount: data.bankAccount ?? null, notes: data.notes ?? null, costCenterId: data.costCenterId,
  }
}

export async function approveInvoiceDraft(db: PrismaClient, actorId: string, draftIdInput: string, input: unknown): Promise<InvoiceDraftMutationResult> {
  const request = parseRequest(draftIdInput, input)
  const hash = requestHash('APPROVE', request.draftId, request.expectedVersion, request.confirmedPeriodIds)
  return withAiQueueMutation(db, () => new Date(), async (tx, _lease, now) => {
    await authorizeAdmin(tx, actorId)
    const prior = await existingReceipt(tx, actorId, request.idempotencyKey, hash, 'APPROVE', request.draftId)
    if (prior) return prior
    const draft = await tx.invoiceImportDraft.findUnique({ where: { id: request.draftId }, include: { attachment: true, invoice: true } })
    if (!draft) fail('NOT_FOUND', 404)
    if (draft.version !== request.expectedVersion) fail('STALE_VERSION', 409)
    if (draft.state !== 'OPEN') fail('INVALID_STATE', 409)
    if (draft.attachment.state !== 'READY') fail('ATTACHMENT_NOT_READY', 409)
    const validated = parseApprovalData(draft.dataJson)
    const tags = await validateClassification(tx, validated.data)
    await assertDraftKsefReconciled(tx, draft)
    const issueDate = utcDate(validated.data.issueDate)
    const duplicate = await findExistingInvoiceDuplicate(tx, validated.data, draft.invoiceId)
    const before = draftSnapshot(draft)
    if (duplicate) {
      const result: InvoiceDraftMutationResult = { outcome: 'DUPLICATE', draftId: draft.id,
        version: draft.version, invoiceId: duplicate.id, costEventId: null,
        ...(duplicate.invoiceImportDraft ? { existingDraftId: duplicate.invoiceImportDraft.id } : {}) }
      await saveReceipt(tx, { draftId: draft.id, action: 'APPROVAL_DUPLICATE', actorId,
        idempotencyKey: request.idempotencyKey, hash, before, after: before, result })
      return result
    }
    let oldIssueDate: Date | null = null
    let invoice: KsefInvoice
    if (draft.invoice) {
      oldIssueDate = draft.invoice.issueDate
      if (draft.invoice.status !== 'MAPPED' || draft.invoice.documentStatus !== 'ACTIVE') fail('INVOICE_CONFLICT', 409)
      if (await tx.costEvent.count({ where: { sourceInvoiceId: draft.invoice.id } })) fail('COST_CONFLICT', 409)
      await clearCurrentInvoiceParts(tx, draft.invoice.id)
      invoice = await tx.ksefInvoice.update({ where: { id: draft.invoice.id }, data: invoiceValues(validated.data, validated.reporting, actorId, now) })
    } else {
      invoice = await tx.ksefInvoice.create({ data: { source: 'MANUAL', ...invoiceValues(validated.data, validated.reporting, actorId, now) } })
    }
    await tx.ksefInvoicePart.create({ data: { invoiceId: invoice.id, label: validated.data.invoiceNumber,
      grossAmount: validated.reporting.gross, tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
      allocations: { create: { costCenterId: validated.data.costCenterId, percent: 100 } } } })
    const costEvent = await tx.costEvent.create({ data: { source: 'MANUAL', sourceInvoiceId: invoice.id,
      eventDate: issueDate, supplierName: validated.data.supplierName, supplierNip: validated.data.taxId ?? null,
      reference: validated.data.invoiceNumber, grossAmount: validated.reporting.gross,
      netAmount: validated.reporting.net, vatAmount: validated.reporting.vat, currency: 'PLN',
      status: 'APPROVED', documentStatus: 'ACTIVE', isConfidential: tags.some((tag) => tag.slug === 'confidential'),
      createdById: actorId, parts: { create: { label: validated.data.invoiceNumber,
        grossAmount: validated.reporting.gross, tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
        allocations: { create: { costCenterId: validated.data.costCenterId, percent: 100 } } } } } })
    const dates = oldIssueDate && oldIssueDate.getTime() !== issueDate.getTime() ? [issueDate, oldIssueDate] : [issueDate]
    const invalidated = await invalidateClosedInvoicePeriods(tx, { actorId, invoiceId: invoice.id,
      costEventId: costEvent.id, reason: 'invoice.approve', dates, confirmedPeriodIds: request.confirmedPeriodIds })
    await cancelLatestQueuedJob(tx, draft)
    const updated = await tx.invoiceImportDraft.update({ where: { id: draft.id }, data: { state: 'APPROVED',
      version: { increment: 1 }, dataJson: JSON.stringify(validated.data), latestAiJobId: null,
      skippedAt: null, invoiceId: invoice.id } })
    await tx.costAuditLog.create({ data: { action: 'invoice.approve', actorId, invoiceId: invoice.id,
      costEventId: costEvent.id, beforeJson: JSON.stringify(draft.invoice ? invoiceSnapshot(draft.invoice) : null),
      afterJson: JSON.stringify({ invoice: invoiceSnapshot(invoice), costEvent: { id: costEvent.id,
        status: costEvent.status, sourceInvoiceId: invoice.id } }) } })
    const result: InvoiceDraftMutationResult = { outcome: 'APPROVED', draftId: draft.id, version: updated.version,
      invoiceId: invoice.id, costEventId: costEvent.id,
      ...(invalidated.length ? { invalidatedPeriods: invalidated } : {}) }
    await saveReceipt(tx, { draftId: draft.id, action: 'APPROVED', actorId,
      idempotencyKey: request.idempotencyKey, hash, before, after: draftSnapshot(updated), result })
    return result
  })
}

export async function revokeInvoiceDraft(db: PrismaClient, actorId: string, draftIdInput: string, input: unknown): Promise<InvoiceDraftMutationResult> {
  const request = parseRequest(draftIdInput, input)
  const hash = requestHash('REVOKE', request.draftId, request.expectedVersion, request.confirmedPeriodIds)
  return withAiQueueMutation(db, () => new Date(), async (tx) => {
    await authorizeAdmin(tx, actorId)
    const prior = await existingReceipt(tx, actorId, request.idempotencyKey, hash, 'REVOKE', request.draftId)
    if (prior) return prior
    const draft = await tx.invoiceImportDraft.findUnique({ where: { id: request.draftId }, include: { invoice: true } })
    if (!draft) fail('NOT_FOUND', 404)
    if (draft.version !== request.expectedVersion) fail('STALE_VERSION', 409)
    if (draft.state !== 'APPROVED' || !draft.invoice || draft.invoice.status !== 'APPROVED'
      || draft.invoice.documentStatus !== 'ACTIVE') fail('INVALID_STATE', 409)
    const activeCosts = await tx.costEvent.findMany({ where: { sourceInvoiceId: draft.invoice.id,
      status: 'APPROVED', documentStatus: 'ACTIVE' } })
    if (activeCosts.length !== 1) fail('COST_CONFLICT', 409)
    const costEvent = activeCosts[0]
    const invalidated = await invalidateClosedInvoicePeriods(tx, { actorId, invoiceId: draft.invoice.id,
      costEventId: costEvent.id, reason: 'invoice.revoke', dates: [costEvent.eventDate, draft.invoice.issueDate],
      confirmedPeriodIds: request.confirmedPeriodIds })
    await tx.costEvent.update({ where: { id: costEvent.id }, data: { status: 'VOID', sourceInvoiceId: null } })
    const invoice = await tx.ksefInvoice.update({ where: { id: draft.invoice.id }, data: { status: 'MAPPED', documentStatus: 'ACTIVE' } })
    const before = draftSnapshot(draft)
    const updated = await tx.invoiceImportDraft.update({ where: { id: draft.id }, data: { state: 'OPEN',
      version: { increment: 1 }, latestAiJobId: null } })
    await tx.costAuditLog.create({ data: { action: 'invoice.revoke', actorId, invoiceId: invoice.id,
      costEventId: costEvent.id, beforeJson: JSON.stringify({ invoice: invoiceSnapshot(draft.invoice),
        costEvent: { id: costEvent.id, status: costEvent.status, sourceInvoiceId: costEvent.sourceInvoiceId } }),
      afterJson: JSON.stringify({ invoice: invoiceSnapshot(invoice), costEvent: { id: costEvent.id,
        status: 'VOID', sourceInvoiceId: null } }) } })
    const result: InvoiceDraftMutationResult = { outcome: 'REVOKED', draftId: draft.id, version: updated.version,
      invoiceId: invoice.id, costEventId: costEvent.id,
      ...(invalidated.length ? { invalidatedPeriods: invalidated } : {}) }
    await saveReceipt(tx, { draftId: draft.id, action: 'REVOKED', actorId,
      idempotencyKey: request.idempotencyKey, hash, before, after: draftSnapshot(updated), result })
    return result
  })
}
