import { describe, expect, it } from 'vitest'
import { SubiektBridgeError, fetchSalesSummary, readSubiektBridgeConfig, type FetchLike } from '@/lib/finance/subiekt-bridge-client'

const config = { url: 'https://serwer.example.ts.net', token: 'secret-token', access: null }
const query = { from: '2026-10-01', to: '2026-10-31' }
const validBody = {
  from: '2026-10-01', to: '2026-10-31', group_by: 'month_warehouse_kind', doc_types: ['FS', 'KFS', 'PA', 'ZW'], date_basis: 'dok_DataWyst',
  rows: [{ year: 2026, month: 10, warehouse_symbol: 'PUŁ', warehouse_name: 'Puławska', kind: 'TOWAR', documents: 12, net_total: 100, gross_total: 123 }],
  total: { documents: 12, net_total: 100, gross_total: 123 }, excluded: { fs_subtype_1_documents: 0, zw_documents_subtracted: 0 }, summary: 'ok',
}

const respond = (status: number, body: unknown): FetchLike => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function kindOf(promise: Promise<unknown>) {
  try { await promise } catch (error) { return error instanceof SubiektBridgeError ? error.kind : 'other' }
  return 'none'
}

describe('readSubiektBridgeConfig', () => {
  it('should be null when the URL or the token is missing', () => {
    expect(readSubiektBridgeConfig({ SUBIEKT_BRIDGE_URL: 'https://x' })).toBeNull()
    expect(readSubiektBridgeConfig({ SUBIEKT_BRIDGE_TOKEN: 't' })).toBeNull()
  })

  it('should strip a trailing slash and reject non-http schemes', () => {
    expect(readSubiektBridgeConfig({ SUBIEKT_BRIDGE_URL: 'https://x/', SUBIEKT_BRIDGE_TOKEN: 't' })).toEqual({ url: 'https://x', token: 't', access: null })
    expect(readSubiektBridgeConfig({ SUBIEKT_BRIDGE_URL: 'ftp://x', SUBIEKT_BRIDGE_TOKEN: 't' })).toBeNull()
  })
})

describe('readSubiektBridgeConfig — Cloudflare Access', () => {
  const base = { SUBIEKT_BRIDGE_URL: 'https://bridge.example', SUBIEKT_BRIDGE_TOKEN: 't' }

  it('should carry a complete service-token pair', () => {
    expect(readSubiektBridgeConfig({ ...base, SUBIEKT_BRIDGE_CF_ACCESS_CLIENT_ID: ' id.access ', SUBIEKT_BRIDGE_CF_ACCESS_CLIENT_SECRET: 'sec' }))
      .toEqual({ url: 'https://bridge.example', token: 't', access: { clientId: 'id.access', clientSecret: 'sec' } })
  })

  it('should treat a half-set pair as not configured', () => {
    expect(readSubiektBridgeConfig({ ...base, SUBIEKT_BRIDGE_CF_ACCESS_CLIENT_ID: 'id' })).toBeNull()
    expect(readSubiektBridgeConfig({ ...base, SUBIEKT_BRIDGE_CF_ACCESS_CLIENT_SECRET: 'sec' })).toBeNull()
  })

  it('should send both Access headers next to the bearer token, and none without the pair', async () => {
    let seen: { init: RequestInit } | null = null
    const fetchImpl: FetchLike = async (input, init) => { seen = { init }; return respond(200, { from: '2026-01-01', to: '2026-01-31', group_by: 'month_warehouse_kind', rows: [] })(input, init) }
    await fetchSalesSummary({ url: 'https://bridge.example', token: 't', access: { clientId: 'id', clientSecret: 'sec' } }, { from: '2026-01-01', to: '2026-01-31' }, fetchImpl)
    const headers = seen!.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer t')
    expect(headers['CF-Access-Client-Id']).toBe('id')
    expect(headers['CF-Access-Client-Secret']).toBe('sec')
    await fetchSalesSummary({ url: 'https://bridge.example', token: 't', access: null }, { from: '2026-01-01', to: '2026-01-31' }, fetchImpl)
    expect(seen!.init.headers).not.toHaveProperty('CF-Access-Client-Id')
  })
})

describe('fetchSalesSummary', () => {
  it('distinguishes Access rejection from a bridge scope error without exposing upstream text', async () => {
    const accessConfig = { ...config, access: { clientId: 'synthetic-id', clientSecret: 'synthetic-secret' } }
    const html: FetchLike = async () => new Response('<html>Cloudflare Access denied</html>', { status: 403 })
    await expect(fetchSalesSummary(accessConfig, query, html)).rejects.toMatchObject({ kind: 'unauthorized', message: expect.stringContaining('Cloudflare Access') })
    await expect(fetchSalesSummary(accessConfig, query, respond(403, { error: { code: 'FORBIDDEN_SCOPE', message: 'synthetic-secret' } })))
      .rejects.toMatchObject({ kind: 'unauthorized', code: 'FORBIDDEN_SCOPE', message: expect.stringContaining('sales:read') })
  })

  it.each([500, 502, 503, 520, 522, 524, 530])('reports upstream HTTP %i as unavailable', async (status) => {
    await expect(fetchSalesSummary(config, query, respond(status, { error: { code: 'INTERNAL', message: 'secret-token SQL password' } })))
      .rejects.toMatchObject({ kind: 'unavailable', message: expect.not.stringContaining('secret-token') })
  })

  it.each([400, 429, 503, 504])('does not expose arbitrary upstream messages or codes for HTTP %i', async (status) => {
    try {
      await fetchSalesSummary(config, query, respond(status, { error: { code: 'secret-token', message: 'SQL password https://private.example' } }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SubiektBridgeError)
      expect((error as SubiektBridgeError).code).toBeNull()
      expect((error as Error).message).not.toMatch(/secret-token|SQL password|private.example/)
    }
  })

  it.each([null, '', '   ', true, false])('rejects a missing or nonnumeric financial value: %j', async (value) => {
    for (const field of ['net_total', 'gross_total', 'documents']) {
      const body = { ...validBody, rows: [{ ...validBody.rows[0], [field]: value }] }
      expect(await kindOf(fetchSalesSummary(config, query, respond(200, body)))).toBe('invalid_response')
    }
  })

  it('accepts numeric decimal strings and zero while preserving negative corrections', async () => {
    const body = { ...validBody, total: { documents: '0', net_total: '-100.00', gross_total: '0.00' }, rows: [{ ...validBody.rows[0], documents: '0', net_total: '-100.00', gross_total: '0.00' }] }
    const result = await fetchSalesSummary(config, query, respond(200, body))
    expect(result.rows[0]).toMatchObject({ documents: 0, net_total: -100, gross_total: 0 })
  })

  it.each(['net_total', 'gross_total'] as const)('rejects a %s breakdown inconsistent with document totals', async (field) => {
    const body = { ...validBody, total: { ...validBody.total, [field]: validBody.total[field] + 10 } }
    await expect(fetchSalesSummary(config, query, respond(200, body))).rejects.toMatchObject({ kind: 'invalid_response', code: 'AMOUNT_MISMATCH' })
  })

  it('allows a one-cent rounding difference', async () => {
    const body = { ...validBody, total: { ...validBody.total, gross_total: 123.01 } }
    expect((await fetchSalesSummary(config, query, respond(200, body))).rows).toHaveLength(1)
  })

  it('should send the bearer token and the month_warehouse_kind grouping', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetchImpl: FetchLike = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(validBody), { status: 200 }) }
    const result = await fetchSalesSummary(config, query, fetchImpl)
    expect(result.rows[0].gross_total).toBe(123)
    expect(seen!.url).toBe('https://serwer.example.ts.net/api/sales/summary?from=2026-10-01&to=2026-10-31&group_by=month_warehouse_kind')
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token')
  })

  it('should map not configured, 401, 403, 503 and 504 to domain kinds', async () => {
    expect(await kindOf(fetchSalesSummary(null, query, respond(200, validBody)))).toBe('not_configured')
    expect(await kindOf(fetchSalesSummary(config, query, respond(401, { error: { code: 'UNAUTHORIZED', message: 'x' } })))).toBe('unauthorized')
    expect(await kindOf(fetchSalesSummary(config, query, respond(403, { error: { code: 'FORBIDDEN_SCOPE', message: 'x' } })))).toBe('unauthorized')
    expect(await kindOf(fetchSalesSummary(config, query, respond(503, { error: { code: 'DB_UNAVAILABLE', message: 'x' } })))).toBe('unavailable')
    expect(await kindOf(fetchSalesSummary(config, query, respond(504, { error: { code: 'QUERY_TIMEOUT', message: 'x' } })))).toBe('timeout')
  })

  it('should map an aborted request to timeout and a network failure to unavailable', async () => {
    const abort: FetchLike = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }
    const network: FetchLike = async () => { throw new TypeError('fetch failed') }
    expect(await kindOf(fetchSalesSummary(config, query, abort))).toBe('timeout')
    expect(await kindOf(fetchSalesSummary(config, query, network))).toBe('unavailable')
  })

  it('should map malformed JSON and a wrong shape to invalid_response', async () => {
    const broken: FetchLike = async () => new Response('<html>', { status: 200 })
    expect(await kindOf(fetchSalesSummary(config, query, broken))).toBe('invalid_response')
    expect(await kindOf(fetchSalesSummary(config, query, respond(200, { rows: [{ year: 'x' }] })))).toBe('invalid_response')
  })

  it('should carry the bridge error code of a 400 without leaking the token', async () => {
    try {
      await fetchSalesSummary(config, query, respond(400, { error: { code: 'RANGE_TOO_WIDE', message: 'Zakres przekracza 24 miesiące.' } }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SubiektBridgeError)
      expect((error as SubiektBridgeError).code).toBe('RANGE_TOO_WIDE')
      expect((error as SubiektBridgeError).message).toContain('24 miesiące')
      expect((error as SubiektBridgeError).message).not.toContain('secret-token')
    }
  })
})
