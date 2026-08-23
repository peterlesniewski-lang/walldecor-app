import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  projection: vi.fn(),
  NotFound: class InstallationClientLinkNotFoundError extends Error {},
  Conflict: class InstallationVisitFeeAcceptanceConflictError extends Error {},
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/client-link', () => ({
  loadPublicInstallationProjection: mocks.projection,
  InstallationClientLinkNotFoundError: mocks.NotFound,
  publicClientLinkNotFound: () => new Response(JSON.stringify({ error: 'Nie znaleziono strony.' }), { status: 404, headers: { 'Cache-Control': 'no-store' } }),
}))
vi.mock('@/lib/installations/form-service', () => ({
  acceptClientVisitFee: mocks.accept,
  InstallationFormValidationError: class InstallationFormValidationError extends Error { fieldErrors = { visitFeeAccepted: 'bad' } },
  InstallationVisitFeeAcceptanceConflictError: mocks.Conflict,
}))

import { POST } from '@/app/api/public/installations/[token]/accept-visit-fee/route'

const params = { params: Promise.resolve({ token: 'a'.repeat(43) }) }

describe('public post-submit visit-fee acceptance route', () => {
  beforeEach(() => {
    vi.stubEnv('INSTALLATION_TRUSTED_CLIENT_IP_HEADER', '')
    vi.stubEnv('INSTALLATION_IP_HASH_SECRET', 'route-test-hmac-secret')
    mocks.accept.mockReset().mockResolvedValue({ acceptedAt: new Date('2026-08-23T12:00:00.000Z') })
    mocks.projection.mockReset().mockResolvedValue({ brand: 'WallDecor', number: 'MON-1', visitFee: { grossAmount: '249.90', clauseVersion: 3, clientAcceptedAt: '2026-08-23T12:00:00.000Z' } })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('requires an affirmative acceptance plus digest and ignores spoofable forwarding headers by default', async () => {
    const response = await POST(new NextRequest('http://test/api/public/installations/token/accept-visit-fee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.55, 10.0.0.1', 'User-Agent': 'WallDecor acceptance test' },
      body: JSON.stringify({ accepted: true, snapshotDigest: `sha256:${'a'.repeat(64)}` }),
    }), params)

    expect(response.status).toBe(200)
    expect(mocks.accept).toHaveBeenCalledWith({}, 'a'.repeat(43), {
      accepted: true, snapshotDigest: `sha256:${'a'.repeat(64)}`,
      clientIp: null, clientUserAgent: 'WallDecor acceptance test',
    })
    expect(mocks.projection).toHaveBeenCalledWith({}, 'a'.repeat(43))
    expect(await response.json()).toMatchObject({ visitFee: { clientAcceptedAt: expect.any(String) } })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('accepts one explicitly configured proxy-overwritten client IP header', async () => {
    vi.stubEnv('INSTALLATION_TRUSTED_CLIENT_IP_HEADER', 'X-WallDecor-Client-IP')
    const response = await POST(new NextRequest('http://test/api/public/installations/token/accept-visit-fee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WallDecor-Client-IP': '203.0.113.55' },
      body: JSON.stringify({ accepted: true, snapshotDigest: `sha256:${'b'.repeat(64)}` }),
    }), params)

    expect(response.status).toBe(200)
    expect(mocks.accept).toHaveBeenCalledWith({}, 'a'.repeat(43), expect.objectContaining({ clientIp: '203.0.113.55' }))
  })

  it('rejects a configured header with anything other than one valid IP', async () => {
    vi.stubEnv('INSTALLATION_TRUSTED_CLIENT_IP_HEADER', 'X-WallDecor-Client-IP')
    const response = await POST(new NextRequest('http://test/api/public/installations/token/accept-visit-fee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WallDecor-Client-IP': '203.0.113.55, 10.0.0.1' },
      body: JSON.stringify({ accepted: true, snapshotDigest: `sha256:${'c'.repeat(64)}` }),
    }), params)

    expect(response.status).toBe(400)
    expect(mocks.accept).not.toHaveBeenCalled()
  })

  it.each([
    { snapshotDigest: `sha256:${'a'.repeat(64)}` },
    { accepted: false, snapshotDigest: `sha256:${'a'.repeat(64)}` },
    { accepted: true },
  ])('rejects a non-affirmative or incomplete body: %j', async (body) => {
    const response = await POST(new NextRequest('http://test/api/public/installations/token/accept-visit-fee', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), params)
    expect(response.status).toBe(400)
    expect(mocks.accept).not.toHaveBeenCalled()
  })

  it('returns no-store 409 when the fee snapshot changed after the client saw it', async () => {
    mocks.accept.mockRejectedValueOnce(new mocks.Conflict())
    const response = await POST(new NextRequest('http://test/api/public/installations/token/accept-visit-fee', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accepted: true, snapshotDigest: `sha256:${'a'.repeat(64)}` }),
    }), params)

    expect(response.status).toBe(409)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
