import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; employeeId?: string | null } },
  editable: vi.fn(),
  accessible: vi.fn(),
  createLink: vi.fn(),
  extendLink: vi.fn(),
  markSent: vi.fn(),
  revokeLink: vi.fn(),
  listLinks: vi.fn(),
  listClarifications: vi.fn(),
  resolveClarification: vi.fn(),
  MissingSnapshot: function InstallationClientLinkPrerequisiteError(this: object) {},
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/room-route-access', () => ({ editableInstallationOrder: mocks.editable }))
vi.mock('@/lib/installations/http-access', () => ({
  accessibleInstallationOrder: mocks.accessible,
  installationViewerFromSession: vi.fn(async () => ({ role: 'ADMIN', employeeId: null })),
}))
vi.mock('@/lib/installations/client-link', () => ({
  createClientLink: mocks.createLink,
  extendClientLink: mocks.extendLink,
  markClientLinkSent: mocks.markSent,
  revokeClientLink: mocks.revokeLink,
  listClientLinkStatuses: mocks.listLinks,
  InstallationClientLinkNotFoundError: class InstallationClientLinkNotFoundError extends Error {},
  InstallationClientLinkPrerequisiteError: mocks.MissingSnapshot,
  InstallationClientLinkValidationError: class InstallationClientLinkValidationError extends Error { fieldErrors = { form: 'bad' } },
}))
vi.mock('@/lib/installations/form-service', () => ({
  listInstallationClarifications: mocks.listClarifications,
  resolveInstallationClarification: mocks.resolveClarification,
  InstallationClarificationValidationError: class InstallationClarificationValidationError extends Error { fieldErrors = { form: 'bad' } },
}))

import { POST, PATCH } from '@/app/api/installations/[id]/client-link/route'
import { GET as listClarifications } from '@/app/api/installations/[id]/clarifications/route'
import { PATCH as resolve } from '@/app/api/installations/[id]/clarifications/[clarificationId]/route'

const orderParams = { params: Promise.resolve({ id: 'order-1' }) }
const clarificationParams = { params: Promise.resolve({ id: 'order-1', clarificationId: 'clarification-1' }) }

describe('client-link and clarification internal routes', () => {
  beforeEach(() => {
    mocks.session = null
    mocks.editable.mockReset().mockResolvedValue({ order: { id: 'order-1' } })
    mocks.accessible.mockReset().mockResolvedValue({ order: { id: 'order-1' } })
    const link = { id: 'link-1', expiresAt: new Date('2027-01-01'), revokedAt: null, createdAt: new Date(), lastOpenedAt: null, sentAt: null, sentById: null }
    mocks.createLink.mockReset().mockResolvedValue({ token: 'b'.repeat(43), link })
    mocks.extendLink.mockReset().mockResolvedValue(link)
    mocks.markSent.mockReset().mockResolvedValue({ ...link, sentAt: new Date('2026-08-23T08:00:00.000Z'), sentById: 'owner-user' })
    mocks.revokeLink.mockReset().mockResolvedValue(link)
    mocks.listLinks.mockReset().mockResolvedValue([{ id: 'link-1' }])
    mocks.listClarifications.mockReset().mockResolvedValue([{ id: 'clarification-1', status: 'OPEN' }])
    mocks.resolveClarification.mockReset().mockResolvedValue({ id: 'clarification-1', status: 'RESOLVED' })
  })

  it('requires authentication and active editable access before generating a one-time client URL', async () => {
    const body = JSON.stringify({ expiresAt: '2027-01-01T00:00:00.000Z' })
    expect((await POST(new NextRequest('http://test/api/installations/order-1/client-link', { method: 'POST', body }), orderParams)).status).toBe(401)
    expect(mocks.createLink).not.toHaveBeenCalled()

    mocks.session = { user: { id: 'installer-user', role: 'INSTALLER' } }
    mocks.editable.mockResolvedValue({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) })
    expect((await POST(new NextRequest('http://test/api/installations/order-1/client-link', { method: 'POST', body }), orderParams)).status).toBe(403)
    expect(mocks.createLink).not.toHaveBeenCalled()
  })

  it('returns the plaintext URL only from the generate response and validates the body strictly', async () => {
    mocks.session = { user: { id: 'owner-user', role: 'EMPLOYEE', employeeId: 'owner-employee' } }
    const invalid = await POST(new NextRequest('http://test/api/installations/order-1/client-link', { method: 'POST', body: JSON.stringify({ expiresAt: 'bad', extra: true }) }), orderParams)
    expect(invalid.status).toBe(400)
    expect(mocks.createLink).not.toHaveBeenCalled()

    const response = await POST(new NextRequest('http://test/api/installations/order-1/client-link', { method: 'POST', body: JSON.stringify({ expiresAt: '2027-01-01T00:00:00.000Z' }) }), orderParams)
    const result = await response.json()
    expect(response.status).toBe(201)
    expect(result.url).toBe(`http://test/m/${'b'.repeat(43)}`)
    expect(result.link).not.toHaveProperty('tokenHash')
  })

  it('returns a deliberate Polish conflict instead of a server error when no single form snapshot is pinned', async () => {
    mocks.session = { user: { id: 'owner-user', role: 'EMPLOYEE', employeeId: 'owner-employee' } }
    mocks.createLink.mockRejectedValueOnce(new mocks.MissingSnapshot())

    const response = await POST(new NextRequest('http://test/api/installations/order-1/client-link', {
      method: 'POST', body: JSON.stringify({ expiresAt: '2027-01-01T00:00:00.000Z' }),
    }), orderParams)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/dokładnie jeden formularz/i)
  })

  it('limits revoke/extend and clarification resolution to editors while leaving listing read-only', async () => {
    mocks.session = { user: { id: 'owner-user', role: 'EMPLOYEE', employeeId: 'owner-employee' } }
    const revocation = await PATCH(new NextRequest('http://test/api/installations/order-1/client-link', { method: 'PATCH', body: JSON.stringify({ action: 'REVOKE', linkId: 'link-1' }) }), orderParams)
    expect(revocation.status).toBe(200)
    const invalidWaive = await resolve(new NextRequest('http://test/api/installations/order-1/clarifications/clarification-1', { method: 'PATCH', body: JSON.stringify({ action: 'WAIVE' }) }), clarificationParams)
    expect(invalidWaive.status).toBe(400)
    const resolution = await resolve(new NextRequest('http://test/api/installations/order-1/clarifications/clarification-1', { method: 'PATCH', body: JSON.stringify({ action: 'RESOLVE', resolution: '12 cm', note: 'Telefonicznie potwierdzone' }) }), clarificationParams)
    expect(resolution.status).toBe(200)
    expect(mocks.resolveClarification).toHaveBeenCalledWith(expect.anything(), 'order-1', 'clarification-1', expect.objectContaining({ action: 'RESOLVE' }), 'owner-user')

    const listing = await listClarifications(new NextRequest('http://test/api/installations/order-1/clarifications'), orderParams)
    expect(listing.status).toBe(200)
  })

  it('marks only the requested active link as sent with strict payload and no token disclosure', async () => {
    const body = JSON.stringify({ action: 'MARK_SENT', linkId: 'link-1' })
    expect((await PATCH(new NextRequest('http://test/api/installations/order-1/client-link', { method: 'PATCH', body }), orderParams)).status).toBe(401)
    expect(mocks.markSent).not.toHaveBeenCalled()

    mocks.session = { user: { id: 'owner-user', role: 'EMPLOYEE', employeeId: 'owner-employee' } }
    mocks.editable.mockResolvedValue({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) })
    expect((await PATCH(new NextRequest('http://test/api/installations/order-1/client-link', { method: 'PATCH', body }), orderParams)).status).toBe(403)
    expect(mocks.markSent).not.toHaveBeenCalled()

    mocks.editable.mockResolvedValue({ order: { id: 'order-1' } })
    const invalid = await PATCH(new NextRequest('http://test/api/installations/order-1/client-link', {
      method: 'PATCH', body: JSON.stringify({ action: 'MARK_SENT', linkId: 'link-1', extra: true }),
    }), orderParams)
    expect(invalid.status).toBe(400)
    expect(mocks.markSent).not.toHaveBeenCalled()

    const response = await PATCH(new NextRequest('http://test/api/installations/order-1/client-link', { method: 'PATCH', body }), orderParams)
    const result = await response.json()
    expect(response.status).toBe(200)
    expect(mocks.markSent).toHaveBeenCalledWith(expect.anything(), 'link-1', 'owner-user', 'order-1')
    expect(result).not.toHaveProperty('url')
    expect(result.link).not.toHaveProperty('token')
    expect(result.link).not.toHaveProperty('tokenHash')
    expect(result.link).toMatchObject({ sentAt: '2026-08-23T08:00:00.000Z', sentById: 'owner-user' })
  })

  it('never discloses client answers or clarification evidence to an assigned installer', async () => {
    mocks.session = { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'installer-employee' } }
    mocks.editable.mockResolvedValue({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) })

    const listing = await listClarifications(new NextRequest('http://test/api/installations/order-1/clarifications'), orderParams)

    expect(listing.status).toBe(403)
    expect(await listing.json()).toEqual({ error: 'Forbidden' })
    expect(mocks.listClarifications).not.toHaveBeenCalled()
    expect(mocks.editable).toHaveBeenCalled()
  })
})
