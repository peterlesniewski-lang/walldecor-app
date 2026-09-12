// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { createAiWorkerHandler } from '@/lib/ai/worker-http'
import { createAiWorkerTransport, type ParsedAiWorkerClaim } from '@/lib/ai/worker-client'
import { createAiWorkerConsumer } from '@/lib/ai/worker-consumer'
import { CodexRunError } from '@/lib/ai/codex-policy'
import { enqueueAiJob } from '@/lib/ai/queue'
import type { AiJobResult } from '@/lib/ai/contracts'

type ChatFactory = typeof import('@/lib/ai/chat-http').createAiChatHandlers
type PublicJob = { id: string; kind: string; status: string; result: { answer: string } | null; errorCode: string | null; blockedReason: string | null; attempts: number }
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-ai-http-consumer-'))
const databaseUrl = `file:${path.join(directory, 'integration.db')}`
const fixtureCredential = 'synthetic-worker-credential-not-for-production'
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
const previousPrisma = globalForPrisma.prisma
const clients = new Set<PrismaClient>()
let db: PrismaClient
let createChatHandlers: ChatFactory
let server: Server | undefined
let origin = ''
const workerActions: Array<{ action: string; jobId?: string; status: number }> = []
const serverErrors: unknown[] = []

function makeClient() {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  clients.add(client)
  return client
}

async function startServer() {
  const worker = createAiWorkerHandler({ db, secret: () => fixtureCredential })
  server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      const url = new URL(incoming.url ?? '/', origin)
      const request = new NextRequest(url, { method: incoming.method, headers, ...(body.length ? { body } : {}) })
      // Only the session boundary is a fixture. Every current role/owner check
      // still runs against actual User records in the disposable SQLite DB.
      const userId = headers.get('x-test-user')
      const chat = createChatHandlers({ db, getSession: async () => userId ? { user: { id: userId } } : null, now: () => new Date('2026-09-10T12:00:00Z') })
      const jobRoute = /^\/api\/ai\/jobs\/([^/]+)(\/retry)?$/.exec(url.pathname)
      let response: Response
      if (incoming.method === 'POST' && url.pathname === '/api/internal/ai-worker') {
        response = await worker(request)
        const command = JSON.parse(body.toString('utf8')) as { action: string; jobId?: string }
        workerActions.push({ action: command.action, jobId: command.jobId, status: response.status })
      } else if (incoming.method === 'POST' && url.pathname === '/api/ai/chat') response = await chat.financePOST(request)
      else if (incoming.method === 'POST' && url.pathname === '/api/knowledge/ai') response = await chat.wikiPOST(request)
      else if (incoming.method === 'GET' && jobRoute && !jobRoute[2]) response = await chat.jobGET(jobRoute[1])
      else if (incoming.method === 'POST' && jobRoute?.[2]) response = await chat.retryPOST(jobRoute[1])
      else response = new Response('Not found', { status: 404 })
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      serverErrors.push(error)
      outgoing.writeHead(500, { 'Content-Type': 'application/json' })
      outgoing.end('{"code":"FIXTURE_SERVER_ERROR"}')
    }
  })
  await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback server address')
  origin = `http://127.0.0.1:${address.port}`
}

async function stopServer() {
  if (!server?.listening) { server = undefined; return }
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
  server = undefined
}

async function request(method: 'GET' | 'POST', route: string, owner: string | null, body?: unknown) {
  const response = await fetch(`${origin}${route}`, {
    method, headers: { ...(owner ? { 'x-test-user': owner } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, headers: response.headers, body: await response.json() as { job: PublicJob; code?: string } }
}

async function enqueueChat(kind: 'FINANCE_CHAT' | 'WIKI_CHAT', owner = kind === 'FINANCE_CHAT' ? 'admin' : 'manager') {
  const body = kind === 'FINANCE_CHAT'
    ? { question: 'Jaki jest przychód w wybranym miesiącu?', year: 2026, month: 8, requestId: randomUUID() }
    : { question: 'Jak przyjąć dostawę?', articleTitle: 'Przyjęcie dostawy', articleContent: 'Sprawdź liczbę paczek i uszkodzenia.', requestId: randomUUID() }
  const response = await request('POST', kind === 'FINANCE_CHAT' ? '/api/ai/chat' : '/api/knowledge/ai', owner, body)
  expect(response.status, JSON.stringify(response.body)).toBe(202)
  expect(response.body.job.status).toBe('QUEUED')
  return response.body.job
}

function consumer(workerId: string, runJob: (claim: ParsedAiWorkerClaim, signal: AbortSignal) => Promise<AiJobResult>) {
  return createAiWorkerConsumer({
    workerId, runJob,
    transport: createAiWorkerTransport({ url: `${origin}/api/internal/ai-worker`, secret: fixtureCredential }),
  })
}

beforeAll(async () => {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' }, encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(migrated.stderr || migrated.stdout)
  db = makeClient()
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  // The real dashboard loader uses the application's shared Prisma instance.
  // Install a REAL disposable-DB client before importing it; no DB/loader mocks.
  globalForPrisma.prisma = makeClient()
  createChatHandlers = (await import('@/lib/ai/chat-http')).createAiChatHandlers
  await db.costCenter.upsert({ where: { id: 'JAG' }, create: { id: 'JAG', name: 'Synthetic salon' }, update: {} })
  await db.revenue.create({ data: { year: 2026, month: 8, costCenterId: 'JAG', channel: 'SALON', amount: 12_345, asOfDate: '2026-08-31' } })
  await startServer()
})

beforeEach(async () => {
  workerActions.length = 0
  serverErrors.length = 0
  await db.aiJob.deleteMany()
  await db.aiQueueLease.deleteMany()
  await db.user.deleteMany()
  for (const [id, role] of [['admin', 'ADMIN'], ['other-admin', 'ADMIN'], ['manager', 'MANAGER'], ['employee', 'EMPLOYEE']]) {
    await db.user.create({ data: { id, role, email: `${id}@example.test`, name: id, passwordHash: 'synthetic-not-a-password' } })
  }
})

afterAll(async () => {
  await stopServer()
  await Promise.all([...clients].map((client) => client.$disconnect()))
  globalForPrisma.prisma = previousPrisma
  rmSync(directory, { recursive: true, force: true })
})

describe('SQLite + actual chat/worker HTTP handlers + HTTP transport + consumer', () => {
  it('delivers finance and wiki answers through enqueue, claim, heartbeat, finish and owner GET', async () => {
    const finance = await enqueueChat('FINANCE_CHAT')
    const wiki = await enqueueChat('WIKI_CHAT')
    const observed: string[] = []
    const runner = consumer('roundtrip-worker', async (claim, signal) => {
      observed.push(claim.kind)
      expect(signal.aborted).toBe(false)
      expect(claim.schema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(claim).not.toHaveProperty('ownerUserId')
      expect(JSON.stringify(claim)).not.toContain(fixtureCredential)
      if (claim.kind === 'FINANCE_CHAT') {
        const payload = JSON.parse(claim.prompt.split('\nDATA_JSON\n')[1]) as { context: string }
        expect(JSON.parse(payload.context)).toMatchObject({ period: { year: 2026, month: 8 }, selected: { revenue: 12_345 } })
      } else expect(claim.prompt).toContain('Sprawdź liczbę paczek i uszkodzenia.')
      const view = await request('GET', `/api/ai/jobs/${claim.id}`, claim.kind === 'FINANCE_CHAT' ? 'admin' : 'manager')
      expect(view.body.job.status).toBe('RUNNING')
      return { answer: `Odpowiedź ${claim.kind}` }
    })
    expect(await runner.runOnce()).toBe('succeeded')
    expect(await runner.runOnce()).toBe('succeeded')
    expect(await runner.runOnce()).toBe('idle')
    expect(observed).toEqual(['FINANCE_CHAT', 'WIKI_CHAT'])
    for (const [job, owner] of [[finance, 'admin'], [wiki, 'manager']] as const) {
      const result = await request('GET', `/api/ai/jobs/${job.id}`, owner)
      expect(result.status).toBe(200)
      expect(result.headers.get('cache-control')).toBe('private, no-store')
      expect(result.body.job).toMatchObject({ status: 'SUCCEEDED', attempts: 1, result: { answer: `Odpowiedź ${job.kind}` } })
      expect(result.body.job).not.toHaveProperty('payloadJson')
      expect(result.body.job).not.toHaveProperty('leaseToken')
      expect((await request('GET', `/api/ai/jobs/${job.id}`, 'other-admin')).status).toBe(404)
    }
    expect(workerActions.map(({ action }) => action)).toEqual(['claim', 'heartbeat', 'finish', 'claim', 'heartbeat', 'finish', 'claim'])
    expect(workerActions.every(({ status }) => status === 200)).toBe(true)
    expect(await db.revenue.findFirstOrThrow()).toMatchObject({ amount: 12_345 })
    expect(await db.costEvent.count()).toBe(0)
    expect(serverErrors).toEqual([])
  })

  it('claims a newer chat before an older invoice without pretending that document extraction has an image handler', async () => {
    const invoice = await enqueueAiJob(db, 'admin', { kind: 'INVOICE_EXTRACT', payload: { draftId: 'synthetic-draft', revision: 1, attachmentId: 'synthetic-attachment' } })
    await db.aiJob.update({ where: { id: invoice.id }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } })
    const chat = await enqueueChat('WIKI_CHAT')
    const observed: string[] = []
    const runner = consumer('priority-worker', async (claim) => { observed.push(claim.kind); return { answer: 'Czat ma priorytet.' } })
    expect(await runner.runOnce()).toBe('succeeded')
    expect(observed).toEqual(['WIKI_CHAT'])
    expect((await request('GET', `/api/ai/jobs/${chat.id}`, 'manager')).body.job.status).toBe('SUCCEEDED')
    expect(await db.aiJob.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: 'QUEUED', attempts: 0 })
    expect(serverErrors).toEqual([])
  })

  it.each(['AUTH', 'QUOTA'] as const)('persists global %s blocking across consumer restart and resumes only after an authorized explicit retry', async (code) => {
    const first = await enqueueChat('FINANCE_CHAT')
    const waiting = await enqueueChat('WIKI_CHAT')
    let failedCalls = 0
    const blockedWorker = consumer('blocked-worker', async () => { failedCalls++; throw new CodexRunError(code) })
    expect(await blockedWorker.runOnce()).toBe('failed')
    expect((await request('GET', `/api/ai/jobs/${first.id}`, 'admin')).body.job).toMatchObject({ status: 'BLOCKED', errorCode: code, blockedReason: code })
    expect((await request('GET', `/api/ai/jobs/${waiting.id}`, 'manager')).body.job).toMatchObject({ status: 'QUEUED', blockedReason: code })
    let resumedCalls = 0
    const restartedWorker = consumer('restarted-worker', async () => { resumedCalls++; return { answer: 'Wznowiono po świadomej próbie.' } })
    expect(await restartedWorker.runOnce()).toBe('idle')
    expect(failedCalls).toBe(1)
    expect(resumedCalls).toBe(0)
    expect((await request('POST', `/api/ai/jobs/${waiting.id}/retry`, 'other-admin')).status).toBe(404)
    expect((await db.aiQueueLease.findUniqueOrThrow({ where: { id: 'shared-ai' } })).pauseReason).toBe(code)
    const retry = await request('POST', `/api/ai/jobs/${waiting.id}/retry`, 'manager')
    expect(retry.status).toBe(202)
    expect(retry.body.job).toMatchObject({ status: 'QUEUED', blockedReason: null })
    expect(await restartedWorker.runOnce()).toBe('succeeded')
    expect(resumedCalls).toBe(1)
    expect((await request('GET', `/api/ai/jobs/${waiting.id}`, 'manager')).body.job.result).toEqual({ answer: 'Wznowiono po świadomej próbie.' })
    expect((await request('GET', `/api/ai/jobs/${first.id}`, 'admin')).body.job.status).toBe('BLOCKED')
    expect(serverErrors).toEqual([])
  })

  it('preserves completed results and queued work after HTTP server, transport, consumer and Prisma client restart', async () => {
    const first = await enqueueChat('FINANCE_CHAT')
    const waiting = await enqueueChat('WIKI_CHAT')
    expect(await consumer('before-restart', async () => ({ answer: 'Zapisane przed restartem.' })).runOnce()).toBe('succeeded')
    const saved = (await request('GET', `/api/ai/jobs/${first.id}`, 'admin')).body.job
    await stopServer()
    await db.$disconnect()
    db = makeClient()
    await startServer()
    expect((await request('GET', `/api/ai/jobs/${first.id}`, 'admin')).body.job).toEqual(saved)
    expect((await request('GET', `/api/ai/jobs/${waiting.id}`, 'manager')).body.job).toMatchObject({ status: 'QUEUED', attempts: 0 })
    const observed: string[] = []
    const afterRestart = consumer('after-restart', async (claim) => { observed.push(claim.id); return { answer: 'Wynik po restarcie.' } })
    expect(await afterRestart.runOnce()).toBe('succeeded')
    expect(await afterRestart.runOnce()).toBe('idle')
    expect(observed).toEqual([waiting.id])
    expect((await request('GET', `/api/ai/jobs/${first.id}`, 'admin')).body.job).toEqual(saved)
    expect((await request('GET', `/api/ai/jobs/${waiting.id}`, 'manager')).body.job.result).toEqual({ answer: 'Wynik po restarcie.' })
    expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }])
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
    expect(serverErrors).toEqual([])
  })
})
