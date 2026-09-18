// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiWorkerTransport, AiWorkerTransportError } from '@/lib/ai/worker-client'
import { aiJobResultJsonSchema } from '@/lib/ai/contracts'

const url = 'http://app:3000/api/internal/ai-worker'
const secret = 'test-worker-secret-only-12345678901234567890'
const lease = { workerId: 'worker-one', jobId: 'job-one', leaseToken: 'c80d6c22-af27-43a3-bef1-1fc0ed7fa7de' }
const claim = { id: lease.jobId, kind: 'FINANCE_CHAT', leaseToken: lease.leaseToken, leaseUntil: '2026-09-10T12:01:00.000Z', prompt: 'Prepared context', schema: aiJobResultJsonSchema('FINANCE_CHAT') }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { vi.useFakeTimers(); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('private AI worker transport', () => {
  it('posts a narrow authenticated claim without redirects or browser credentials', async () => {
    fetchMock.mockResolvedValueOnce(response({ job: claim }))
    const transport = createAiWorkerTransport({ url, secret })
    expect(await transport.claim(lease.workerId)).toEqual(claim)
    const [target, init] = fetchMock.mock.calls[0]
    expect(target).toBe(url)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', body: JSON.stringify({ action: 'claim', workerId: lease.workerId }) })
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['https://app/api/internal/ai-worker?query=1', 'https://app/api/internal/ai-worker?', 'https://app/api/internal/ai-worker#hash', 'https://app/api/internal/ai-worker#', 'https://name:password@app/api/internal/ai-worker',
    'https://app/api/internal/ai-worker/extra', 'https://app/api/ai/chat', 'file:///api/internal/ai-worker', 'not a URL'])('rejects unsafe endpoint configuration: %s', (endpoint) => {
    expect(() => createAiWorkerTransport({ url: endpoint, secret })).toThrow('INVALID_CONFIG')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects missing/short or header-injecting credentials without exposing them', () => {
    for (const value of ['', 'short', `${secret}\r\nX-Leak: secret`]) {
      expect(() => createAiWorkerTransport({ url, secret: value })).toThrow('INVALID_CONFIG')
    }
  })

  it('validates null claims, private document handles, heartbeat and finish responses', async () => {
    fetchMock.mockResolvedValueOnce(response({ job: null }))
      .mockResolvedValueOnce(response({ job: { ...claim, kind: 'INVOICE_EXTRACT', schema: aiJobResultJsonSchema('INVOICE_EXTRACT'), document: { attachmentId: 'attachment-one' } } }))
      .mockResolvedValueOnce(response({ leaseUntil: claim.leaseUntil }))
      .mockResolvedValueOnce(response({ ok: true }))
    const transport = createAiWorkerTransport({ url, secret })
    expect(await transport.claim('worker-one')).toBeNull()
    expect(await transport.claim('worker-one')).toMatchObject({ kind: 'INVOICE_EXTRACT', document: { attachmentId: 'attachment-one' } })
    expect(await transport.heartbeat(lease)).toEqual({ leaseUntil: claim.leaseUntil })
    expect(await transport.finish(lease, { status: 'SUCCEEDED', result: { answer: 'Done' } })).toBeUndefined()
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: 'heartbeat', ...lease })
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ action: 'finish', ...lease, outcome: { status: 'SUCCEEDED', result: { answer: 'Done' } } })
  })

  it('downloads a strictly bounded and hashed invoice document with the fenced command', async () => {
    const bytes = Buffer.from('bounded synthetic PDF bytes')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    fetchMock.mockResolvedValueOnce(new Response(bytes, { headers: {
      'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length), 'X-Content-Sha256': sha256,
    } }))
    const transport = createAiWorkerTransport({ url, secret })
    const document = await transport.document({ ...lease, attachmentId: 'attachment-one' })
    expect(Buffer.from(document.bytes).equals(bytes)).toBe(true)
    expect(document).toMatchObject({ mimeType: 'application/pdf', byteSize: bytes.length, sha256 })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ action: 'document', ...lease, attachmentId: 'attachment-one' })
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' })
  })

  it.each([
    ['missing length', { 'Content-Type': 'image/png', 'X-Content-Sha256': 'a'.repeat(64) }, Buffer.from('x')],
    ['unsupported MIME', { 'Content-Type': 'text/plain', 'Content-Length': '1', 'X-Content-Sha256': 'a'.repeat(64) }, Buffer.from('x')],
    ['wrong length', { 'Content-Type': 'image/png', 'Content-Length': '2', 'X-Content-Sha256': 'a'.repeat(64) }, Buffer.from('x')],
    ['malformed hash', { 'Content-Type': 'image/png', 'Content-Length': '1', 'X-Content-Sha256': 'secret-path-/tmp/file' }, Buffer.from('x')],
  ] as const)('rejects document response with %s', async (_name, headers, bytes) => {
    fetchMock.mockResolvedValueOnce(new Response(bytes, { headers }))
    await expect(createAiWorkerTransport({ url, secret }).document({ ...lease, attachmentId: 'attachment-one' }))
      .rejects.toThrow('INVALID_RESPONSE')
  })

  it('rejects a streamed document beyond 10 MiB and cancels the reader', async () => {
    const cancel = vi.fn()
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1)) }, cancel,
    }), { headers: {
      'Content-Type': 'image/png', 'Content-Length': String(10 * 1024 * 1024), 'X-Content-Sha256': 'a'.repeat(64),
    } }))
    await expect(createAiWorkerTransport({ url, secret }).document({ ...lease, attachmentId: 'attachment-one' }))
      .rejects.toThrow('INVALID_RESPONSE')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects a document with a valid-looking but incorrect SHA-256', async () => {
    const bytes = Buffer.from('image bytes')
    fetchMock.mockResolvedValueOnce(new Response(bytes, { headers: {
      'Content-Type': 'image/webp', 'Content-Length': String(bytes.length), 'X-Content-Sha256': 'a'.repeat(64),
    } }))
    await expect(createAiWorkerTransport({ url, secret }).document({ ...lease, attachmentId: 'attachment-one' }))
      .rejects.toThrow('INVALID_RESPONSE')
  })

  it('times out and cancels a stalled document stream after thirty seconds', async () => {
    const cancel = vi.fn()
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: {
      'Content-Type': 'image/jpeg', 'Content-Length': '1', 'X-Content-Sha256': 'a'.repeat(64),
    } }))
    const result = createAiWorkerTransport({ url, secret }).document({ ...lease, attachmentId: 'attachment-one' })
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await result).toMatchObject({ code: 'TIMEOUT', message: 'TIMEOUT' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts and cancels an in-flight document stream without exposing transport details', async () => {
    const cancel = vi.fn()
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: {
      'Content-Type': 'image/jpeg', 'Content-Length': '1', 'X-Content-Sha256': 'a'.repeat(64),
    } }))
    const abort = new AbortController()
    const result = createAiWorkerTransport({ url, secret }).document({ ...lease, attachmentId: 'attachment-one' }, abort.signal)
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    abort.abort('private /runtime/documents value')
    const failure = await result
    expect(failure).toMatchObject({ code: 'ABORTED', message: 'ABORTED' })
    expect(JSON.stringify(failure)).not.toContain(secret)
    expect(JSON.stringify(failure)).not.toContain('/runtime/documents')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { job: { ...claim, ownerUserId: 'private-owner' } },
    { job: { ...claim, leaseToken: 'bad-token' } },
    { job: { ...claim, prompt: '' } },
    { job: { ...claim, kind: 'INVOICE_EXTRACT' } },
    { job: { ...claim, document: { attachmentId: 'x', url: 'https://private/file' } } },
    { job: null, rawError: secret },
  ])('rejects malformed or over-broad claim responses', async (body) => {
    fetchMock.mockResolvedValueOnce(response(body))
    await expect(createAiWorkerTransport({ url, secret }).claim('worker-one')).rejects.toThrow('INVALID_RESPONSE')
  })

  it('validates requests before fetching and bounds request bytes', async () => {
    const transport = createAiWorkerTransport({ url, secret })
    await expect(transport.claim('')).rejects.toThrow('INVALID_REQUEST')
    await expect(transport.heartbeat({ ...lease, leaseToken: 'bad' })).rejects.toThrow('INVALID_REQUEST')
    await expect(transport.finish(lease, { status: 'SUCCEEDED', result: { answer: 'ą'.repeat(70_000) } })).rejects.toThrow('INVALID_REQUEST')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds streamed response bytes even without content-length and cancels reading', async () => {
    const cancel = vi.fn()
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)) }, cancel,
    }), { headers: { 'Content-Type': 'application/json' } }))
    await expect(createAiWorkerTransport({ url, secret }).claim('worker-one')).rejects.toThrow('INVALID_RESPONSE')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([[401, 'AUTH'], [409, 'LEASE_LOST'], [500, 'TRANSPORT_ERROR']] as const)('maps HTTP %s to a controlled code only', async (status, code) => {
    fetchMock.mockResolvedValueOnce(response({ code: status === 409 ? 'LEASE_LOST' : 'UNTRUSTED', error: `${secret} ${url}` }, status))
    const failure = await createAiWorkerTransport({ url, secret }).claim('worker-one').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AiWorkerTransportError)
    expect(failure).toMatchObject({ code, message: code })
    expect(JSON.stringify(failure)).not.toContain(secret)
    expect(JSON.stringify(failure)).not.toContain(url)
  })

  it('times out a hung response at ten seconds and clears timer/listener state', async () => {
    fetchMock.mockImplementation((_target: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error(`${secret} ${url}`)), { once: true })
    }))
    const transport = createAiWorkerTransport({ url, secret })
    const result = transport.claim('worker-one').catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await result).toMatchObject({ code: 'TIMEOUT', message: 'TIMEOUT' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('also times out while streaming a response body and cancels the stalled reader', async () => {
    const cancel = vi.fn()
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } }))
    const result = createAiWorkerTransport({ url, secret }).claim('worker-one').catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await result).toMatchObject({ code: 'TIMEOUT' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('strictly validates heartbeat and finish acknowledgements', async () => {
    const transport = createAiWorkerTransport({ url, secret })
    fetchMock.mockResolvedValueOnce(response({ leaseUntil: 'not-a-date' }))
      .mockResolvedValueOnce(response({ ok: true, unexpected: secret }))
    await expect(transport.heartbeat(lease)).rejects.toThrow('INVALID_RESPONSE')
    await expect(transport.finish(lease, { status: 'FAILED', errorCode: 'RUNNER_ERROR' })).rejects.toThrow('INVALID_RESPONSE')
  })

  it('aborts an in-flight request and never starts one for an already aborted signal', async () => {
    fetchMock.mockImplementation((_target: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('private failure')), { once: true })
    }))
    const abort = new AbortController()
    const transport = createAiWorkerTransport({ url, secret })
    const result = transport.claim('worker-one', abort.signal).catch((error: unknown) => error)
    abort.abort()
    expect(await result).toMatchObject({ code: 'ABORTED' })
    await expect(transport.claim('worker-one', abort.signal)).rejects.toThrow('ABORTED')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
