import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { Prisma, PrismaClient } from '@/generated/prisma'
import { isClientVisitFeeActive } from './delegation-service'
import { createVisitFeeSnapshotDigest } from './visit-fee-snapshot'

const CLIENT_LINK_SECRET_BYTES = 32
const CLIENT_LINK_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** A 256-bit, URL-safe secret. Only its SHA-256 digest is persisted. */
export function createClientLinkSecret(): string {
  return randomBytes(CLIENT_LINK_SECRET_BYTES).toString('base64url')
}

export function isWellFormedClientLinkSecret(secret: string): boolean {
  return CLIENT_LINK_SECRET_PATTERN.test(secret)
}

export function hashClientLinkSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/** Keep unknown, expired and revoked client links deliberately indistinguishable. */
export function publicClientLinkNotFound() {
  return NextResponse.json(
    { error: 'Nie znaleziono strony.' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  )
}

type InstallationDb = PrismaClient | Prisma.TransactionClient

export class InstallationClientLinkNotFoundError extends Error {
  constructor() {
    super('Nie znaleziono strony.')
    this.name = 'InstallationClientLinkNotFoundError'
  }
}

export class InstallationClientLinkValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Link klienta jest niepoprawny.')
    this.name = 'InstallationClientLinkValidationError'
  }
}

/** An internal generation prerequisite; it is never exposed on a public link path. */
export class InstallationClientLinkPrerequisiteError extends Error {
  constructor() {
    super('Przed utworzeniem linku przypnij dokładnie jeden formularz klienta.')
    this.name = 'InstallationClientLinkPrerequisiteError'
  }
}

type PublicSubmission = {
  status: 'DRAFT' | 'SUBMITTED'
  revisionNumber: number
  draftVersion: number
  submittedAt: string | null
  answers: Array<{ questionKey: string; value: string | string[]; isUnknown: boolean }>
}

type PublicVisitFee = {
  grossAmount: string
  clauseText: string
  clauseVersion: number
  snapshotDigest: string
  clientAcceptedAt: string | null
}

function dateInFuture(value: Date) {
  return Number.isFinite(value.getTime()) && value.getTime() > Date.now()
}

async function getActiveOrderSnapshot(db: InstallationDb, orderId: string, forLinkGeneration = false) {
  const order = await db.installationOrder.findUnique({
    where: { id: orderId },
    include: {
      formSnapshots: { select: { id: true, templateVersion: true, schemaJson: true } },
      rooms: {
        orderBy: { sortOrder: 'asc' },
        select: {
          name: true,
          scopes: {
            orderBy: { sortOrder: 'asc' },
            select: {
              name: true,
              scopeProducts: {
                orderBy: { sortOrder: 'asc' },
                select: {
                  productNameSnapshot: true,
                  productCodeSnapshot: true,
                  manufacturerSnapshot: true,
                  collectionSnapshot: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (!order || order.archivedAt || order.status === 'ARCHIVED') {
    throw new InstallationClientLinkNotFoundError()
  }
  if (order.formSnapshots.length !== 1) {
    if (forLinkGeneration) throw new InstallationClientLinkPrerequisiteError()
    throw new InstallationClientLinkNotFoundError()
  }
  return order
}

/** Creates one current link and revokes earlier current links without auditing the secret. */
export async function createClientLink(
  db: PrismaClient,
  input: { orderId: string; createdById: string; expiresAt: Date },
) {
  if (!dateInFuture(input.expiresAt)) {
    throw new InstallationClientLinkValidationError({ expiresAt: 'Data wygaśnięcia musi być w przyszłości.' })
  }
  const token = createClientLinkSecret()
  const tokenHash = hashClientLinkSecret(token)
  const now = new Date()
  const link = await db.$transaction(async (tx) => {
    await getActiveOrderSnapshot(tx, input.orderId, true)
    await tx.installationClientLink.updateMany({
      where: { orderId: input.orderId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    })
    const created = await tx.installationClientLink.create({
      data: { orderId: input.orderId, tokenHash, expiresAt: input.expiresAt, createdById: input.createdById },
    })
    await tx.installationAuditEvent.create({
      data: {
        orderId: input.orderId,
        actorId: input.createdById,
        action: 'INSTALLATION_CLIENT_LINK_CREATED',
        metadataJson: JSON.stringify({ linkId: created.id, expiresAt: created.expiresAt.toISOString() }),
      },
    })
    return created
  })
  return { token, link }
}

export async function revokeClientLink(db: PrismaClient, linkId: string, actorId: string, expectedOrderId?: string) {
  return db.$transaction(async (tx) => {
    const link = await tx.installationClientLink.findUnique({ where: { id: linkId } })
    if (!link || (expectedOrderId && link.orderId !== expectedOrderId)) throw new InstallationClientLinkNotFoundError()
    const revokedAt = link.revokedAt ?? new Date()
    const updated = await tx.installationClientLink.update({ where: { id: linkId }, data: { revokedAt } })
    if (!link.revokedAt) {
      await tx.installationAuditEvent.create({
        data: { orderId: link.orderId, actorId, action: 'INSTALLATION_CLIENT_LINK_REVOKED', metadataJson: JSON.stringify({ linkId }) },
      })
    }
    return updated
  })
}

export async function extendClientLink(db: PrismaClient, linkId: string, expiresAt: Date, actorId: string, expectedOrderId?: string) {
  if (!dateInFuture(expiresAt)) throw new InstallationClientLinkValidationError({ expiresAt: 'Data wygaśnięcia musi być w przyszłości.' })
  return db.$transaction(async (tx) => {
    const link = await tx.installationClientLink.findUnique({ where: { id: linkId } })
    if (!link || link.revokedAt || (expectedOrderId && link.orderId !== expectedOrderId)) throw new InstallationClientLinkNotFoundError()
    const updated = await tx.installationClientLink.update({ where: { id: linkId }, data: { expiresAt } })
    await tx.installationAuditEvent.create({
      data: { orderId: link.orderId, actorId, action: 'INSTALLATION_CLIENT_LINK_EXTENDED', metadataJson: JSON.stringify({ linkId, expiresAt: expiresAt.toISOString() }) },
    })
    return updated
  })
}

/** Hashes every candidate before lookup so malformed, revoked and unknown links share the public failure path. */
export async function resolveActiveClientLink(db: InstallationDb, token: string) {
  const tokenHash = hashClientLinkSecret(token)
  const link = await db.installationClientLink.findUnique({ where: { tokenHash } })
  const now = new Date()
  if (!isWellFormedClientLinkSecret(token) || !link || link.revokedAt || link.expiresAt <= now) {
    throw new InstallationClientLinkNotFoundError()
  }
  const touched = await db.installationClientLink.updateMany({
    where: { id: link.id, revokedAt: null, expiresAt: { gt: now } },
    data: { lastOpenedAt: now },
  })
  if (touched.count !== 1) throw new InstallationClientLinkNotFoundError()
  return { ...link, lastOpenedAt: now }
}

async function ensureCurrentDraft(db: InstallationDb, orderId: string, formSnapshotId: string) {
  const existing = await db.installationFormSubmission.findUnique({
    where: { draftKey: orderId },
    include: { answers: { orderBy: { questionKey: 'asc' } } },
  })
  if (existing) return existing
  const latest = await db.installationFormSubmission.findFirst({
    where: { orderId, status: 'SUBMITTED' }, orderBy: { revisionNumber: 'desc' }, select: { revisionNumber: true },
  })
  try {
    return await db.installationFormSubmission.create({
      data: {
        orderId,
        formSnapshotId,
        revisionNumber: (latest?.revisionNumber ?? 0) + 1,
        status: 'DRAFT',
        draftKey: orderId,
      },
      include: { answers: { orderBy: { questionKey: 'asc' } } },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await db.installationFormSubmission.findUnique({
        where: { draftKey: orderId }, include: { answers: { orderBy: { questionKey: 'asc' } } },
      })
      if (raced) return raced
    }
    throw error
  }
}

function publicSubmission(submission: {
  status: string; revisionNumber: number; draftVersion: number; submittedAt: Date | null
  answers: Array<{ questionKey: string; valueJson: string; isUnknown: boolean }>
}): PublicSubmission {
  return {
    status: submission.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT',
    revisionNumber: submission.revisionNumber,
    draftVersion: submission.draftVersion,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    answers: submission.answers.map((answer) => {
      const parsed = JSON.parse(answer.valueJson) as { value?: unknown }
      return {
        questionKey: answer.questionKey,
        value: Array.isArray(parsed.value) ? parsed.value.filter((value): value is string => typeof value === 'string') : String(parsed.value ?? ''),
        isUnknown: answer.isUnknown,
      }
    }),
  }
}

function publicWallDecorContact() {
  const email = process.env.WALLDECOR_PUBLIC_CONTACT_EMAIL?.trim() || 'info@walldecor.pl'
  return { label: 'WallDecor' as const, email }
}

function publicVisitFee(order: {
  visitFeePolicyId: string | null
  visitFeeStatus: string
  visitFeeGrossAmount: Prisma.Decimal | null
  visitFeeClauseText: string | null
  visitFeeClauseVersion: number | null
  visitFeeLegalApprovedAt: Date | null
  visitFeeClientAcceptedAt: Date | null
}): PublicVisitFee | null {
  const grossAmount = order.visitFeeGrossAmount?.toFixed(2) ?? null
  if (!isClientVisitFeeActive({
    status: order.visitFeeStatus,
    grossAmount,
    clauseText: order.visitFeeClauseText,
    clauseVersion: order.visitFeeClauseVersion,
    legalApprovedAt: order.visitFeeLegalApprovedAt,
  })) return null
  const snapshotDigest = createVisitFeeSnapshotDigest({
    policyId: order.visitFeePolicyId,
    status: order.visitFeeStatus,
    grossAmount,
    clauseText: order.visitFeeClauseText,
    clauseVersion: order.visitFeeClauseVersion,
    legalApprovedAt: order.visitFeeLegalApprovedAt,
  })
  return {
    grossAmount: grossAmount!,
    clauseText: order.visitFeeClauseText!,
    clauseVersion: order.visitFeeClauseVersion!,
    snapshotDigest,
    clientAcceptedAt: order.visitFeeClientAcceptedAt?.toISOString() ?? null,
  }
}

/** The only public projection: no client/staff PII or joinable database IDs. */
export async function loadPublicInstallationProjection(db: PrismaClient, token: string) {
  const link = await resolveActiveClientLink(db, token)
  const order = await getActiveOrderSnapshot(db, link.orderId)
  const snapshot = order.formSnapshots[0]
  const draft = await db.installationFormSubmission.findUnique({
    where: { draftKey: order.id }, include: { answers: { orderBy: { questionKey: 'asc' } } },
  })
  const latestSubmitted = draft ? null : await db.installationFormSubmission.findFirst({
    where: { orderId: order.id, status: 'SUBMITTED' },
    orderBy: { revisionNumber: 'desc' },
    include: { answers: { orderBy: { questionKey: 'asc' } } },
  })
  const submission = draft ?? latestSubmitted ?? await ensureCurrentDraft(db, order.id, snapshot.id)
  const schema = JSON.parse(snapshot.schemaJson) as { questions?: unknown[] }
  return {
    brand: 'WallDecor' as const,
    number: order.number,
    contact: publicWallDecorContact(),
    rooms: order.rooms.map((room) => ({
      name: room.name,
      scopes: room.scopes.map((scope) => ({
        name: scope.name,
        products: scope.scopeProducts.map((product) => ({
          name: product.productNameSnapshot,
          code: product.productCodeSnapshot,
          manufacturer: product.manufacturerSnapshot,
          collection: product.collectionSnapshot,
        })),
      })),
    })),
    form: { templateVersion: snapshot.templateVersion, questions: schema.questions ?? [] },
    submission: publicSubmission(submission),
    canStartCorrection: submission.status === 'SUBMITTED',
    visitFee: publicVisitFee(order),
  }
}

export async function listClientLinkStatuses(db: InstallationDb, orderId: string) {
  return db.installationClientLink.findMany({
    where: { orderId },
    select: { id: true, expiresAt: true, revokedAt: true, createdAt: true, lastOpenedAt: true },
    orderBy: { createdAt: 'desc' },
  })
}
