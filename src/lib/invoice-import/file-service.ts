import { z } from 'zod'
import type { PrismaClient } from '@/generated/prisma'
import { INVOICE_ATTACHMENT_MAX_BYTES } from './contracts'
import { inspectInvoiceDocument, type InvoiceDocumentProcessorConfig } from './document-processor'
import { registerReadyDraft } from './draft-service'
import { InvoiceImportError } from './errors'
import { PrivateInvoiceAttachmentStore, type PrivateInvoiceAttachmentMetadata } from './private-store'

export interface InvoiceFileEnvironment {
  store: PrivateInvoiceAttachmentStore
  processor: InvoiceDocumentProcessorConfig
}

export class InvoiceOriginalUnavailableError extends Error {
  readonly code = 'FILE_UNAVAILABLE'
  readonly status = 500

  constructor() {
    super('Nie można bezpiecznie odczytać oryginału. Skontaktuj się z administratorem.')
    this.name = 'InvoiceOriginalUnavailableError'
  }
}

const idSchema = z.string().trim().min(1).max(191)
const uploadInfoSchema = z.strictObject({
  batchId: idSchema,
  originalName: z.string().trim().min(1).max(255).refine(
    (value) => !/[\\/\p{Cc}]/u.test(value) && value !== '.' && value !== '..',
  ),
})

async function authorizeAdmin(db: PrismaClient, actorId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: actorId }, select: { role: true, isActive: true, mustChangePassword: true },
  })
  if (!user || user.role !== 'ADMIN' || !user.isActive || user.mustChangePassword) {
    throw new InvoiceImportError('FORBIDDEN', 403)
  }
}

/** A failed transaction response is not proof that no commit occurred. Only a
 * successful readback proving no reference permits removal of our exact file.
 * An uncertain readback intentionally leaves a private orphan for reconciliation.
 */
async function compensateIfUnreferenced(
  db: PrismaClient,
  store: PrivateInvoiceAttachmentStore,
  written: PrivateInvoiceAttachmentMetadata,
): Promise<void> {
  try {
    const reference = await db.invoiceAttachment.findUnique({
      where: { storageKey: written.key }, select: { id: true },
    })
    if (!reference) await store.removeExact(written.key, written)
  } catch {
    console.warn('[invoice-import] Private-file cleanup deferred; storage reconciliation required.')
  }
}

export async function uploadInvoiceDocument(
  db: PrismaClient,
  actorId: string,
  input: { batchId: string; originalName: string; bytes: Uint8Array },
  environment: InvoiceFileEnvironment,
) {
  // Snapshot bounded input before the first await. This does not inspect a
  // document or touch storage; access errors still take precedence below.
  const parsed = uploadInfoSchema.safeParse({ batchId: input.batchId, originalName: input.originalName })
  const isBytes = Buffer.isBuffer(input.bytes)
    || (ArrayBuffer.isView(input.bytes) && input.bytes.BYTES_PER_ELEMENT === 1)
  const bytes = isBytes && input.bytes.byteLength > 0 && input.bytes.byteLength <= INVOICE_ATTACHMENT_MAX_BYTES
    ? Buffer.from(input.bytes)
    : null
  await authorizeAdmin(db, actorId)
  if (!parsed.success || !bytes) throw new InvoiceImportError('INVALID_INPUT', 422)
  const batch = await db.invoiceImportBatch.findFirst({
    where: { id: parsed.data.batchId, ownerUserId: actorId }, select: { id: true },
  })
  if (!batch) throw new InvoiceImportError('NOT_FOUND', 404)

  const inspected = await inspectInvoiceDocument(bytes, environment.processor)
  const written = await environment.store.persist(bytes)
  try {
    if (written.sha256 !== inspected.sha256 || written.byteSize !== inspected.byteSize) {
      throw new InvoiceOriginalUnavailableError()
    }
    const registered = await registerReadyDraft(db, actorId, parsed.data.batchId, {
      ...inspected, storageKey: written.key, originalName: parsed.data.originalName,
    })
    if (registered.deduplicated) await compensateIfUnreferenced(db, environment.store, written)
    return registered
  } catch (error) {
    await compensateIfUnreferenced(db, environment.store, written)
    throw error
  }
}

async function findAttachment(db: PrismaClient, draftId: string) {
  const draft = await db.invoiceImportDraft.findUnique({
    where: { id: draftId }, select: { attachment: true },
  })
  if (!draft) throw new InvoiceImportError('NOT_FOUND', 404)
  if (draft.attachment.state !== 'READY') throw new InvoiceOriginalUnavailableError()
  return draft.attachment
}

export async function getInvoiceOriginal(
  db: PrismaClient,
  actorId: string,
  draftId: string,
  environment: InvoiceFileEnvironment,
) {
  await authorizeAdmin(db, actorId)
  const parsed = idSchema.safeParse(draftId)
  if (!parsed.success) throw new InvoiceImportError('INVALID_INPUT', 422)
  const attachment = await findAttachment(db, parsed.data)
  let bytes: Buffer
  try {
    bytes = await environment.store.readVerified(attachment.storageKey, attachment)
    const actual = await inspectInvoiceDocument(bytes, environment.processor)
    if (actual.mimeType !== attachment.mimeType || actual.pageCount !== attachment.pageCount
      || actual.byteSize !== attachment.byteSize || actual.sha256 !== attachment.sha256) {
      throw new InvoiceOriginalUnavailableError()
    }
  } catch {
    throw new InvoiceOriginalUnavailableError()
  }
  // Recheck current access and binding after bounded filesystem/native work.
  await authorizeAdmin(db, actorId)
  const current = await findAttachment(db, parsed.data)
  if (current.id !== attachment.id || current.storageKey !== attachment.storageKey
    || current.sha256 !== attachment.sha256 || current.byteSize !== attachment.byteSize
    || current.mimeType !== attachment.mimeType || current.pageCount !== attachment.pageCount
    || current.originalName !== attachment.originalName) {
    throw new InvoiceOriginalUnavailableError()
  }
  return {
    bytes, originalName: attachment.originalName, mimeType: attachment.mimeType,
    sha256: attachment.sha256, byteSize: attachment.byteSize,
  }
}
