// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import {
  AI_JOB_LEASE_MS, AI_JOB_MAX_ATTEMPTS, authorizeAiOwner,
  enqueueAiJob, readAiJob, retryAiJob, claimAiJob, heartbeatAiJob, finishAiJob,
} from '@/lib/ai/queue'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-ai-queue-'))
const databaseUrl = `file:${path.join(directory, 'queue.db')}`
const client = () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
let db: PrismaClient
let other: PrismaClient
const at = new Date('2026-09-10T12:00:00.000Z')
const after = (milliseconds: number) => new Date(at.getTime() + milliseconds)
const finance = (question = 'Jak wygląda wynik?') => ({ kind: 'FINANCE_CHAT' as const, payload: { question, context: '{"netProfit":0}' } })
const wiki = { kind: 'WIKI_CHAT' as const, payload: { question: 'Procedura?', context: 'Dane procedury' } }
const invoice = { kind: 'INVOICE_EXTRACT' as const, payload: { draftId: 'draft-a', revision: 1, attachmentId: 'file-a' } }

beforeAll(async () => {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' }, encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(migrated.stderr || migrated.stdout)
  db = client()
  other = client()
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
})

beforeEach(async () => {
  await db.aiJob.deleteMany()
  await db.aiQueueLease.deleteMany()
  await db.user.deleteMany()
  for (const [id, role] of [['admin', 'ADMIN'], ['admin2', 'ADMIN'], ['manager', 'MANAGER'], ['employee', 'EMPLOYEE']]) {
    await db.user.create({ data: { id, role, name: id, email: `${id}@example.test`, passwordHash: 'test-only' } })
  }
})

afterAll(async () => {
  await db?.$disconnect()
  await other?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('durable shared AI queue', () => {
  it.each(['finish', 'heartbeat'] as const)('does not let %s renew an expired lease after waiting for a SQLite writer', async (operation) => {
    const job = await enqueueAiJob(db, 'admin', finance())
    const claim = (await claimAiJob(db, 'worker'))!
    const expires = new Date(Date.now() + 350)
    await db.$transaction([
      db.aiJob.update({ where: { id: job.id }, data: { leaseUntil: expires } }),
      db.aiQueueLease.update({ where: { id: 'shared-ai' }, data: { leaseUntil: expires } }),
    ])
    let locked!: () => void
    const lockAcquired = new Promise<void>((resolve) => { locked = resolve })
    const writer = other.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "AiQueueLease" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'shared-ai'`
      locked()
      await new Promise((resolve) => setTimeout(resolve, 700))
    }, { timeout: 5_000 })
    await lockAcquired
    const pending = operation === 'finish'
      ? finishAiJob(db, 'worker', job.id, claim.leaseToken, { status: 'SUCCEEDED', result: { answer: 'Too late' } })
      : heartbeatAiJob(db, 'worker', job.id, claim.leaseToken)
    await expect(pending).rejects.toMatchObject({ code: 'LEASE_LOST' })
    await writer
    expect((await db.aiJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('RUNNING')
  })

  it('persists a data-only job across client restart and isolates owner reads', async () => {
    const job = await enqueueAiJob(db, 'admin', finance(), 'request-one')
    expect(job).toMatchObject({ kind: 'FINANCE_CHAT', status: 'QUEUED', result: null, errorCode: null, blockedReason: null, attempts: 0 })
    expect(job).not.toHaveProperty('payloadJson')
    expect(job).not.toHaveProperty('leaseToken')
    await db.$disconnect()
    db = client()
    expect(await readAiJob(db, 'admin', job.id)).toEqual(job)
    await expect(readAiJob(db, 'admin2', job.id)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(await db.actualEntry.count()).toBe(0)
    expect(await db.costEvent.count()).toBe(0)
  })

  it('rechecks current role, active status and password gate on enqueue/read/retry', async () => {
    await expect(authorizeAiOwner(db, 'manager', 'FINANCE_CHAT')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(enqueueAiJob(db, 'employee', wiki)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(enqueueAiJob(db, 'manager', invoice)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const job = await enqueueAiJob(db, 'manager', wiki)
    await db.user.update({ where: { id: 'manager' }, data: { isActive: false } })
    await expect(readAiJob(db, 'manager', job.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(retryAiJob(db, 'manager', job.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await db.user.update({ where: { id: 'manager' }, data: { isActive: true, role: 'EMPLOYEE' } })
    await expect(readAiJob(db, 'manager', job.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await db.user.update({ where: { id: 'admin' }, data: { mustChangePassword: true } })
    await expect(enqueueAiJob(db, 'admin', finance())).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects malformed inputs and idempotency collisions while concurrent duplicate submits reuse one job', async () => {
    await expect(enqueueAiJob(db, 'admin', { ...finance(), payload: { question: 'q', context: '', command: 'unsafe' } })).rejects.toMatchObject({ status: 422, code: 'INVALID_INPUT' })
    const jobs = await Promise.all([
      enqueueAiJob(db, 'admin', finance(), 'same-key'),
      enqueueAiJob(other, 'admin', finance(), 'same-key'),
    ])
    expect(jobs[0].id).toBe(jobs[1].id)
    expect(await db.aiJob.count()).toBe(1)
    await expect(enqueueAiJob(db, 'admin', finance('Different question'), 'same-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect((await enqueueAiJob(other, 'admin2', finance(), 'same-key')).id).not.toBe(jobs[0].id)
  })

  it('claims chat priority before invoices and FIFO within a priority across independent clients', async () => {
    const low = await enqueueAiJob(db, 'admin', invoice)
    const first = await enqueueAiJob(db, 'admin', finance())
    const second = await enqueueAiJob(db, 'manager', wiki)
    await db.aiJob.update({ where: { id: first.id }, data: { createdAt: after(-200) } })
    await db.aiJob.update({ where: { id: second.id }, data: { createdAt: after(-100) } })
    const claimed = await claimAiJob(other, 'worker-a', at)
    expect(claimed).toMatchObject({ id: first.id, kind: 'FINANCE_CHAT', payload: finance().payload, attempts: 1 })
    expect(await claimAiJob(db, 'worker-a', after(1))).toBeNull()
    await finishAiJob(other, 'worker-a', claimed!.id, claimed!.leaseToken, { status: 'SUCCEEDED', result: { answer: 'A' } }, after(2))
    const next = await claimAiJob(db, 'worker-b', after(3))
    expect(next!.id).toBe(second.id)
    await finishAiJob(db, 'worker-b', next!.id, next!.leaseToken, { status: 'SUCCEEDED', result: { answer: 'B' } }, after(4))
    expect((await claimAiJob(other, 'worker-c', after(5)))!.id).toBe(low.id)
  })

  it('permits exactly one concurrent claim and heartbeats renew only the matching live lease', async () => {
    await enqueueAiJob(db, 'admin', finance())
    await enqueueAiJob(db, 'admin', finance('Second'))
    const claims = await Promise.all([claimAiJob(db, 'worker-a', at), claimAiJob(other, 'worker-b', at)])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const index = claims.findIndex(Boolean)
    const claim = claims[index]!
    const worker = index === 0 ? 'worker-a' : 'worker-b'
    await expect(heartbeatAiJob(db, 'outsider', claim.id, claim.leaseToken, after(500))).rejects.toMatchObject({ code: 'LEASE_LOST' })
    expect(await heartbeatAiJob(db, worker, claim.id, claim.leaseToken, after(1_000))).toEqual(after(AI_JOB_LEASE_MS + 1_000))
    expect(await claimAiJob(other, 'worker-c', after(AI_JOB_LEASE_MS + 500))).toBeNull()
    expect(await db.aiJob.count({ where: { status: 'RUNNING' } })).toBe(1)
  })

  it('recovers crashed workers after expiry and fences stale completion even for the same worker id', async () => {
    const job = await enqueueAiJob(db, 'admin', finance())
    const old = (await claimAiJob(db, 'worker-a', at))!
    await db.$disconnect()
    db = client()
    const fresh = (await claimAiJob(db, 'worker-a', after(AI_JOB_LEASE_MS + 1)))!
    expect(fresh.id).toBe(job.id)
    expect(fresh.attempts).toBe(2)
    expect(fresh.leaseToken).not.toBe(old.leaseToken)
    await expect(finishAiJob(other, 'worker-a', old.id, old.leaseToken, { status: 'SUCCEEDED', result: { answer: 'Stale output' } }, after(AI_JOB_LEASE_MS + 2))).rejects.toMatchObject({ code: 'LEASE_LOST' })
    await expect(heartbeatAiJob(other, 'worker-a', old.id, old.leaseToken, after(AI_JOB_LEASE_MS + 2))).rejects.toMatchObject({ code: 'LEASE_LOST' })
    await finishAiJob(db, 'worker-a', fresh.id, fresh.leaseToken, { status: 'SUCCEEDED', result: { answer: 'Fresh output' } }, after(AI_JOB_LEASE_MS + 3))
    expect(await readAiJob(db, 'admin', job.id)).toMatchObject({ status: 'SUCCEEDED', result: { answer: 'Fresh output' } })
  })

  it('stops automatic crash recovery after the attempt cap and permits explicit owner retry', async () => {
    const job = await enqueueAiJob(db, 'admin', finance())
    for (let attempt = 0; attempt < AI_JOB_MAX_ATTEMPTS; attempt++) {
      expect((await claimAiJob(db, `worker-${attempt}`, after(attempt * (AI_JOB_LEASE_MS + 1))))?.attempts).toBe(attempt + 1)
    }
    expect(await claimAiJob(db, 'last-worker', after(AI_JOB_MAX_ATTEMPTS * (AI_JOB_LEASE_MS + 1)))).toBeNull()
    expect(await readAiJob(db, 'admin', job.id)).toMatchObject({ status: 'FAILED', errorCode: 'LEASE_EXPIRED' })
    expect(await retryAiJob(db, 'admin', job.id)).toMatchObject({ status: 'QUEUED', attempts: 0, errorCode: null })
  })

  it.each(['QUOTA', 'AUTH', 'MODEL_UNAVAILABLE'] as const)('globally pauses on %s and resumes only after explicit authorized retry', async (errorCode) => {
    const failed = await enqueueAiJob(db, 'admin', finance())
    const waiting = await enqueueAiJob(db, 'manager', wiki)
    await db.aiJob.update({ where: { id: failed.id }, data: { createdAt: after(-1) } })
    const claim = (await claimAiJob(db, 'worker', at))!
    await finishAiJob(db, 'worker', claim.id, claim.leaseToken, { status: 'BLOCKED', errorCode }, after(1))
    expect(await readAiJob(db, 'admin', failed.id)).toMatchObject({ status: 'BLOCKED', errorCode, blockedReason: errorCode })
    expect(await readAiJob(db, 'manager', waiting.id)).toMatchObject({ status: 'QUEUED', blockedReason: errorCode })
    expect(await claimAiJob(other, 'new-worker', after(2))).toBeNull()
    await expect(retryAiJob(db, 'admin2', failed.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await db.user.update({ where: { id: 'admin' }, data: { role: 'EMPLOYEE' } })
    await expect(retryAiJob(db, 'admin', failed.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await db.aiQueueLease.findUniqueOrThrow({ where: { id: 'shared-ai' } })).pauseReason).toBe(errorCode)
    await db.user.update({ where: { id: 'admin' }, data: { role: 'ADMIN' } })
    expect(await retryAiJob(db, 'admin', failed.id)).toMatchObject({ status: 'QUEUED', blockedReason: null })
    expect(await claimAiJob(other, 'new-worker', after(3))).not.toBeNull()
  })

  it('rejects invalid success results and stores only sanitized failure codes', async () => {
    const first = await enqueueAiJob(db, 'admin', finance())
    const claim = (await claimAiJob(db, 'worker', at))!
    await finishAiJob(db, 'worker', claim.id, claim.leaseToken, { status: 'SUCCEEDED', result: { answer: 'x', command: 'unsafe' } }, after(1))
    expect(await readAiJob(db, 'admin', first.id)).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_RESULT', result: null })
    await retryAiJob(db, 'admin', first.id)
    const again = (await claimAiJob(db, 'worker', after(2)))!
    await finishAiJob(db, 'worker', again.id, again.leaseToken, { status: 'FAILED', errorCode: 'secret-token-in-raw-error' as never }, after(3))
    const stored = await db.aiJob.findUniqueOrThrow({ where: { id: first.id } })
    expect(stored.errorCode).toBe('RUNNER_ERROR')
    expect(JSON.stringify(stored)).not.toContain('secret-token')
  })

  it('allows a waiting job owner to explicitly resume a paused queue without needing another owner job', async () => {
    const failed = await enqueueAiJob(db, 'admin', finance())
    const claim = (await claimAiJob(db, 'worker', at))!
    await finishAiJob(db, 'worker', failed.id, claim.leaseToken, { status: 'BLOCKED', errorCode: 'AUTH' }, after(1))
    const waiting = await enqueueAiJob(db, 'manager', wiki)
    expect(waiting.blockedReason).toBe('AUTH')
    await expect(retryAiJob(db, 'admin', waiting.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await retryAiJob(db, 'manager', waiting.id)).toMatchObject({ status: 'QUEUED', blockedReason: null })
    expect((await claimAiJob(db, 'worker', after(2)))?.id).toBe(waiting.id)
    expect((await readAiJob(db, 'admin', failed.id)).status).toBe('BLOCKED')
  })

  it('does not restart a queued job when the shared queue is already active', async () => {
    const waiting = await enqueueAiJob(db, 'admin', finance())
    await expect(retryAiJob(db, 'admin', waiting.id)).rejects.toMatchObject({ code: 'JOB_NOT_RETRYABLE' })
  })

  it('does not execute queued work after its owner loses access', async () => {
    const job = await enqueueAiJob(db, 'admin', finance())
    await db.user.update({ where: { id: 'admin' }, data: { role: 'MANAGER' } })
    expect(await claimAiJob(db, 'worker', at)).toBeNull()
    expect(await db.aiJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'FAILED', errorCode: 'ACCESS_REVOKED' })
  })

  it('rejects retry of a running or successful job and refuses completion after expiry without reclamation', async () => {
    const job = await enqueueAiJob(db, 'admin', finance())
    const claim = (await claimAiJob(db, 'worker', at))!
    await expect(retryAiJob(db, 'admin', job.id)).rejects.toMatchObject({ code: 'JOB_NOT_RETRYABLE' })
    await expect(finishAiJob(db, 'worker', claim.id, claim.leaseToken, { status: 'SUCCEEDED', result: { answer: 'Expired' } }, after(AI_JOB_LEASE_MS))).rejects.toMatchObject({ code: 'LEASE_LOST' })
    await expect(heartbeatAiJob(db, 'worker', claim.id, claim.leaseToken, after(AI_JOB_LEASE_MS))).rejects.toMatchObject({ code: 'LEASE_LOST' })
    const replacement = (await claimAiJob(db, 'worker2', after(AI_JOB_LEASE_MS + 1)))!
    await finishAiJob(db, 'worker2', replacement.id, replacement.leaseToken, { status: 'SUCCEEDED', result: { answer: 'Ok' } }, after(AI_JOB_LEASE_MS + 2))
    await expect(retryAiJob(db, 'admin', job.id)).rejects.toMatchObject({ code: 'JOB_NOT_RETRYABLE' })
  })
})
