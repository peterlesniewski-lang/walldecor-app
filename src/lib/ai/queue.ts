import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AiJob, AiQueueLease, Prisma, PrismaClient } from '@/generated/prisma'
import {
  aiJobInputSchema, aiJobKindSchema, aiJobStatusSchema, parseAiJobResult,
  type AiJobInput, type AiJobKind, type AiJobResult, type AiJobStatus,
} from './contracts'
import {
  AiQueueError, aiPauseReason, sanitizeAiFailureCode,
  type AiFailureCode, type AiPauseReason,
} from './queue-errors'
import { applyInvoiceDraftAiResultInTransaction } from '@/lib/invoice-import/draft-ai-result'

export { AiQueueError } from './queue-errors'
export const AI_JOB_LEASE_MS = 60_000
export const AI_JOB_MAX_ATTEMPTS = 3
const QUEUE_ID = 'shared-ai'
const clearLease = { workerId: null, leaseToken: null, leaseUntil: null }
export type AiQueueTransaction = Prisma.TransactionClient
type Transaction = AiQueueTransaction
type Reader = Pick<PrismaClient, 'user' | 'aiJob' | 'aiQueueLease'>
export type AiQueueClock = Date | (() => Date)

export interface AiJobSnapshot {
  id: string
  kind: AiJobKind
  status: AiJobStatus
  result: AiJobResult | null
  errorCode: AiFailureCode | null
  blockedReason: AiPauseReason | null
  attempts: number
  createdAt: Date
  updatedAt: Date
}

export type ClaimedAiJob = AiJobInput & {
  id: string
  ownerUserId: string
  leaseToken: string
  leaseUntil: Date
  attempts: number
}

export type AiJobOutcome =
  | { status: 'SUCCEEDED'; result: unknown }
  | { status: 'FAILED' | 'BLOCKED'; errorCode: AiFailureCode }

export async function authorizeAiOwner(db: Pick<PrismaClient, 'user'>, ownerUserId: string, kind: AiJobKind): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: ownerUserId },
    select: { role: true, isActive: true, mustChangePassword: true },
  })
  if (!user?.isActive || user.mustChangePassword ||
    !(user.role === 'ADMIN' || (user.role === 'MANAGER' && kind === 'WIKI_CHAT'))) {
    throw new AiQueueError('FORBIDDEN', 403)
  }
}

function isSqliteContention(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  // SQLite contention and interactive-transaction timeout both roll back.
  return ['P1008', 'P2028', 'P2034'].includes(String(error.code)) ||
    (error.code === 'P2010' && 'meta' in error && /database is locked|SQLITE_BUSY/i.test(JSON.stringify(error.meta)))
}

export async function withAiQueueMutation<T>(db: PrismaClient, clock: AiQueueClock, operation: (tx: Transaction, lease: AiQueueLease, now: Date) => Promise<T>): Promise<T> {
  const readTime = () => typeof clock === 'function' ? clock() : clock
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        // FIRST statement is a write: acquire SQLite's writer reservation before
        // any eligibility read. This serializes independent clients/processes.
        await tx.$executeRaw`
          INSERT INTO "AiQueueLease" ("id", "updatedAt") VALUES (${QUEUE_ID}, ${readTime()})
          ON CONFLICT("id") DO UPDATE SET "updatedAt" = excluded."updatedAt"
        `
        const lease = await tx.aiQueueLease.findUniqueOrThrow({ where: { id: QUEUE_ID } })
        // The writer reservation may have waited, including across a retry.
        // Lease eligibility must use the current time AFTER that wait.
        return operation(tx, lease, readTime())
      }, { maxWait: 10_000, timeout: 10_000 })
    } catch (error) {
      if (attempt >= 4 || !isSqliteContention(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt))
    }
  }
}

function parseEnqueueInput(input: unknown, idempotencyKey?: string) {
  const parsed = aiJobInputSchema.safeParse(input)
  const key = z.string().trim().min(1).max(191).optional().safeParse(idempotencyKey)
  if (!parsed.success || !key.success) throw new AiQueueError('INVALID_INPUT', 422)
  return { input: parsed.data, idempotencyKey: key.data }
}

/** Enqueues without opening another transaction. Callers must already be
 * inside withAiQueueMutation so the writer reservation and queue policy remain
 * shared across the complete business mutation. */
export async function enqueueAiJobInTransaction(
  tx: Transaction,
  ownerUserId: string,
  input: unknown,
  idempotencyKey?: string,
): Promise<AiJob> {
  const parsed = parseEnqueueInput(input, idempotencyKey)
  const payloadJson = JSON.stringify(parsed.input.payload)
  await authorizeAiOwner(tx, ownerUserId, parsed.input.kind)
  if (parsed.idempotencyKey) {
    const existing = await tx.aiJob.findUnique({
      where: { ownerUserId_idempotencyKey: { ownerUserId, idempotencyKey: parsed.idempotencyKey } },
    })
    if (existing) {
      if (existing.kind !== parsed.input.kind || existing.payloadJson !== payloadJson) {
        throw new AiQueueError('IDEMPOTENCY_CONFLICT', 409)
      }
      return existing
    }
  }
  return tx.aiJob.create({ data: {
    ownerUserId,
    kind: parsed.input.kind,
    payloadJson,
    idempotencyKey: parsed.idempotencyKey,
    priority: parsed.input.kind === 'INVOICE_EXTRACT' ? 0 : 100,
  } })
}

function snapshot(job: AiJob, pause: string | null): AiJobSnapshot {
  const kind = aiJobKindSchema.parse(job.kind)
  let result: AiJobResult | null = null
  if (job.status === 'SUCCEEDED') {
    try { result = parseAiJobResult(kind, JSON.parse(job.resultJson ?? 'null')) }
    catch { throw new AiQueueError('INVALID_RESULT', 500) }
  }
  const errorCode = job.errorCode ? sanitizeAiFailureCode(job.errorCode) : null
  return {
    id: job.id, kind, status: aiJobStatusSchema.parse(job.status), result, errorCode,
    blockedReason: job.status === 'QUEUED' ? (pause ? aiPauseReason(sanitizeAiFailureCode(pause)) : null)
      : job.status === 'BLOCKED' && errorCode ? aiPauseReason(errorCode) : null,
    attempts: job.attempts, createdAt: job.createdAt, updatedAt: job.updatedAt,
  }
}

async function ownedJob(db: Reader, ownerUserId: string, jobId: string): Promise<AiJob> {
  const job = await db.aiJob.findFirst({ where: { id: jobId, ownerUserId } })
  if (!job) throw new AiQueueError('NOT_FOUND', 404)
  await authorizeAiOwner(db, ownerUserId, aiJobKindSchema.parse(job.kind))
  return job
}

export async function enqueueAiJob(db: PrismaClient, ownerUserId: string, input: unknown, idempotencyKey?: string): Promise<AiJobSnapshot> {
  parseEnqueueInput(input, idempotencyKey)
  return withAiQueueMutation(db, () => new Date(), async (tx, lease) => {
    const job = await enqueueAiJobInTransaction(tx, ownerUserId, input, idempotencyKey)
    return snapshot(job, lease.pauseReason)
  })
}

export async function readAiJob(db: PrismaClient, ownerUserId: string, jobId: string): Promise<AiJobSnapshot> {
  const job = await ownedJob(db, ownerUserId, jobId)
  const lease = await db.aiQueueLease.findUnique({ where: { id: QUEUE_ID } })
  return snapshot(job, lease?.pauseReason ?? null)
}

export async function retryAiJob(db: PrismaClient, ownerUserId: string, jobId: string): Promise<AiJobSnapshot> {
  return withAiQueueMutation(db, () => new Date(), async (tx, lease) => {
    const job = await ownedJob(tx, ownerUserId, jobId)
    const waitingForPausedQueue = job.status === 'QUEUED' && lease.pauseReason !== null
    if (job.status !== 'FAILED' && job.status !== 'BLOCKED' && !waitingForPausedQueue) throw new AiQueueError('JOB_NOT_RETRYABLE', 409)
    // Manual retry starts a new bounded automatic-attempt cycle. No fallback.
    const retried = await tx.aiJob.update({ where: { id: job.id }, data: {
      status: 'QUEUED', attempts: 0, resultJson: null, errorCode: null, ...clearLease,
    } })
    await tx.aiQueueLease.update({ where: { id: QUEUE_ID }, data: { pauseReason: null } })
    return snapshot(retried, null)
  })
}

/**
 * DB lease fencing protects durable state, not a provider process that keeps
 * running after its lease expires. The consumer MUST additionally own the
 * shared OS/OAuth flock before claiming, abort inference on failed heartbeat,
 * and hold that flock until the process has actually exited.
 */
export async function claimAiJob(db: PrismaClient, workerId: string, clock: AiQueueClock = () => new Date()): Promise<ClaimedAiJob | null> {
  if (!workerId.trim() || workerId.length > 191) throw new AiQueueError('INVALID_INPUT', 422)
  return withAiQueueMutation(db, clock, async (tx, lease, now) => {
    const running = await tx.aiJob.findFirst({ where: { status: 'RUNNING' } })
    if (running) {
      if (running.leaseUntil && running.leaseUntil > now) return null
      await tx.aiJob.update({ where: { id: running.id }, data: {
        status: running.attempts >= AI_JOB_MAX_ATTEMPTS ? 'FAILED' : 'QUEUED',
        errorCode: running.attempts >= AI_JOB_MAX_ATTEMPTS ? 'LEASE_EXPIRED' : null,
        resultJson: null, ...clearLease,
      } })
      await tx.aiQueueLease.update({ where: { id: QUEUE_ID }, data: clearLease })
    } else if (lease.leaseUntil && lease.leaseUntil > now) {
      return null
    }
    if (lease.pauseReason) return null

    // Bound a polling transaction even when many owners have lost access.
    for (let skipped = 0; skipped < 50; skipped++) {
      const job = await tx.aiJob.findFirst({
        where: { status: 'QUEUED' }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      })
      if (!job) return null
      let input: AiJobInput
      try { input = aiJobInputSchema.parse({ kind: job.kind, payload: JSON.parse(job.payloadJson) }) }
      catch {
        await tx.aiJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'PAYLOAD_INVALID' } })
        continue
      }
      try { await authorizeAiOwner(tx, job.ownerUserId, input.kind) }
      catch (error) {
        if (!(error instanceof AiQueueError) || error.code !== 'FORBIDDEN') throw error
        await tx.aiJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'ACCESS_REVOKED' } })
        continue
      }
      const leaseToken = randomUUID()
      const leaseUntil = new Date(now.getTime() + AI_JOB_LEASE_MS)
      const claimed = await tx.aiJob.update({ where: { id: job.id }, data: {
        status: 'RUNNING', attempts: { increment: 1 }, workerId, leaseToken, leaseUntil, errorCode: null,
      } })
      await tx.aiQueueLease.update({ where: { id: QUEUE_ID }, data: { workerId, leaseToken, leaseUntil } })
      return { ...input, id: job.id, ownerUserId: job.ownerUserId, leaseToken, leaseUntil, attempts: claimed.attempts }
    }
    return null
  })
}

async function assertLease(tx: Transaction, lease: AiQueueLease, workerId: string, jobId: string, leaseToken: string, now: Date): Promise<AiJob> {
  const job = await tx.aiJob.findUnique({ where: { id: jobId } })
  if (!job || job.status !== 'RUNNING' || job.workerId !== workerId || job.leaseToken !== leaseToken ||
    !job.leaseUntil || job.leaseUntil <= now || lease.workerId !== workerId || lease.leaseToken !== leaseToken ||
    !lease.leaseUntil || lease.leaseUntil <= now) throw new AiQueueError('LEASE_LOST', 409)
  return job
}

export async function heartbeatAiJob(db: PrismaClient, workerId: string, jobId: string, leaseToken: string, clock: AiQueueClock = () => new Date()): Promise<Date> {
  return withAiQueueMutation(db, clock, async (tx, lease, now) => {
    await assertLease(tx, lease, workerId, jobId, leaseToken, now)
    const leaseUntil = new Date(now.getTime() + AI_JOB_LEASE_MS)
    await tx.aiJob.update({ where: { id: jobId }, data: { leaseUntil } })
    await tx.aiQueueLease.update({ where: { id: QUEUE_ID }, data: { leaseUntil } })
    return leaseUntil
  })
}

export async function finishAiJob(db: PrismaClient, workerId: string, jobId: string, leaseToken: string, outcome: AiJobOutcome, clock: AiQueueClock = () => new Date()): Promise<void> {
  await withAiQueueMutation(db, clock, async (tx, lease, now) => {
    const job = await assertLease(tx, lease, workerId, jobId, leaseToken, now)
    let status = 'FAILED'
    let resultJson: string | null = null
    let parsedResult: AiJobResult | null = null
    let errorCode: AiFailureCode | null = null
    if (outcome.status === 'SUCCEEDED') {
      try {
        parsedResult = parseAiJobResult(aiJobKindSchema.parse(job.kind), outcome.result)
        resultJson = JSON.stringify(parsedResult)
        status = 'SUCCEEDED'
      } catch { errorCode = 'INVALID_RESULT' }
    } else {
      errorCode = sanitizeAiFailureCode(outcome.errorCode)
      if (aiPauseReason(errorCode)) status = 'BLOCKED'
    }
    // Keep parsing failures classified as INVALID_RESULT, but deliberately run
    // database effects outside that catch so any DB failure aborts everything.
    if (status === 'SUCCEEDED' && parsedResult !== null) {
      await applyInvoiceDraftAiResultInTransaction(tx, job, parsedResult)
    }
    await tx.aiJob.update({ where: { id: jobId }, data: { status, resultJson, errorCode, ...clearLease } })
    await tx.aiQueueLease.update({ where: { id: QUEUE_ID }, data: {
      ...clearLease, pauseReason: errorCode ? aiPauseReason(errorCode) : null,
    } })
  })
}
