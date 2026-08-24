import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; employeeId?: string | null } },
  userFindUnique: vi.fn(),
  listCatalog: vi.fn(),
  createCatalogCategory: vi.fn(),
  createCatalogType: vi.fn(),
  createCatalogProduct: vi.fn(),
  getOrder: vi.fn(),
  getRooms: vi.fn(),
  createRoom: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }))
vi.mock('@/lib/installations/catalog-service', () => ({
  listInstallationCatalog: mocks.listCatalog,
  createCatalogCategory: mocks.createCatalogCategory,
  createCatalogType: mocks.createCatalogType,
  createCatalogProduct: mocks.createCatalogProduct,
  getInstallationOrderRooms: mocks.getRooms,
  getInstallerInstallationOrderRooms: mocks.getRooms,
  createInstallationRoom: mocks.createRoom,
  InstallationCatalogValidationError: class InstallationCatalogValidationError extends Error {
    fieldErrors: Record<string, string>
    status: number
    constructor(fieldErrors = { form: 'invalid' }, status = 400) { super(Object.values(fieldErrors).join(' ')); this.fieldErrors = fieldErrors; this.status = status }
  },
}))
vi.mock('@/lib/installations/order-service', () => ({ getInstallationOrder: mocks.getOrder }))

import { GET as getCatalog, POST as postCatalog } from '@/app/api/installations/catalog/route'
import { GET as getRooms, POST as postRoom } from '@/app/api/installations/[id]/rooms/route'

const ownerOrder = {
  primaryEmployeeId: 'employee-1', backupEmployeeId: 'employee-2', installerAssignments: [], scopeAssignments: [], delegations: [],
}

describe('installation catalog and room routes', () => {
  beforeEach(() => {
    mocks.session = null
    mocks.userFindUnique.mockImplementation(async () => {
      const session = mocks.session
      if (!session) return null
      const employeeId = session.user.employeeId ?? null
      return {
        id: session.user.id,
        role: session.user.role,
        isActive: true,
        employeeId,
        employee: employeeId ? { active: true } : null,
      }
    })
    mocks.listCatalog.mockResolvedValue([])
    mocks.createCatalogCategory.mockResolvedValue({ id: 'category-1', name: 'Tapety' })
    mocks.createCatalogType.mockResolvedValue({ id: 'type-1', name: 'Winylowe' })
    mocks.createCatalogProduct.mockResolvedValue({ id: 'product-1', name: 'Misty Grey' })
    mocks.getOrder.mockResolvedValue(ownerOrder)
    mocks.getRooms.mockResolvedValue([])
    mocks.createRoom.mockResolvedValue({ id: 'room-1', name: 'Salon' })
  })

  it('keeps catalog reads authenticated but limits catalog mutation to ADMIN/MANAGER', async () => {
    expect((await getCatalog()).status).toBe(401)

    mocks.session = { user: { id: 'employee-user', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    expect((await postCatalog(new NextRequest('http://test/api/installations/catalog', { method: 'POST', body: JSON.stringify({ kind: 'category', name: 'Tapety' }) }))).status).toBe(403)

    mocks.session = { user: { id: 'manager-user', role: 'MANAGER' } }
    const response = await postCatalog(new NextRequest('http://test/api/installations/catalog', { method: 'POST', body: JSON.stringify({ kind: 'category', name: 'Tapety' }) }))
    expect(response.status).toBe(201)
    expect(mocks.createCatalogCategory).toHaveBeenCalledWith(expect.anything(), { name: 'Tapety' })
  })

  it('does not expose or mutate rooms before checking the same order policy', async () => {
    mocks.session = { user: { id: 'outsider-user', role: 'EMPLOYEE', employeeId: 'outsider-employee' } }
    expect((await getRooms(new NextRequest('http://test/api/installations/order-1/rooms'), { params: Promise.resolve({ id: 'order-1' }) })).status).toBe(403)
    expect(mocks.getRooms).not.toHaveBeenCalled()

    mocks.session = { user: { id: 'owner-user', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    const response = await postRoom(new NextRequest('http://test/api/installations/order-1/rooms', { method: 'POST', body: JSON.stringify({ name: 'Salon' }) }), { params: Promise.resolve({ id: 'order-1' }) })
    expect(response.status).toBe(201)
    expect(mocks.createRoom).toHaveBeenCalledWith(expect.anything(), 'order-1', { name: 'Salon' }, 'owner-user')
  })

  it('loads current installer activity before exposing rooms assigned through a scope', async () => {
    mocks.session = { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'installer-1' } }
    mocks.getOrder.mockResolvedValue({ ...ownerOrder, scopeAssignments: [{ employeeId: 'installer-1' }] })

    const activeResponse = await getRooms(new NextRequest('http://test/api/installations/order-1/rooms'), {
      params: Promise.resolve({ id: 'order-1' }),
    })

    expect(activeResponse.status).toBe(200)
    expect(mocks.userFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'installer-user' } }))
    expect(mocks.getRooms).toHaveBeenCalledWith(expect.anything(), 'order-1', 'installer-1')

    mocks.getRooms.mockClear()
    mocks.userFindUnique.mockResolvedValue({ id: 'installer-user', role: 'INSTALLER', isActive: true, employeeId: 'installer-1', employee: { active: false } })
    const inactiveResponse = await getRooms(new NextRequest('http://test/api/installations/order-1/rooms'), {
      params: Promise.resolve({ id: 'order-1' }),
    })

    expect(inactiveResponse.status).toBe(403)
    expect(mocks.getRooms).not.toHaveBeenCalled()
  })

  it('returns the archived-parent domain conflict as Polish HTTP 409 instead of a raw database error', async () => {
    mocks.session = { user: { id: 'manager-user', role: 'MANAGER' } }
    const { InstallationCatalogValidationError } = await import('@/lib/installations/catalog-service')
    mocks.createCatalogType.mockRejectedValueOnce(new InstallationCatalogValidationError({ categoryId: 'Rodzic został zarchiwizowany podczas zapisu.' }, 409))

    const response = await postCatalog(new NextRequest('http://test/api/installations/catalog', { method: 'POST', body: JSON.stringify({ kind: 'type', categoryId: 'category-1', name: 'Winylowe' }) }))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/Rodzic został zarchiwizowany/)
  })
})
