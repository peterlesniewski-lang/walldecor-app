// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiChatClient, type AiChatClient } from '@/lib/ai/client'

function job(status: string, overrides: Record<string, unknown> = {}) {
  return { id: 'job-one', kind: 'FINANCE_CHAT', status, result: status === 'SUCCEEDED' ? { answer: 'Wynik: 500 PLN.' } : null,
    errorCode: null, blockedReason: null, attempts: 0, createdAt: '2026-09-10T12:00:00.000Z', updatedAt: '2026-09-10T12:00:00.000Z', ...overrides }
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const question = { kind: 'FINANCE_CHAT' as const, question: 'Jaki wynik?', year: 2026, month: 9 }
let client: AiChatClient
let fetchMock: ReturnType<typeof vi.fn>
let answer: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  answer = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  client = createAiChatClient({ onState: vi.fn(), onAnswer: answer })
})
afterEach(() => {
  client.dispose()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('shared queued chat client', () => {
  it('enqueues once, polls with backoff, then delivers one validated answer', async () => {
    fetchMock.mockResolvedValueOnce(response({ job: job('QUEUED') }, 202))
      .mockResolvedValueOnce(response({ job: job('RUNNING') }))
      .mockResolvedValueOnce(response({ job: job('SUCCEEDED') }))
    expect(client.submit(question)).toBe(true)
    expect(client.submit(question)).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getState()).toMatchObject({ busy: true, message: 'W kolejce' })
    const submitted = JSON.parse(fetchMock.mock.calls[0][1].body) as { requestId: string }
    expect(submitted.requestId).toMatch(/^[0-9a-f-]{36}$/)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(client.getState().message).toBe('Przygotowuję odpowiedź')
    await vi.advanceTimersByTimeAsync(3000)
    expect(answer).toHaveBeenCalledExactlyOnceWith('Wynik: 500 PLN.')
    expect(client.getState()).toMatchObject({ busy: false, canSubmit: true, action: null })
    expect(fetchMock.mock.calls.slice(1).every(([url, init]) => url === '/api/ai/jobs/job-one' && init.method === 'GET')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['AUTH', 'QUOTA', 'MODEL_UNAVAILABLE'])('shows a controlled %s block and retries the existing job only on request', async (code) => {
    fetchMock.mockResolvedValueOnce(response({ job: job('BLOCKED', { errorCode: code, blockedReason: code, attempts: 3 }) }, 202))
      .mockResolvedValueOnce(response({ job: job('SUCCEEDED') }))
    client.submit(question)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getState()).toMatchObject({ busy: false, action: 'retry' })
    expect(client.getState().message).not.toContain(code)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(client.retry()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/ai/jobs/job-one/retry')
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(answer).toHaveBeenCalledTimes(1)
  })

  it('stops polling a paused queued job and retries the existing job only by explicit action', async () => {
    fetchMock.mockResolvedValueOnce(response({ job: job('QUEUED', { blockedReason: 'QUOTA' }) }, 202))
      .mockResolvedValueOnce(response({ job: job('SUCCEEDED') }))
    client.submit(question)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getState()).toMatchObject({ busy: false, canSubmit: false, action: 'retry' })
    expect(client.getState().message).toContain('Osiągnięto limit AI')
    expect(client.getState().message).toMatch(/ponów zadanie/i)
    expect(client.resume()).toBe(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(client.retry()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/ai/jobs/job-one/retry')
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(answer).toHaveBeenCalledTimes(1)
  })

  it('preserves a known job id after network failure and never enqueues it again', async () => {
    fetchMock.mockResolvedValueOnce(response({ job: job('QUEUED') }, 202))
      .mockRejectedValueOnce(new Error('private URL and token'))
      .mockResolvedValueOnce(response({ job: job('SUCCEEDED') }))
    client.submit(question)
    await vi.advanceTimersByTimeAsync(2000)
    expect(client.getState()).toMatchObject({ job: { id: 'job-one' }, busy: false, action: 'resume', canSubmit: false })
    expect(client.retry()).toBe(false)
    expect(client.getState().message).not.toContain('private')
    expect(client.submit(question)).toBe(false)
    client.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    expect(answer).toHaveBeenCalledTimes(1)
  })

  it('recovers an uncertain initial POST only manually with the original requestId and frozen question', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(response({ job: job('SUCCEEDED') }))
    const mutable = { ...question }
    client.submit(mutable)
    mutable.month = 1
    mutable.question = 'Nowe pytanie'
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getState()).toMatchObject({ job: null, busy: false, action: 'recover', canSubmit: false })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    client.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ question: 'Jaki wynik?', month: 9 })
  })

  it.each(['ACCESS_REVOKED', 'PAYLOAD_INVALID'])('does not offer retry for %s or expose raw server text', async (code) => {
    fetchMock.mockResolvedValueOnce(response({ job: job('FAILED', { errorCode: code }), error: 'SECRET' }, 202))
    client.submit(question)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getState()).toMatchObject({ busy: false, action: null })
    expect(client.getState().message).not.toContain('SECRET')
    expect(client.retry()).toBe(false)
  })

  it('maps HTTP authentication failures without showing backend errors', async () => {
    fetchMock.mockResolvedValueOnce(response({ code: 'AUTH', error: 'secret authentication detail' }, 401))
    client.submit(question)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getState()).toMatchObject({ busy: false, action: null })
    expect(client.getState().message).toContain('Zaloguj')
    expect(client.getState().message).not.toContain('secret')
  })

  it('rejects mismatched jobs and malformed success results instead of delivering untrusted output', async () => {
    fetchMock.mockResolvedValueOnce(response({ job: job('QUEUED') }, 202))
      .mockResolvedValueOnce(response({ job: job('SUCCEEDED', { id: 'other-job', result: { answer: 'WRONG ANSWER' } }) }))
      .mockResolvedValueOnce(response({ job: job('SUCCEEDED', { result: { answer: 123 } }) }))
    client.submit(question)
    await vi.advanceTimersByTimeAsync(2000)
    expect(client.getState()).toMatchObject({ job: { id: 'job-one' }, action: 'resume', busy: false })
    client.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(answer).not.toHaveBeenCalled()
  })

  it('bounds continuous polling and leaves a manual GET resume action', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response({ job: job('RUNNING') })))
    client.submit(question)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(client.getState()).toMatchObject({ busy: false, action: 'resume', canSubmit: false })
    const calls = fetchMock.mock.calls.length
    expect(calls).toBeLessThanOrEqual(30)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(fetchMock).toHaveBeenCalledTimes(calls)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out a hung HTTP request without leaving an endless spinner', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    client.submit(question)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(client.getState()).toMatchObject({ busy: false, action: 'recover' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts pending requests on disposal and ignores late responses without cancelling the server job', async () => {
    let resolveRequest: ((response: Response) => void) | undefined
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { resolveRequest = resolve }))
    client.submit(question)
    client.dispose()
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    resolveRequest?.(response({ job: job('SUCCEEDED') }))
    await vi.advanceTimersByTimeAsync(0)
    expect(answer).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('validates questions and freezes the bounded Wikipedia article context before enqueueing', async () => {
    expect(client.submit({ ...question, question: 'x'.repeat(501) })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(response({ job: job('CANCELLED', { kind: 'WIKI_CHAT' }) }, 202))
    client.submit({ kind: 'WIKI_CHAT', question: 'Pytanie', articleTitle: 'Tytuł', articleCategory: 'Dział', articleContent: 'x'.repeat(4000) })
    await vi.advanceTimersByTimeAsync(0)
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body) as { articleContent: string; articleTitle: string; articleCategory: string }
    expect(payload).toMatchObject({ articleTitle: 'Tytuł', articleCategory: 'Dział' })
    expect(payload.articleContent).toHaveLength(3000)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/knowledge/ai')
    expect(client.getState()).toMatchObject({ busy: false, action: null })
  })
})
