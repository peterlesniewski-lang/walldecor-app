import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  projection: vi.fn(),
  autosave: vi.fn(),
  submit: vi.fn(),
  correction: vi.fn(),
  NotFound: class InstallationClientLinkNotFoundError extends Error {},
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
    const correctionResponse = await correction(new NextRequest('http://test/api/public/installations/token/correction', { method: 'POST' }), params)

    expect(autosaveResponse.status).toBe(200)
    expect(submitResponse.status).toBe(200)
    expect(correctionResponse.status).toBe(201)
    expect(mocks.autosave).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(43), expect.objectContaining({ revisionNumber: 1 }))
  })

  it.each([
    ['autosave', () => mocks.autosave.mockRejectedValueOnce(new mocks.NotFound()), () => PATCH(new NextRequest('http://test/api/public/installations/token/autosave', { method: 'PATCH', body: JSON.stringify({ revisionNumber: 1, draftVersion: 0, clientMutationId: 'client-mutation-0001', answers: [] }), headers: { 'Content-Type': 'application/json' } }), params)],
    ['submit', () => mocks.submit.mockRejectedValueOnce(new mocks.NotFound()), () => submit(new NextRequest('http://test/api/public/installations/token/submit', { method: 'POST', body: JSON.stringify({ revisionNumber: 1, draftVersion: 0, clientMutationId: 'submit-mutation-0001' }), headers: { 'Content-Type': 'application/json' } }), params)],
    ['correction', () => mocks.correction.mockRejectedValueOnce(new mocks.NotFound()), () => correction(new NextRequest('http://test/api/public/installations/token/correction', { method: 'POST' }), params)],
  ])('returns the identical no-store 404 for unavailable %s mutations', async (_name, reject, call) => {
    reject()
    const response = await call()

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe(JSON.stringify({ error: 'Nie znaleziono strony.' }))
  })
})
