// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInvoiceImportClient } from '@/lib/invoice-import/client'

const bytes = Uint8Array.of(1, 2, 3, 4)
const expected = { byteSize: 4, mimeType: 'image/png' as const, sha256: createHash('sha256').update(bytes).digest('hex') }
const headers = { 'content-type': 'image/png', 'content-length': '4' }
afterEach(() => vi.useRealTimers())

describe('invoice browser transport failures', () => {
  it('fetches EUR quotes with cancellation and validates requested date and provenance', async () => {
    const quote = { currency: 'EUR', paymentDate: '2026-09-14', rate: '4.3228', rateDate: '2026-09-11', tableNumber: '177/A/NBP/2026' }
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ quote }))
    const client = createInvoiceImportClient(fetcher)
    const controller = new AbortController()
    expect(await client.eurRate('2026-09-14', controller.signal)).toEqual(quote)
    expect(fetcher).toHaveBeenCalledWith('/api/finance/invoice-import/exchange-rate?paymentDate=2026-09-14', expect.objectContaining({ signal: controller.signal, cache: 'no-store', credentials: 'same-origin' }))
    for (const patch of [{ paymentDate: '2026-09-15' }, { currency: 'USD' }, { rate: '0' }, { rateDate: '2026-09-14' }, { tableNumber: null }]) {
      fetcher.mockResolvedValueOnce(Response.json({ quote: { ...quote, ...patch } }))
      await expect(client.eurRate('2026-09-14')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    }
  })
  it.each<Record<string, string>>([
    { 'content-type': 'image/png' },
    { ...headers, 'content-encoding': 'identity' },
    { ...headers, 'content-encoding': 'gzip', 'content-length': '24' },
    { ...headers, 'content-encoding': 'br', 'content-length': '8' },
    { ...headers, 'content-encoding': 'zstd', 'content-length': '13' },
    { ...headers, 'content-encoding': ' GZip ', 'content-length': '24' },
  ])('verifies decoded original bytes independently of transfer length (%#)', async (responseHeaders) => {
    // Fetch exposes decoded bytes while retaining the encoded transport headers.
    const client = createInvoiceImportClient(async () => new Response(bytes, { headers: responseHeaders }))
    const original = await client.original('draft', expected)
    expect(original.type).toBe(expected.mimeType)
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(bytes)
  })

  it('rejects malformed KSeF detail and resolution identities instead of claiming success', async () => {
    const input = { reconciliationId: 'link', expectedDraftVersion: 2, expectedLinkVersion: 1, action: 'KEEP_LOCAL' as const, idempotencyKey: 'same-key' }
    const result = { draftId: 'draft', version: 3, reconciliationId: 'link', reconciliationVersion: 2, outcome: 'KEPT_LOCAL' }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ reconciliation: { draftId: 'other', draftVersion: 2, draftState: 'OPEN', links: [] } }))
      .mockResolvedValueOnce(Response.json({ reconciliation: { draftId: 'draft', draftVersion: 2, draftState: 'OPEN', links: [{ id: 'partial' }] } }))
    const client = createInvoiceImportClient(fetcher)
    await expect(client.ksef('draft')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(client.ksef('draft')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    for (const invalid of [{ draftId: 'other' }, { reconciliationId: 'other' }, { version: 99 }, { reconciliationVersion: 99 }, { outcome: 'APPLIED_TO_DRAFT' }]) {
      fetcher.mockResolvedValueOnce(Response.json({ result: { ...result, ...invalid } }))
      await expect(client.resolveKsef('draft', input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    }
    fetcher.mockResolvedValueOnce(Response.json({ result: { ...result, xmlContent: 'not-exposed' } }))
    expect(await client.resolveKsef('draft', input)).toEqual(result)
  })

  it.each([
    { body: bytes.slice(0, 3), headers },
    { body: Uint8Array.of(1, 2, 3, 4, 5), headers },
    { body: bytes, headers: { ...headers, 'content-type': 'text/html' } },
    { body: bytes, headers: { ...headers, 'content-length': '5' } },
    { body: bytes, headers: { ...headers, 'content-encoding': 'identity', 'content-length': '5' } },
    { body: bytes, headers: { ...headers, 'content-encoding': ' IDENTITY ', 'content-length': '5' } },
    { body: Uint8Array.of(5, 6, 7, 8), headers },
  ])('never returns unverified original bytes (%#)', async (response) => {
    const client = createInvoiceImportClient(vi.fn(async () => new Response(response.body, { headers: response.headers })))
    await expect(client.original('draft', expected)).rejects.toMatchObject({ code: 'INVALID_ORIGINAL' })
  })

  it('rejects the file cap before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(createInvoiceImportClient(fetcher).original('draft', { ...expected, byteSize: 10 * 1024 * 1024 + 1 }))
      .rejects.toMatchObject({ code: 'INVALID_ORIGINAL' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['abort', 'timeout'] as const)('cancels a stalled original stream on %s', async (kind) => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes.slice(0, 2)) }, cancel,
    }), { headers }))
    const controller = new AbortController()
    const promise = createInvoiceImportClient(fetcher).original('draft', expected, controller.signal)
    const rejection = expect(promise).rejects.toMatchObject({ code: kind === 'abort' ? 'ABORTED' : 'INVALID_ORIGINAL' })
    await Promise.resolve()
    await Promise.resolve()
    if (kind === 'abort') controller.abort()
    else await vi.advanceTimersByTimeAsync(30_000)
    await rejection
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not claim mutation success when the response is lost and preserves the caller retry key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('private backend detail'))
      .mockResolvedValueOnce(Response.json({ result: { outcome: 'APPROVED', draftId: 'draft', version: 2, invoiceId: 'invoice', costEventId: 'cost' } }))
    const client = createInvoiceImportClient(fetcher)
    await expect(client.approve('draft', 1, 'fixed-key')).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: 'Nie udało się potwierdzić odpowiedzi serwera. Sprawdź stan przed ponowieniem.' })
    expect(await client.approve('draft', 1, 'fixed-key')).toMatchObject({ outcome: 'APPROVED' })
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).idempotencyKey)).toEqual(['fixed-key', 'fixed-key'])
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('/api/finance/invoice-import/drafts/draft/approve')
      expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', method: 'POST' })
    }
  })

  it('rejects malformed mutation results and strips unrelated response fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ result: { outcome: 'APPROVED', version: 2 } }))
      .mockResolvedValueOnce(Response.json({ result: { outcome: 'REVOKED', draftId: 'draft', version: 3, invoiceId: 'invoice', costEventId: 'cost', storageKey: 'not-exposed' } }))
    const client = createInvoiceImportClient(fetcher)
    await expect(client.approve('draft', 1, 'fixed-key')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(await client.revoke('draft', 2, 'revoke-key')).toEqual({ outcome: 'REVOKED', draftId: 'draft', version: 3, invoiceId: 'invoice', costEventId: 'cost' })
    expect(fetcher.mock.calls[1][1]?.method).toBe('DELETE')
  })

  it('keeps the exact closed-period identities for an explicit confirmation dialog', async () => {
    const periods = [{ id: 'closure-1', year: 2026, month: 8, closedAt: '2026-09-01T12:00:00.000Z' }]
    const client = createInvoiceImportClient(vi.fn(async () => Response.json({
      code: 'CLOSED_PERIOD_CONFIRMATION_REQUIRED', error: 'Miesiąc wymaga potwierdzenia.', periods,
    }, { status: 409 })))
    await expect(client.approve('draft', 1, 'fixed-key')).rejects.toMatchObject({ status: 409, code: 'CLOSED_PERIOD_CONFIRMATION_REQUIRED', periods })
  })
})
