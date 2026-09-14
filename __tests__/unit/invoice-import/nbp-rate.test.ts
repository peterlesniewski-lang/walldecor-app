// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getNbpEurRate } from '@/lib/invoice-import/nbp-rate'

const clock = () => new Date('2026-09-14T12:00:00Z')
const payload = { table: 'A', currency: 'euro', code: 'EUR', rates: [
  { no: '176/A/NBP/2026', effectiveDate: '2026-09-10', mid: 4.25 },
  { no: '177/A/NBP/2026', effectiveDate: '2026-09-11', mid: 4.3228 },
] }
const provider = (body: unknown) => vi.fn<typeof fetch>(async () => Response.json(body))
afterEach(() => vi.useRealTimers())
describe('NBP historical EUR quote', () => {
  it('uses latest earlier table across weekend with fixed bounded URL', async () => {
    const fetcher = provider(payload)
    expect(await getNbpEurRate('2026-09-14', { fetch: fetcher, clock })).toEqual({ currency: 'EUR', paymentDate: '2026-09-14', rate: '4.3228', rateDate: '2026-09-11', tableNumber: '177/A/NBP/2026' })
    expect(fetcher).toHaveBeenCalledWith('https://api.nbp.pl/api/exchangerates/rates/a/eur/2026-08-13/2026-09-13/?format=json', expect.objectContaining({ redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal) }))
  })
  it.each(['2026-02-30', '2026-09-15', '2001-12-31', '2026-9-14', '../x'])('rejects invalid date %s before fetching', async (date) => {
    const fetcher = provider(payload)
    await expect(getNbpEurRate(date, { fetch: fetcher, clock })).rejects.toMatchObject({ code: 'NBP_INVALID_DATE', status: 422 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([{ ...payload, code: 'USD' }, { ...payload, rates: [] }, { ...payload, rates: [...payload.rates, { no: '178/A/NBP/2026', effectiveDate: '2026-09-14', mid: 4.3 }] }, { ...payload, rates: [payload.rates[0], { ...payload.rates[0], mid: 5 }] }, { ...payload, rates: [{ ...payload.rates[0], no: '176/A/NBP/2025' }] }])('rejects contradictory response', async (body) => {
    await expect(getNbpEurRate('2026-09-14', { fetch: provider(body), clock })).rejects.toMatchObject({ code: 'NBP_INVALID_RESPONSE', status: 502 })
  })
  it('bounds body streaming and sanitizes network failure', async () => {
    await expect(getNbpEurRate('2026-09-14', { clock, fetch: vi.fn(async () => new Response('x'.repeat(65000))) })).rejects.toMatchObject({ code: 'NBP_INVALID_RESPONSE' })
    await expect(getNbpEurRate('2026-09-14', { clock, fetch: vi.fn(async () => { throw new Error('secret url') }) })).rejects.toMatchObject({ code: 'NBP_UNAVAILABLE', message: 'NBP_UNAVAILABLE' })
  })
  it('times out stalled fetch and stalled body within eight seconds', async () => {
    vi.useFakeTimers()
    for (const fetcher of [vi.fn<typeof fetch>(() => new Promise(() => {})), vi.fn<typeof fetch>(async () => new Response(new ReadableStream()))]) {
      const pending = getNbpEurRate('2026-09-14', { fetch: fetcher, clock })
      const assertion = expect(pending).rejects.toMatchObject({ code: 'NBP_UNAVAILABLE', status: 503 })
      await vi.advanceTimersByTimeAsync(8000)
      await assertion
    }
  })
})
