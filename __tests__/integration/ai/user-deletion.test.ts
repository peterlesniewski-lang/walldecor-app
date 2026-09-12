// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { enqueueAiJob, readAiJob } from '@/lib/ai/queue'

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, session: null as Session | null }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client } }))
vi.mock('next-auth', () => ({ getServerSession: async () => state.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { DELETE, PATCH } from '@/app/api/users/[id]/route'

const conflictMessage = 'Konto ma historię zadań AI. Zablokuj konto zamiast je usuwać.'
const input = { kind: 'FINANCE_CHAT' as const, payload: { question: 'Synthetic question', context: 'Synthetic context only' } }
let directory = ''
let db: PrismaClient
let other: PrismaClient
let enqueueBeforeDelete = false
let actualDeleteErrorCode: unknown = null
const params = (id = 'target') => ({ params: Promise.resolve({ id }) })
const request = (method: 'DELETE' | 'PATCH', body?: unknown) => new NextRequest('http://localhost/api/users/target', {
  method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
})

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'walldecor-ai-user-delete-'))
  const databasePath = path.join(directory, 'users.db')
  const migrationRoot = path.resolve('prisma/migrations')
  const migrations = (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  for (const migration of migrations) {
    execFileSync('sqlite3', ['-bail', databasePath], { input: await readFile(path.join(migrationRoot, migration, 'migration.sql'), 'utf8'), stdio: 'pipe', timeout: 30_000 })
  }
  const createClient = () => new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } })
  db = createClient(); other = createClient(); state.client = db
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  // A scheduling hook only: both enqueue and the FK-rejected DELETE remain
  // real independent Prisma/SQLite operations, not fabricated P2003 errors.
  db.$use(async (command, next) => {
    if (enqueueBeforeDelete && command.model === 'User' && command.action === 'delete') {
      enqueueBeforeDelete = false
      await enqueueAiJob(other, 'target', input)
      try { return await next(command) }
      catch (error) {
        actualDeleteErrorCode = error && typeof error === 'object' && 'code' in error ? error.code : null
        throw error
      }
    }
    return next(command)
  })
}, 40_000)

beforeEach(async () => {
  enqueueBeforeDelete = false; actualDeleteErrorCode = null
  await db.aiJob.deleteMany()
  await db.aiQueueLease.deleteMany()
  await db.user.deleteMany()
  await db.employee.deleteMany()
  await db.costCenter.upsert({ where: { id: 'TEST' }, create: { id: 'TEST', name: 'Synthetic test' }, update: {} })
  for (const id of ['acting-admin', 'target']) {
    await db.user.create({ data: { id, name: id, email: `${id}@example.test`, passwordHash: 'test-only', role: 'ADMIN' } })
  }
  state.session = { user: { id: 'acting-admin', role: 'ADMIN', name: 'Synthetic admin', email: 'acting-admin@example.test' }, expires: '' }
})

afterAll(async () => {
  await db?.$disconnect(); await other?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('account deletion preserves durable AI history', () => {
  it.each(['QUEUED', 'SUCCEEDED', 'FAILED', 'CANCELLED'])('returns 409 and preserves a user with %s AI history', async (status) => {
    const job = await enqueueAiJob(db, 'target', input)
    const stored = await db.aiJob.update({ where: { id: job.id }, data: { status, ...(status === 'SUCCEEDED' ? { resultJson: JSON.stringify({ answer: 'Synthetic answer' }) } : {}) } })
    const user = await db.user.findUniqueOrThrow({ where: { id: 'target' } })
    const result = await DELETE(request('DELETE'), params())
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: conflictMessage })
    expect(await other.user.findUniqueOrThrow({ where: { id: 'target' } })).toEqual(user)
    expect(await other.aiJob.findUniqueOrThrow({ where: { id: job.id } })).toEqual(stored)
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
  })

  it('still allows blocking the account without deleting its AI history', async () => {
    const job = await enqueueAiJob(db, 'target', input)
    const result = await PATCH(request('PATCH', { isActive: false }), params())
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ id: 'target', isActive: false })
    expect(await other.user.findUniqueOrThrow({ where: { id: 'target' } })).toMatchObject({ isActive: false })
    expect(await other.aiJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ ownerUserId: 'target', status: 'QUEUED', payloadJson: JSON.stringify(input.payload) })
    await expect(readAiJob(db, 'target', job.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('deletes an account without AI history and rejects any later enqueue for that removed owner', async () => {
    const result = await DELETE(request('DELETE'), params())
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ success: true })
    expect(await other.user.findUnique({ where: { id: 'target' } })).toBeNull()
    await expect(enqueueAiJob(other, 'target', input)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await db.aiJob.count()).toBe(0)
  })

  it('maps the actual P2003 race after precheck to 409 instead of deleting history or returning 500', async () => {
    expect(await db.aiJob.count({ where: { ownerUserId: 'target' } })).toBe(0)
    enqueueBeforeDelete = true
    const result = await DELETE(request('DELETE'), params())
    expect(actualDeleteErrorCode).toBe('P2003')
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: conflictMessage })
    expect(await other.user.findUniqueOrThrow({ where: { id: 'target' } })).toMatchObject({ isActive: true })
    expect(await other.aiJob.findMany({ where: { ownerUserId: 'target' } })).toEqual([expect.objectContaining({ ownerUserId: 'target', payloadJson: JSON.stringify(input.payload), status: 'QUEUED' })])
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
  })

  it('retains the existing linked-employee deletion guard', async () => {
    await db.employee.create({ data: { id: 'employee-test', firstName: 'Synthetic', lastName: 'Employee', email: 'employee@example.test', position: 'Test', costCenterId: 'TEST', startDate: new Date('2026-01-01') } })
    await db.user.update({ where: { id: 'target' }, data: { employeeId: 'employee-test' } })
    const result = await DELETE(request('DELETE'), params())
    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ error: 'Nie można usunąć konta powiązanego z pracownikiem.' })
    expect(await other.user.findUnique({ where: { id: 'target' } })).not.toBeNull()
  })

  it('retains authentication, ADMIN, self-deletion and missing-account guards', async () => {
    state.session = null
    expect((await DELETE(request('DELETE'), params())).status).toBe(401)
    state.session = { user: { id: 'acting-admin', role: 'MANAGER', name: 'Manager', email: 'manager@example.test' }, expires: '' }
    expect((await DELETE(request('DELETE'), params())).status).toBe(403)
    state.session.user.role = 'ADMIN'
    expect((await DELETE(request('DELETE'), params('acting-admin'))).status).toBe(400)
    expect((await DELETE(request('DELETE'), params('missing'))).status).toBe(404)
    expect(await db.user.count()).toBe(2)
  })
})
