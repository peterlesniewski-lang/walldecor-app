// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PrismaClient } from '@/generated/prisma'

const mocked = vi.hoisted(() => ({ claim: vi.fn(), heartbeat: vi.fn(), finish: vi.fn(), document: vi.fn() }))
vi.mock('@/lib/ai/queue', () => ({ claimAiJob: mocked.claim, heartbeatAiJob: mocked.heartbeat, finishAiJob: mocked.finish }))
vi.mock('@/lib/ai/worker-document', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/ai/worker-document')>(),
  getInvoiceWorkerDocument: mocked.document,
}))
import { createAiWorkerHandler } from '@/lib/ai/worker-http'
const key = 'test-only-worker-key-with-at-least-32-characters'
const db = {} as PrismaClient
const handler = (secret: string | undefined = key) => createAiWorkerHandler({ db, secret: () => secret })
const post = (body: unknown, token: string | null = key) => new NextRequest('http://localhost/api/internal/ai-worker', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
})

beforeEach(() => { vi.clearAllMocks(); mocked.claim.mockResolvedValue(null); mocked.heartbeat.mockResolvedValue(new Date('2026-09-10T10:01:00Z')); mocked.finish.mockResolvedValue(undefined); mocked.document.mockResolvedValue({ bytes: Buffer.from('document'), mimeType: 'image/png', byteSize: 8, sha256: 'a'.repeat(64) }) })

describe('private worker HTTP boundary', () => {
  it('fails closed with missing or wrong credentials before touching queue data', async () => {
    expect((await handler()(post({ action: 'claim', workerId: 'worker' }, null))).status).toBe(401)
    expect((await handler()(post({ action: 'claim', workerId: 'worker' }, 'wrong'))).status).toBe(401)
    expect((await handler('')(post({ action: 'claim', workerId: 'worker' }))).status).toBe(503)
    expect(mocked.claim).not.toHaveBeenCalled()
  })

  it('returns only prepared context, schema and the lease, never user or database metadata', async () => {
    mocked.claim.mockResolvedValue({ id: 'job-1', kind: 'FINANCE_CHAT', ownerUserId: 'private-user', leaseToken: '00000000-0000-4000-8000-000000000001', leaseUntil: new Date('2026-09-10T10:01:00Z'), attempts: 1, payload: { question: 'Wynik?', context: '{"revenue":null}' } })
    const response = await handler()(post({ action: 'claim', workerId: 'worker' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.job).toMatchObject({ id: 'job-1', kind: 'FINANCE_CHAT', leaseToken: '00000000-0000-4000-8000-000000000001' })
    expect(body.job.prompt).toContain('Wynik?')
    expect(body.job.schema).toMatchObject({ type: 'object', additionalProperties: false })
    expect(body.job).not.toHaveProperty('ownerUserId')
    expect(body.job).not.toHaveProperty('payloadJson')
    expect(body.job).not.toHaveProperty('payload')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('heartbeats and completes only the supplied fenced job', async () => {
    const lease = { workerId: 'worker', jobId: 'job-1', leaseToken: '00000000-0000-4000-8000-000000000001' }
    expect((await handler()(post({ action: 'heartbeat', ...lease }))).status).toBe(200)
    expect(mocked.heartbeat).toHaveBeenCalledWith(db, lease.workerId, lease.jobId, lease.leaseToken)
    const outcome = { status: 'SUCCEEDED', result: { answer: 'OK' } }
    expect((await handler()(post({ action: 'finish', ...lease, outcome }))).status).toBe(200)
    expect(mocked.finish).toHaveBeenCalledWith(db, lease.workerId, lease.jobId, lease.leaseToken, outcome)
  })

  it('fails closed when document storage is not injected', async () => {
    const response = await handler()(post({ action: 'document', workerId: 'worker', jobId: 'job-1', leaseToken: '00000000-0000-4000-8000-000000000001', attachmentId: 'attachment-1' }))
    expect(response.status).toBe(503)
    expect(mocked.document).not.toHaveBeenCalled()
  })

  it('rejects unknown fields, raw exception strings and arbitrary paths', async () => {
    for (const body of [
      { action: 'claim', workerId: 'worker', databaseUrl: 'file:/data/production.db' },
      { action: 'finish', workerId: 'worker', jobId: 'job-1', leaseToken: '00000000-0000-4000-8000-000000000001', outcome: { status: 'FAILED', errorCode: 'secret-token' } },
      { action: 'document', workerId: 'worker', jobId: 'job-1', leaseToken: '00000000-0000-4000-8000-000000000001', attachmentId: 'attachment-1', path: '/private/original' },
      { action: 'readFile', path: '/etc/passwd' },
    ]) expect((await handler()(post(body))).status).toBe(400)
    expect(mocked.claim).not.toHaveBeenCalled()
    expect(mocked.finish).not.toHaveBeenCalled()
  })
})
