import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; employeeId?: string | null } },
  editable: vi.fn(),
  createSnapshot: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/room-route-access', () => ({ editableInstallationOrder: mocks.editable }))
vi.mock('@/lib/installations/catalog-service', () => ({
  createInstallationOrderFormSnapshot: mocks.createSnapshot,
  InstallationCatalogValidationError: class InstallationCatalogValidationError extends Error { fieldErrors = { form: 'invalid' } },
}))

import { POST } from '@/app/api/installations/[id]/form-snapshot/route'

describe('installation form snapshot route', () => {
  beforeEach(() => {
    mocks.session = null
    mocks.editable.mockClear()
    mocks.createSnapshot.mockClear()
    mocks.editable.mockResolvedValue({ order: { id: 'order-1' } })
    mocks.createSnapshot.mockResolvedValue({ id: 'snapshot-1', orderId: 'order-1', templateId: 'template-v1', templateVersion: 1 })
  })

  it('requires editable access and never reaches snapshot creation for an archived order', async () => {
    expect((await POST(new NextRequest('http://test/api/installations/order-1/form-snapshot', { method: 'POST' }), { params: Promise.resolve({ id: 'order-1' }) })).status).toBe(401)
    expect(mocks.createSnapshot).not.toHaveBeenCalled()

    mocks.session = { user: { id: 'owner-user', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    mocks.editable.mockResolvedValue({ response: new Response(JSON.stringify({ error: 'Archived' }), { status: 409 }) })
    const response = await POST(new NextRequest('http://test/api/installations/order-1/form-snapshot', { method: 'POST', body: JSON.stringify({ templateId: 'template-v1' }) }), { params: Promise.resolve({ id: 'order-1' }) })
    expect(response.status).toBe(409)
    expect(mocks.createSnapshot).not.toHaveBeenCalled()
  })

  it('pins only the selected published template for the authenticated editor', async () => {
    mocks.session = { user: { id: 'owner-user', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    const response = await POST(new NextRequest('http://test/api/installations/order-1/form-snapshot', { method: 'POST', body: JSON.stringify({ templateId: ' template-v1 ' }) }), { params: Promise.resolve({ id: 'order-1' }) })

    expect(response.status).toBe(201)
    expect(mocks.createSnapshot).toHaveBeenCalledWith(expect.anything(), { orderId: 'order-1', templateId: 'template-v1' }, 'owner-user')
  })

  it.each([null, {}, [], 'template-v1', { templateId: '   ' }, { templateId: 'template-v1', extra: true }])('returns a Polish 400 and never calls the service for invalid body %j', async (body) => {
    mocks.session = { user: { id: 'owner-user', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    const response = await POST(new NextRequest('http://test/api/installations/order-1/form-snapshot', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'order-1' }) })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/identyfikator szablonu/i)
    expect(mocks.createSnapshot).not.toHaveBeenCalled()
  })
})
