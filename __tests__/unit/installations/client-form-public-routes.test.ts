import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  projection: vi.fn(),
  autosave: vi.fn(),
  submit: vi.fn(),
  correction: vi.fn(),
  NotFound: class InstallationClientLinkNotFoundError extends Error {},
  FeeConflict: class InstallationVisitFeeAcceptanceConflictError extends Error {},
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/client-link', () => ({
  loadPublicInstallationProjection: mocks.projection,
  InstallationClientLinkNotFoundError: mocks.NotFound,
  publicClientLinkNotFound: () => new Response(JSON.stringify({ error: 'Nie znaleziono strony.' }), { status: 404, headers: { 'Cache-Control': 'no-store' } }),
}))
vi.mock('@/lib/installations/form-service', () => ({
  autosaveClientForm: mocks.autosave,
  submitClientForm: mocks.submit,
  startClientFormCorrection: mocks.correction,
  InstallationFormValidationError: class InstallationFormValidationError extends Error { fieldErrors = { form: 'bad' } },
  InstallationFormConflictError: class InstallationFormConflictError extends Error {},
  InstallationVisitFeeAcceptanceConflictError: mocks.FeeConflict,
}))

import { GET } from '@/app/api/public/installations/[token]/route'
import { PATCH } from '@/app/api/public/installations/[token]/autosave/route'
import { POST as submit } from '@/app/api/public/installations/[token]/submit/route'
import { POST as correction } from '@/app/api/public/installations/[token]/correction/route'

const params = { params: Promise.resolve({ token: 'a'.repeat(43) }) }

describe('public installation form routes', () => {
  beforeEach(() => {
    mocks.projection.mockReset().mockResolvedValue({ brand: 'WallDecor', number: 'MON-1', contact: { label: 'WallDecor', email: 'info@walldecor.pl' }, submission: { revisionNumber: 1 } })
    mocks.autosave.mockReset().mockResolvedValue({ status: 'DRAFT', revisionNumber: 1, draftVersion: 1 })
    mocks.submit.mockReset().mockResolvedValue({ status: 'SUBMITTED', revisionNumber: 1 })
    mocks.correction.mockReset().mockResolvedValue({ status: 'DRAFT', revisionNumber: 2 })
  })

  it('serves the safe projection anonymously and never puts the token in its response', async () => {
    const response = await GET(new NextRequest(`http://test/api/public/installations/${'a'.repeat(43)}`), params)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('WallDecor')
    expect(body).not.toContain('a'.repeat(43))
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each([null, [], 'wrong', { revisionNumber: 1 }, { revisionNumber: 1, draftVersion: 0, clientMutationId: 'client-mutation-0001', answers: [], extra: true }])('returns Polish 400 for a non-strict autosave body: %j', async (body) => {
    const response = await PATCH(new NextRequest('http://test/api/public/installations/token/autosave', {
      method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    }), params)

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.autosave).not.toHaveBeenCalled()
  })

  it('forwards a valid autosave, submit and correction without authentication', async () => {
    const autosaveResponse = await PATCH(new NextRequest('http://test/api/public/installations/token/autosave', {
      method: 'PATCH', body: JSON.stringify({ revisionNumber: 1, draftVersion: 0, clientMutationId: 'client-mutation-0001', answers: [{ questionKey: 'glify', value: 'UNKNOWN' }] }), headers: { 'Content-Type': 'application/json' },
    }), params)
    const submitResponse = await submit(new NextRequest('http://test/api/public/installations/token/submit', {
      method: 'POST', body: JSON.stringify({ revisionNumber: 1, draftVersion: 1, clientMutationId: 'submit-mutation-0001' }), headers: { 'Content-Type': 'application/json' },
    }), params)
    const correctionResponse = await correction(new NextRequest('http://test/api/public/installations/token/correction', {
      method: 'POST', body: JSON.stringify({ clientMutationId: 'correction-mutation-0001' }), headers: { 'Content-Type': 'application/json' },
    }), params)

    expect(autosaveResponse.status).toBe(200)
    expect(submitResponse.status).toBe(200)
    expect(correctionResponse.status).toBe(201)
    expect(mocks.autosave).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(43), expect.objectContaining({ revisionNumber: 1 }))
  })

  it('forwards the exact initial-submit fee digest while ignoring spoofed XFF by default', async () => {
    vi.stubEnv('INSTALLATION_TRUSTED_CLIENT_IP_HEADER', '')
    const response = await submit(new NextRequest('http://test/api/public/installations/token/submit', {
      method: 'POST',
      body: JSON.stringify({
        revisionNumber: 1,
        draftVersion: 0,
        clientMutationId: 'submit-fee-snapshot-0001',
        visitFeeAccepted: true,
        visitFeeSnapshotDigest: `sha256:${'d'.repeat(64)}`,
      }),
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.99' },
    }), params)

    expect(response.status).toBe(200)
    expect(mocks.submit).toHaveBeenCalledWith({}, 'a'.repeat(43), expect.objectContaining({
      visitFeeAccepted: true,
      visitFeeSnapshotDigest: `sha256:${'d'.repeat(64)}`,
      clientIp: null,
    }))
    vi.unstubAllEnvs()
  })

  it('returns a dedicated 409 when the initial-submit fee snapshot changed', async () => {
    mocks.submit.mockRejectedValueOnce(new mocks.FeeConflict())
    const response = await submit(new NextRequest('http://test/api/public/installations/token/submit', {
      method: 'POST', body: JSON.stringify({
        revisionNumber: 1,
        draftVersion: 0,
        clientMutationId: 'submit-fee-conflict-0001',
        visitFeeAccepted: true,
        visitFeeSnapshotDigest: `sha256:${'e'.repeat(64)}`,
      }), headers: { 'Content-Type': 'application/json' },
    }), params)

    expect(response.status).toBe(409)
  })

  it.each([
    { revisionNumber: 1, draftVersion: 0, clientMutationId: 'submit-fee-partial-0001', visitFeeAccepted: true },
    { revisionNumber: 1, draftVersion: 0, clientMutationId: 'submit-fee-partial-0002', visitFeeSnapshotDigest: `sha256:${'f'.repeat(64)}` },
  ])('rejects a partial initial-submit fee confirmation: %j', async (body) => {
    const response = await submit(new NextRequest('http://test/api/public/installations/token/submit', {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    }), params)
    expect(response.status).toBe(400)
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('accepts correction only with a strict stable client mutation id', async () => {
    const response = await correction(new NextRequest('http://test/api/public/installations/token/correction', {
      method: 'POST', body: JSON.stringify({ clientMutationId: 'too-short', extra: true }), headers: { 'Content-Type': 'application/json' },
    }), params)

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.correction).not.toHaveBeenCalled()
  })

  it.each([
    ['autosave', () => mocks.autosave.mockRejectedValueOnce(new mocks.NotFound()), () => PATCH(new NextRequest('http://test/api/public/installations/token/autosave', { method: 'PATCH', body: JSON.stringify({ revisionNumber: 1, draftVersion: 0, clientMutationId: 'client-mutation-0001', answers: [] }), headers: { 'Content-Type': 'application/json' } }), params)],
    ['submit', () => mocks.submit.mockRejectedValueOnce(new mocks.NotFound()), () => submit(new NextRequest('http://test/api/public/installations/token/submit', { method: 'POST', body: JSON.stringify({ revisionNumber: 1, draftVersion: 0, clientMutationId: 'submit-mutation-0001' }), headers: { 'Content-Type': 'application/json' } }), params)],
    ['correction', () => mocks.correction.mockRejectedValueOnce(new mocks.NotFound()), () => correction(new NextRequest('http://test/api/public/installations/token/correction', { method: 'POST', body: JSON.stringify({ clientMutationId: 'correction-mutation-0001' }), headers: { 'Content-Type': 'application/json' } }), params)],
  ])('returns the identical no-store 404 for unavailable %s mutations', async (_name, reject, call) => {
    reject()
    const response = await call()

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe(JSON.stringify({ error: 'Nie znaleziono strony.' }))
  })
})
