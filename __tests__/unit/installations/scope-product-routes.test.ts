import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; employeeId?: string | null } },
  editable: vi.fn(),
  room: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/room-route-access', () => ({ editableInstallationOrder: mocks.editable, roomInInstallationOrder: mocks.room }))
vi.mock('@/lib/installations/catalog-service', () => ({
  updateInstallationScopeProduct: mocks.update,
  deleteInstallationScopeProduct: mocks.remove,
  InstallationCatalogValidationError: class InstallationCatalogValidationError extends Error {
    fieldErrors: Record<string, string>
    status: number
    constructor(fieldErrors = { form: 'invalid' }, status = 400) { super(Object.values(fieldErrors).join(' ')); this.fieldErrors = fieldErrors; this.status = status }
  },
}))

import { PATCH, DELETE } from '@/app/api/installations/[id]/rooms/[roomId]/scopes/[scopeId]/products/[scopeProductId]/route'

const params = { params: Promise.resolve({ id: 'order-1', roomId: 'room-1', scopeId: 'scope-1', scopeProductId: 'product-1' }) }
const room = { id: 'room-1', scopes: [{ id: 'scope-1', scopeProducts: [{ id: 'product-1' }] }] }

describe('scope-product patch route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session = { user: { id: 'manager-1', role: 'MANAGER' } }
    mocks.editable.mockResolvedValue({ order: { id: 'order-1' }, viewer: { role: 'MANAGER', employeeId: null, employeeActive: true, authorized: true } })
    mocks.room.mockResolvedValue(room)
    mocks.update.mockResolvedValue({ id: 'product-1', batchSnapshot: 'PARTIA-24' })
  })

  it('uses the same authentication, membership, and nested ownership checks as DELETE', async () => {
    mocks.session = null
    expect((await PATCH(new NextRequest('http://test/api/installations/order-1/rooms/room-1/scopes/scope-1/products/product-1', { method: 'PATCH' }), params)).status).toBe(401)

    mocks.session = { user: { id: 'outsider', role: 'EMPLOYEE', employeeId: 'employee-9' } }
    mocks.editable.mockResolvedValueOnce({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) })
    expect((await PATCH(new NextRequest('http://test/api/installations/order-1/rooms/room-1/scopes/scope-1/products/product-1', { method: 'PATCH' }), params)).status).toBe(403)

    mocks.room.mockResolvedValueOnce({ id: 'room-1', scopes: [{ id: 'scope-1', scopeProducts: [] }] })
    expect((await DELETE(new NextRequest('http://test/api/installations/order-1/rooms/room-1/scopes/scope-1/products/product-1', { method: 'DELETE' }), params)).status).toBe(404)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('forwards a PATCH payload and preserves a service conflict status with field errors', async () => {
    const response = await PATCH(new NextRequest('http://test/api/installations/order-1/rooms/room-1/scopes/scope-1/products/product-1', {
      method: 'PATCH', body: JSON.stringify({ productNameSnapshot: 'Nazwa', batchSnapshot: 'PARTIA-24', updatedAt: '2026-08-24T12:00:00.000Z' }),
    }), params)
    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), 'product-1', {
      productNameSnapshot: 'Nazwa', batchSnapshot: 'PARTIA-24', updatedAt: '2026-08-24T12:00:00.000Z',
    }, 'manager-1')

    const { InstallationCatalogValidationError } = await import('@/lib/installations/catalog-service')
    mocks.update.mockRejectedValueOnce(new InstallationCatalogValidationError({ updatedAt: 'Karta została zmieniona.' }, 409))
    const conflict = await PATCH(new NextRequest('http://test/api/installations/order-1/rooms/room-1/scopes/scope-1/products/product-1', {
      method: 'PATCH', body: JSON.stringify({ batchSnapshot: 'NOWA', updatedAt: '2026-08-24T12:00:00.000Z' }),
    }), params)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual(expect.objectContaining({ fieldErrors: { updatedAt: 'Karta została zmieniona.' } }))
  })

  it('returns 404 without calling the service when the product belongs to a different nested scope', async () => {
    mocks.room.mockResolvedValueOnce({
      id: 'room-1',
      scopes: [
        { id: 'scope-1', scopeProducts: [] },
        { id: 'scope-2', scopeProducts: [{ id: 'product-1' }] },
      ],
    })

    const response = await PATCH(new NextRequest('http://test/api/installations/order-1/rooms/room-1/scopes/scope-1/products/product-1', {
      method: 'PATCH', body: JSON.stringify({ batchSnapshot: 'PARTIA-24', updatedAt: '2026-08-25T10:00:00.000Z' }),
    }), params)

    expect(response.status).toBe(404)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed PATCH JSON without invoking the service', async () => {
    const response = await PATCH(new NextRequest('http://test/api/installations/order-1/rooms/room-1/scopes/scope-1/products/product-1', {
      method: 'PATCH', body: '{"batchSnapshot":',
    }), params)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Nieprawidłowy format danych.' })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
