import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    mocks.accept.mockReset().mockResolvedValue({ acceptedAt: new Date('2026-08-23T12:00:00.000Z') })
    mocks.projection.mockReset().mockResolvedValue({ brand: 'WallDecor', number: 'MON-1', visitFee: { grossAmount: '249.90', clauseVersion: 3, clientAcceptedAt: '2026-08-23T12:00:00.000Z' } })
  })

  it('forwards the exact shown snapshot with trusted route metadata and returns a refreshed safe projection', async () => {
    const response = await POST(new NextRequest('http://test/api/public/installations/token/accept-visit-fee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.55, 10.0.0.1', 'User-Agent': 'WallDecor acceptance test' },
      body: JSON.stringify({ grossAmount: '249.90', clauseVersion: 3 }),
    }), params)

    expect(response.status).toBe(200)
    expect(mocks.accept).toHaveBeenCalledWith({}, 'a'.repeat(43), {
      grossAmount: '249.90', clauseVersion: 3,
      clientIp: '203.0.113.55', clientUserAgent: 'WallDecor acceptance test',
    })
    expect(mocks.projection).toHaveBeenCalledWith({}, 'a'.repeat(43))
    expect(await response.json()).toMatchObject({ visitFee: { clientAcceptedAt: expect.any(String) } })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns no-store 409 when the fee snapshot changed after the client saw it', async () => {
    mocks.accept.mockRejectedValueOnce(new mocks.Conflict())
    const response = await POST(new NextRequest('http://test/api/public/installations/token/accept-visit-fee', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grossAmount: '249.90', clauseVersion: 3 }),
    }), params)

    expect(response.status).toBe(409)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
