import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@/generated/prisma'
import { resolveActiveClientLink } from '@/lib/installations/client-link'
import { evaluateVisibleFormQuestions, type ClientAnswerValue, type ClientFormQuestion } from '@/lib/installations/form-service'
import { validateInstallationQuestionDefinitions } from '@/lib/installations/question-schema'
import type { PrivateMediaClient, PrivateMediaFile } from './client'

type InstallationDb = PrismaClient | Prisma.TransactionClient

export type InstallationMediaAdapter = Pick<PrivateMediaClient, 'upload' | 'download' | 'remove'>

export class InstallationMediaAccessError extends Error {
  constructor(message = 'Nie znaleziono bezpiecznego dostępu do pliku.') {
    super(message)
    this.name = 'InstallationMediaAccessError'
  }
}

export class InstallationMediaValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Plik jest niepoprawny.')
    this.name = 'InstallationMediaValidationError'
  }
}

export const INSTALLATION_ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export const INSTALLATION_MAX_FILE_BYTES = 10 * 1024 * 1024
export const INSTALLATION_HANDOFF_MAX_FILES = 5
export const INSTALLATION_HANDOFF_TTL_MS = 20 * 60 * 1000

type FileTarget = {
  link: { id: string; orderId: string; expiresAt: Date; revokedAt: Date | null }
  submission: { id: string; orderId: string; formSnapshot: { schemaJson: string }; answers: Array<{ questionKey: string; normalizedValue: string }> }
  question: ClientFormQuestion
}

type UploadInput = {
  filename: string
  contentType: string
  bytes: Uint8Array
}

function secret() {
  return randomBytes(32).toString('base64url')
}

function hashSecret(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function safeFileName(value: string) {
  const name = value.normalize('NFKC').replace(/[\\/\u0000-\u001f]/g, '_').trim().slice(0, 180)
  if (!name) throw new InstallationMediaValidationError({ file: 'Plik musi mieć nazwę.' })
  return name
}

function validateUpload(input: UploadInput, maxByteSize = INSTALLATION_MAX_FILE_BYTES, allowedTypes: readonly string[] = INSTALLATION_ALLOWED_FILE_TYPES) {
  const filename = safeFileName(input.filename)
  if (!allowedTypes.includes(input.contentType as typeof INSTALLATION_ALLOWED_FILE_TYPES[number])) {
    throw new InstallationMediaValidationError({ file: 'Dozwolone są pliki JPG, PNG, WebP oraz PDF.' })
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > maxByteSize) {
    throw new InstallationMediaValidationError({ file: `Plik musi mieć od 1 B do ${Math.floor(maxByteSize / 1024 / 1024)} MB.` })
  }
  return { filename, contentType: input.contentType, bytes: input.bytes }
}

function questionsFromSchema(schemaJson: string) {
  try {
    const parsed = JSON.parse(schemaJson) as { templateId?: unknown; questions?: unknown }
    if (typeof parsed.templateId !== 'string' || !Array.isArray(parsed.questions)) throw new Error('invalid')
    return validateInstallationQuestionDefinitions(parsed.templateId, parsed.questions).map((question) => ({ ...question, required: question.required === true }))
  } catch {
    throw new InstallationMediaAccessError()
  }
}

/** Matches the public form's lazy first-draft behaviour, but never starts a
 * correction. After the first submit only the explicit correction action may
 * create another DRAFT because it also records revisionOfId and copies answers. */
async function ensureCurrentFileSubmission(db: InstallationDb, orderId: string) {
  const existing = await db.installationFormSubmission.findUnique({
    where: { draftKey: orderId },
    include: { formSnapshot: { select: { schemaJson: true } }, answers: { select: { questionKey: true, normalizedValue: true } } },
  })
  if (existing) return existing
  const latest = await db.installationFormSubmission.findFirst({ where: { orderId }, select: { revisionNumber: true }, orderBy: { revisionNumber: 'desc' } })
  if (latest) throw new InstallationMediaAccessError()
  const snapshot = await db.installationOrderFormSnapshot.findUnique({ where: { orderId }, select: { id: true, schemaJson: true } })
  if (!snapshot) throw new InstallationMediaAccessError()
  try {
    return await db.installationFormSubmission.create({
      data: { orderId, formSnapshotId: snapshot.id, revisionNumber: 1, status: 'DRAFT', draftKey: orderId },
      include: { formSnapshot: { select: { schemaJson: true } }, answers: { select: { questionKey: true, normalizedValue: true } } },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await db.installationFormSubmission.findUnique({
        where: { draftKey: orderId },
        include: { formSnapshot: { select: { schemaJson: true } }, answers: { select: { questionKey: true, normalizedValue: true } } },
      })
      if (raced) return raced
      // A concurrent submit may have cleared draftKey after winning the first
      // revision. Treat it as a closed form, never as permission to mint v2.
      throw new InstallationMediaAccessError()
    }
    throw error
  }
}

async function currentFileTarget(db: InstallationDb, token: string, questionKey: string): Promise<FileTarget> {
  const link = await resolveActiveClientLink(db, token)
  const submission = await ensureCurrentFileSubmission(db, link.orderId)
  if (!submission || submission.orderId !== link.orderId || submission.status !== 'DRAFT') throw new InstallationMediaAccessError()
  const answers = Object.fromEntries(submission.answers.map((answer) => [answer.questionKey, answer.normalizedValue])) as Record<string, ClientAnswerValue | undefined>
  const question = evaluateVisibleFormQuestions(questionsFromSchema(submission.formSnapshot.schemaJson), answers)
    .find((candidate) => candidate.key === questionKey && candidate.type === 'FILE')
  if (!question) throw new InstallationMediaAccessError()
  return { link, submission, question }
}

function safeMediaError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : 'Prywatny serwer plików nie potwierdził zapisu.'
}

async function auditFile(db: InstallationDb, input: { fileId: string; orderId: string; actorId: string; action: string; metadata?: Record<string, unknown> }) {
  await db.installationFileAuditEvent.create({
    data: {
      fileId: input.fileId,
      orderId: input.orderId,
      actorId: input.actorId,
      action: input.action,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  })
}

async function storeFile(
  db: PrismaClient,
  target: { orderId: string; roomId?: string | null; scopeId?: string | null; formSubmissionId?: string | null; clientLinkId?: string | null; mobileHandoffId?: string | null; questionKey?: string | null; purpose: 'CLIENT_QUESTION' | 'MISMATCH_EVIDENCE' | 'INTERNAL_PROJECT'; source: 'WEB' | 'MOBILE_QR' | 'INTERNAL'; actorId: string },
  input: UploadInput,
  media: InstallationMediaAdapter,
) {
  const valid = validateUpload(input)
  const fileId = randomUUID()
  await db.$transaction(async (tx) => {
    await tx.installationFile.create({ data: {
      id: fileId,
      orderId: target.orderId,
      roomId: target.roomId ?? null,
      scopeId: target.scopeId ?? null,
      formSubmissionId: target.formSubmissionId ?? null,
      clientLinkId: target.clientLinkId ?? null,
      mobileHandoffId: target.mobileHandoffId ?? null,
      purpose: target.purpose,
      questionKey: target.questionKey ?? null,
      originalFilename: valid.filename,
      contentType: valid.contentType,
      status: 'PENDING',
      source: target.source,
      createdById: target.actorId,
    } })
    await auditFile(tx, { fileId, orderId: target.orderId, actorId: target.actorId, action: 'INSTALLATION_PRIVATE_FILE_PENDING', metadata: { purpose: target.purpose, questionKey: target.questionKey ?? null, byteSize: valid.bytes.byteLength } })
  })

  let stored: PrivateMediaFile
  try {
    stored = await media.upload({ fileId, jobId: target.orderId, contentType: valid.contentType, bytes: valid.bytes })
  } catch (error) {
    await db.$transaction(async (tx) => {
      await tx.installationFile.updateMany({ where: { id: fileId, status: 'PENDING' }, data: { status: 'FAILED', failureReason: safeMediaError(error) } })
      await auditFile(tx, { fileId, orderId: target.orderId, actorId: target.actorId, action: 'INSTALLATION_PRIVATE_FILE_FAILED', metadata: { reason: safeMediaError(error) } })
    })
    throw error
  }

  const file = await db.$transaction(async (tx) => {
    const updated = await tx.installationFile.updateMany({ where: { id: fileId, status: 'PENDING', softDeletedAt: null }, data: { status: 'READY', byteSize: stored.byteSize, sha256: stored.sha256, failureReason: null } })
    if (updated.count !== 1) throw new InstallationMediaAccessError('Nie udało się zatwierdzić przesłanego pliku.')
    await auditFile(tx, { fileId, orderId: target.orderId, actorId: target.actorId, action: 'INSTALLATION_PRIVATE_FILE_READY', metadata: { sha256: stored.sha256, byteSize: stored.byteSize, contentType: stored.contentType } })
    return tx.installationFile.findUniqueOrThrow({ where: { id: fileId } })
  })
  return file
}

export async function createClientQuestionFile(db: PrismaClient, token: string, input: { questionKey: string } & UploadInput, media: InstallationMediaAdapter) {
  const target = await currentFileTarget(db, token, input.questionKey)
  return storeFile(db, {
    orderId: target.link.orderId,
    formSubmissionId: target.submission.id,
    clientLinkId: target.link.id,
    questionKey: target.question.key,
    purpose: 'CLIENT_QUESTION',
    source: 'WEB',
    actorId: 'PUBLIC_CLIENT',
  }, input, media)
}

export async function listClientQuestionFiles(db: InstallationDb, token: string, questionKey: string) {
  const target = await currentFileTarget(db, token, questionKey)
  return db.installationFile.findMany({
    // Files already supplied for this immutable order snapshot remain visible
    // in an explicit correction. The current DRAFT is still required above,
    // so this never exposes historic files through a submitted-only link.
    where: { orderId: target.link.orderId, purpose: 'CLIENT_QUESTION', questionKey, status: 'READY', softDeletedAt: null },
    select: { id: true, originalFilename: true, contentType: true, byteSize: true, sha256: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
}

export async function getClientQuestionFile(db: InstallationDb, token: string, questionKey: string, fileId: string) {
  const target = await currentFileTarget(db, token, questionKey)
  const file = await db.installationFile.findFirst({
    where: { id: fileId, orderId: target.link.orderId, purpose: 'CLIENT_QUESTION', questionKey, status: 'READY', softDeletedAt: null },
  })
  if (!file) throw new InstallationMediaAccessError()
  return file
}

export async function createMobileUploadHandoff(db: PrismaClient, token: string, input: { questionKey: string; expiresAt?: Date; maxFiles?: number; maxByteSize?: number; allowedContentTypes?: readonly string[] }) {
  const target = await currentFileTarget(db, token, input.questionKey)
  const expiresAt = input.expiresAt ?? new Date(Date.now() + INSTALLATION_HANDOFF_TTL_MS)
  const maxFiles = input.maxFiles ?? INSTALLATION_HANDOFF_MAX_FILES
  const maxByteSize = input.maxByteSize ?? INSTALLATION_MAX_FILE_BYTES
  const allowedContentTypes = input.allowedContentTypes ?? INSTALLATION_ALLOWED_FILE_TYPES
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > INSTALLATION_HANDOFF_MAX_FILES || !Number.isSafeInteger(maxByteSize) || maxByteSize < 1 || maxByteSize > INSTALLATION_MAX_FILE_BYTES || expiresAt <= new Date() || allowedContentTypes.length === 0 || allowedContentTypes.some((type) => !INSTALLATION_ALLOWED_FILE_TYPES.includes(type as typeof INSTALLATION_ALLOWED_FILE_TYPES[number]))) {
    throw new InstallationMediaValidationError({ handoff: 'Parametry bezpiecznego przekazania telefonu są niepoprawne.' })
  }
  const code = secret()
  const handoff = await db.mobileUploadHandoff.create({ data: {
    orderId: target.link.orderId,
    clientLinkId: target.link.id,
    formSubmissionId: target.submission.id,
    questionKey: target.question.key,
    codeHash: hashSecret(code),
    allowedMimeJson: JSON.stringify([...allowedContentTypes]),
    maxFiles,
    maxByteSize,
    expiresAt,
  } })
  await db.installationAuditEvent.create({ data: { orderId: target.link.orderId, actorId: 'PUBLIC_CLIENT', action: 'INSTALLATION_MOBILE_UPLOAD_HANDOFF_CREATED', metadataJson: JSON.stringify({ handoffId: handoff.id, questionKey: target.question.key, expiresAt: expiresAt.toISOString() }) } })
  return { handoffId: handoff.id, code, expiresAt }
}

export async function redeemMobileUploadHandoff(db: PrismaClient, code: string) {
  const codeHash = hashSecret(code)
  const now = new Date()
  const handoff = await db.mobileUploadHandoff.findUnique({ where: { codeHash }, include: { clientLink: true, formSubmission: { select: { orderId: true, status: true } } } })
  if (!handoff || handoff.redeemedAt || handoff.revokedAt || handoff.expiresAt <= now || handoff.clientLink.revokedAt || handoff.clientLink.expiresAt <= now || handoff.formSubmission.status !== 'DRAFT' || handoff.formSubmission.orderId !== handoff.orderId) {
    throw new InstallationMediaAccessError()
  }
  const sessionSecret = secret()
  const claimed = await db.mobileUploadHandoff.updateMany({
    where: { id: handoff.id, redeemedAt: null, revokedAt: null, expiresAt: { gt: now }, sessionSecretHash: null },
    data: { redeemedAt: now, sessionSecretHash: hashSecret(sessionSecret) },
  })
  if (claimed.count !== 1) throw new InstallationMediaAccessError()
  return { handoffId: handoff.id, cookieValue: `${handoff.id}.${sessionSecret}`, expiresAt: handoff.expiresAt, questionKey: handoff.questionKey }
}

function parseMobileCookie(cookieValue: string) {
  const [handoffId, sessionSecret, ...extra] = cookieValue.split('.')
  if (!handoffId || !sessionSecret || extra.length || !/^[A-Za-z0-9_-]{43}$/.test(sessionSecret)) throw new InstallationMediaAccessError()
  return { handoffId, sessionSecret }
}

function allowedTypesFromHandoff(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((entry) => typeof entry !== 'string' || !INSTALLATION_ALLOWED_FILE_TYPES.includes(entry as typeof INSTALLATION_ALLOWED_FILE_TYPES[number]))) throw new Error('invalid')
    return parsed
  } catch {
    throw new InstallationMediaAccessError()
  }
}

export async function uploadMobileHandoffFile(db: PrismaClient, cookieValue: string, input: UploadInput, media: InstallationMediaAdapter) {
  const { handoffId, sessionSecret } = parseMobileCookie(cookieValue)
  const now = new Date()
  const handoff = await db.mobileUploadHandoff.findUnique({ where: { id: handoffId }, include: { clientLink: true, formSubmission: { select: { orderId: true, status: true } } } })
  if (!handoff || handoff.sessionSecretHash !== hashSecret(sessionSecret) || !handoff.redeemedAt || handoff.revokedAt || handoff.expiresAt <= now || handoff.clientLink.revokedAt || handoff.clientLink.expiresAt <= now || handoff.formSubmission.status !== 'DRAFT' || handoff.formSubmission.orderId !== handoff.orderId) throw new InstallationMediaAccessError()
  const valid = validateUpload(input, handoff.maxByteSize, allowedTypesFromHandoff(handoff.allowedMimeJson))
  try {
    return await storeFile(db, {
      orderId: handoff.orderId,
      formSubmissionId: handoff.formSubmissionId,
      clientLinkId: handoff.clientLinkId,
      mobileHandoffId: handoff.id,
      questionKey: handoff.questionKey,
      purpose: 'CLIENT_QUESTION',
      source: 'MOBILE_QR',
      actorId: 'PUBLIC_MOBILE',
    }, valid, media)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new InstallationMediaValidationError({ file: 'Osiągnięto limit plików dla tego przekazania.' })
    }
    throw error
  }
}

export async function revokeMobileUploadHandoff(db: PrismaClient, handoffId: string, token: string) {
  const link = await resolveActiveClientLink(db, token)
  const updated = await db.mobileUploadHandoff.updateMany({ where: { id: handoffId, clientLinkId: link.id, revokedAt: null }, data: { revokedAt: new Date() } })
  if (updated.count !== 1) throw new InstallationMediaAccessError()
  await db.installationAuditEvent.create({ data: { orderId: link.orderId, actorId: 'PUBLIC_CLIENT', action: 'INSTALLATION_MOBILE_UPLOAD_HANDOFF_REVOKED', metadataJson: JSON.stringify({ handoffId }) } })
}

export async function listInstallationFiles(db: InstallationDb, orderId: string) {
  return db.installationFile.findMany({
    where: { orderId, softDeletedAt: null },
    select: { id: true, purpose: true, questionKey: true, roomId: true, scopeId: true, originalFilename: true, contentType: true, byteSize: true, sha256: true, status: true, source: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
}

export async function getInstallationFileForDownload(db: InstallationDb, orderId: string, fileId: string) {
  const file = await db.installationFile.findFirst({ where: { id: fileId, orderId, status: 'READY', softDeletedAt: null } })
  if (!file) throw new InstallationMediaAccessError()
  return file
}

export async function softDeleteInstallationFile(db: PrismaClient, orderId: string, fileId: string, actorId: string, media: InstallationMediaAdapter) {
  const now = new Date()
  const file = await db.$transaction(async (tx) => {
    const existing = await tx.installationFile.findFirst({ where: { id: fileId, orderId, softDeletedAt: null } })
    if (!existing) throw new InstallationMediaAccessError()
    const updated = await tx.installationFile.update({ where: { id: existing.id }, data: { softDeletedAt: now, softDeletedById: actorId } })
    await auditFile(tx, { fileId, orderId, actorId, action: 'INSTALLATION_PRIVATE_FILE_SOFT_DELETED' })
    return updated
  })
  try {
    await media.remove(file.id)
  } catch (error) {
    await db.$transaction((tx) => auditFile(tx, { fileId, orderId, actorId, action: 'INSTALLATION_PRIVATE_FILE_DELETE_REMOTE_FAILED', metadata: { reason: safeMediaError(error) } }))
  }
  return file
}

export async function createMismatchEvidenceFile(db: PrismaClient, orderId: string, mismatchId: string, actorId: string, input: UploadInput, media: InstallationMediaAdapter) {
  const mismatch = await db.installationMismatch.findFirst({ where: { id: mismatchId, orderId, evidenceStatus: 'PENDING_PRIVATE_FILE' } })
  if (!mismatch) throw new InstallationMediaAccessError('Nie można dołączyć dowodu do tej niezgodności.')
  const file = await storeFile(db, { orderId, purpose: 'MISMATCH_EVIDENCE', source: 'INTERNAL', actorId }, input, media)
  try {
    return await db.$transaction(async (tx) => {
      await tx.installationMismatchEvidence.create({ data: { orderId, mismatchId, fileId: file.id, attachedById: actorId } })
      const verifiedAt = new Date()
      const updated = await tx.installationMismatch.updateMany({ where: { id: mismatchId, orderId, evidenceStatus: 'PENDING_PRIVATE_FILE' }, data: { evidenceStatus: 'VERIFIED_PRIVATE_FILE', evidenceFileId: file.id, evidenceVerifiedAt: verifiedAt, evidenceReference: `private-file:${file.id}` } })
      if (updated.count !== 1) throw new InstallationMediaAccessError('Dowód niezgodności został zmieniony przed zatwierdzeniem.')
      await auditFile(tx, { fileId: file.id, orderId, actorId, action: 'INSTALLATION_MISMATCH_PRIVATE_EVIDENCE_ATTACHED', metadata: { mismatchId } })
      return tx.installationFile.findUniqueOrThrow({ where: { id: file.id } })
    })
  } catch (error) {
    // The private media write is intentionally first, so compensate a READY
    // object when the immutable evidence bridge lost a concurrent race.
    try {
      await softDeleteInstallationFile(db, orderId, file.id, actorId, media)
    } catch {
      // Preserve the original attachment error; a failed compensation is
      // still visible as a READY file for an internal operator to resolve.
    }
    throw error
  }
}

/** Private project material belongs to the order and may additionally be fixed
 * to one existing room and/or scope. The database repeats this relation guard
 * so a direct request cannot retarget a file across orders. */
export async function createInternalProjectFile(
  db: PrismaClient,
  orderId: string,
  actorId: string,
  input: { roomId?: string | null; scopeId?: string | null } & UploadInput,
  media: InstallationMediaAdapter,
) {
  const roomId = input.roomId?.trim() || null
  const scopeId = input.scopeId?.trim() || null
  if (roomId) {
    const room = await db.installationRoom.findFirst({ where: { id: roomId, orderId }, select: { id: true } })
    if (!room) throw new InstallationMediaAccessError('Nie znaleziono pomieszczenia dla tego zlecenia.')
  }
  if (scopeId) {
    const scope = await db.installationScope.findFirst({
      where: { id: scopeId, room: { orderId }, ...(roomId ? { roomId } : {}) }, select: { id: true },
    })
    if (!scope) throw new InstallationMediaAccessError('Nie znaleziono zakresu dla tego zlecenia.')
  }
  return storeFile(db, {
    orderId,
    roomId,
    scopeId,
    purpose: 'INTERNAL_PROJECT',
    source: 'INTERNAL',
    actorId,
  }, input, media)
}
