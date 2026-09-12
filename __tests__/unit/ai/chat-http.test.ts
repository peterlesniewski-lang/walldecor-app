// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PrismaClient } from '@/generated/prisma'
import { AiQueueError } from '@/lib/ai/queue-errors'

const mocked = vi.hoisted(() => ({ authorize: vi.fn(), enqueue: vi.fn(), read: vi.fn(), retry: vi.fn(), load: vi.fn(), context: vi.fn(), find: vi.fn() }))
vi.mock('@/lib/ai/queue', () => ({ authorizeAiOwner: mocked.authorize, enqueueAiJob: mocked.enqueue, readAiJob: mocked.read, retryAiJob: mocked.retry }))
vi.mock('@/lib/finance/actual-dashboard-model-data', () => ({ loadActualDashboardModel: mocked.load }))
vi.mock('@/lib/ai/finance-context', () => ({ buildFinanceAiContext: mocked.context }))
import { createAiChatHandlers } from '@/lib/ai/chat-http'

const job = { id: 'job-1', kind: 'FINANCE_CHAT', status: 'QUEUED', result: null, errorCode: null, blockedReason: null, attempts: 0, createdAt: '2026-09-10T10:00:00.000Z', updatedAt: '2026-09-10T10:00:00.000Z' }
const requestId = '00000000-0000-4000-8000-000000000001'
const db = { aiJob: { findUnique: mocked.find } } as unknown as PrismaClient
const handlers = (userId: string | null = 'admin', readAt = '2026-09-10T10:00:00Z') => createAiChatHandlers({ db, getSession: async () => userId ? { user: { id: userId } } : null, now: () => new Date(readAt) })
const post = (body: unknown) => new NextRequest('http://localhost/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mocked.authorize.mockResolvedValue(undefined)
  mocked.find.mockResolvedValue(null)
  mocked.load.mockResolvedValue({ model: 'actuals' })
  mocked.context.mockReturnValue({ period: { year: 2026, month: 9 }, revenue: null })
  mocked.enqueue.mockResolvedValue(job)
  mocked.read.mockResolvedValue(job)
  mocked.retry.mockResolvedValue(job)
})

describe('asynchronous AI chat HTTP contracts', () => {
  it('authenticates current permissions before reading financial data', async () => {
    const anonymous = await handlers(null).financePOST(post({ question: 'Test', year: 2026 }))
    expect(anonymous.status).toBe(401)
    mocked.authorize.mockRejectedValue(new AiQueueError('FORBIDDEN', 403))
    expect((await handlers().financePOST(post({ question: 'Test', year: 2026 }))).status).toBe(403)
    expect(mocked.load).not.toHaveBeenCalled()
    expect(mocked.enqueue).not.toHaveBeenCalled()
  })

  it('queues the shared actual model with the explicit selected month and no synchronous provider', async () => {
    const response = await handlers().financePOST(post({ question: '  Jakie braki? ', year: 2026, month: 9, requestId }))
    expect(response.status).toBe(202)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocked.load).toHaveBeenCalledWith({ year: 2026, month: 9 }, new Date('2026-09-10T10:00:00Z'))
    expect(mocked.enqueue).toHaveBeenCalledWith(db, 'admin', { kind: 'FINANCE_CHAT', payload: { question: 'Jakie braki?', context: JSON.stringify({ period: { year: 2026, month: 9 }, revenue: null }) } }, requestId)
    expect(await response.json()).toEqual({ job })
  })

  it('requires an explicit month so accepted idempotent requests never change semantics at midnight', async () => {
    expect((await handlers().financePOST(post({ question: 'Test', year: 2026, requestId }))).status).toBe(400)
    expect(mocked.enqueue).not.toHaveBeenCalled()
  })

  it.each(['2026-09-30T22:05:00Z', '2026-12-31T23:05:00Z'])('recovers the original selected month after the Warsaw calendar rollover at %s', async (readAt) => {
    mocked.find.mockResolvedValue({ id: job.id, kind: 'FINANCE_CHAT', payloadJson: JSON.stringify({ question: 'Test', context: JSON.stringify({ period: { year: 2026, month: 9 } }) }) })
    const response = await handlers('admin', readAt).financePOST(post({ question: 'Test', year: 2026, month: 9, requestId }))
    expect(response.status).toBe(202)
    expect(mocked.load).not.toHaveBeenCalled()
    expect(mocked.enqueue).not.toHaveBeenCalled()
  })

  it('recovers an idempotent request before loading a changed dashboard snapshot', async () => {
    mocked.find.mockResolvedValue({ id: job.id, kind: 'FINANCE_CHAT', payloadJson: JSON.stringify({ question: 'Test', context: JSON.stringify({ period: { year: 2026, month: 9 } }) }) })
    const response = await handlers().financePOST(post({ question: 'Test', year: 2026, month: 9, requestId }))
    expect(response.status).toBe(202)
    expect(mocked.load).not.toHaveBeenCalled()
    expect(mocked.enqueue).not.toHaveBeenCalled()
    expect(mocked.read).toHaveBeenCalledWith(db, 'admin', job.id)
  })

  it('rejects reusing a request id for a different question or report period', async () => {
    mocked.find.mockResolvedValue({ id: job.id, kind: 'FINANCE_CHAT', payloadJson: JSON.stringify({ question: 'Original', context: JSON.stringify({ period: { year: 2026, month: 8 } }) }) })
    expect((await handlers().financePOST(post({ question: 'Different', year: 2026, month: 8, requestId }))).status).toBe(409)
    expect((await handlers().financePOST(post({ question: 'Original', year: 2026, month: 9, requestId }))).status).toBe(409)
    expect(mocked.enqueue).not.toHaveBeenCalled()
  })

  it('keeps wiki authorization and prepares at most the original article fragment', async () => {
    const response = await handlers('manager').wikiPOST(post({ question: 'Co to?', articleTitle: 'Artykuł', articleContent: 'x'.repeat(5000), requestId }))
    expect(response.status).toBe(202)
    expect(mocked.authorize).toHaveBeenCalledWith(db, 'manager', 'WIKI_CHAT')
    const input = mocked.enqueue.mock.calls[0][2]
    expect(input.kind).toBe('WIKI_CHAT')
    expect(JSON.parse(input.payload.context).articleContent).toHaveLength(3000)
    expect(mocked.load).not.toHaveBeenCalled()
  })

  it('rejects malformed, too large, blank and out-of-range requests without enqueueing', async () => {
    for (const body of [{ question: ' ', year: 2026 }, { question: 'Test', year: 2026, month: 13 }, { question: 'x'.repeat(501), year: 2026 }]) {
      expect((await handlers().financePOST(post(body))).status).toBe(400)
    }
    const malformed = new NextRequest('http://localhost/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
    expect((await handlers().financePOST(malformed)).status).toBe(400)
    expect((await handlers().wikiPOST(post({ question: 'Test', articleContent: 'x'.repeat(140_000) }))).status).toBe(413)
    expect(mocked.enqueue).not.toHaveBeenCalled()
  })

  it('delegates every job read and retry to the current owner without leaking internal failures', async () => {
    expect((await handlers('manager').jobGET('job-1')).status).toBe(200)
    expect(mocked.read).toHaveBeenCalledWith(db, 'manager', 'job-1')
    expect((await handlers('admin').retryPOST('job-1')).status).toBe(202)
    mocked.read.mockRejectedValue(new Error('secret database location'))
    const response = await handlers().jobGET('job-1')
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('secret')
  })
})
