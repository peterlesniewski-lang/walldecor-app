import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; employeeId?: string | null } },
  findUser: vi.fn(),
  getOrder: vi.fn(),
  getRooms: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUser } } }))
vi.mock('@/lib/installations/order-service', () => ({
  getInstallationOrder: mocks.getOrder,
  updateInstallationOrder: vi.fn(),
  archiveInstallationOrder: vi.fn(),
  InstallationOrderNotFoundError: class InstallationOrderNotFoundError extends Error {},
}))
vi.mock('@/lib/installations/catalog-service', () => ({
  getInstallationOrderRooms: mocks.getRooms,
  getInstallerInstallationOrderRooms: mocks.getRooms,
  createInstallationRoom: vi.fn(),
  InstallationCatalogValidationError: class InstallationCatalogValidationError extends Error {},
}))

import { GET as getOrder } from '@/app/api/installations/[id]/route'
import { GET as getRooms } from '@/app/api/installations/[id]/rooms/route'

const params = { params: Promise.resolve({ id: 'order-1' }) }
const baseOrder = {
  id: 'order-1', number: 'MON-1', status: 'DRAFT', archivedAt: null,
  primaryEmployeeId: 'coord-1', backupEmployeeId: 'coord-2',
  primaryEmployee: { firstName: 'Anna', lastName: 'Koordynator' },
  backupEmployee: { firstName: 'Marek', lastName: 'Zastępca' },
  installerAssignments: [], scopeAssignments: [{ employeeId: 'installer-1' }], delegations: [],
  client: { name: 'Klient', email: 'SENTINEL-client@example.test', phone: 'SENTINEL-PHONE' },
  addressStreet: 'Testowa', addressBuildingNumber: '1', addressApartmentNumber: null, addressPostalCode: '00-001', addressCity: 'Warszawa',
  externalSystem: 'SENTINEL-EXTERNAL', externalId: 'SENTINEL-ID', visitFeeGrossAmount: '123.45', auditEvents: [{ actorId: 'SENTINEL-ACTOR' }],
  formSnapshots: [{ schemaJson: 'SENTINEL-FORM' }],
}

function currentUser(role = 'INSTALLER', isActive = true) {
  return { id: 'user-1', role, isActive, employeeId: role === 'INSTALLER' ? 'installer-1' : null, employee: role === 'INSTALLER' ? { active: true } : null }
}

describe('installer privacy at installation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session = { user: { id: 'user-1', role: 'INSTALLER', employeeId: 'installer-1' } }
    mocks.findUser.mockResolvedValue(currentUser())
    mocks.getOrder.mockResolvedValue(baseOrder)
    mocks.getRooms.mockResolvedValue([{
      id: 'room-1', name: 'Salon', sortOrder: 0,
      measurements: [{ id: 'room-measurement', elementName: 'SENTINEL ROOM MEASUREMENT', value: '500', unit: 'CM', source: 'CLIENT', authorId: 'SENTINEL-AUTHOR', authorContext: 'SENTINEL-CONTEXT', actorUserId: 'SENTINEL-USER', actorRole: 'ADMIN' }],
      scopes: [
        { id: 'scope-own', name: 'Tapeta', sortOrder: 0, assignments: [{ employeeId: 'installer-1' }], scopeProducts: [{ id: 'product-own', productNameSnapshot: 'Produkt własny', productCodeSnapshot: 'P-1', manufacturerSnapshot: 'Producent', collectionSnapshot: 'Kolekcja', batchSnapshot: 'PARTIA-24', catalogProductId: 'catalog-own', sortOrder: 0 }], measurements: [{ id: 'measurement-own', elementName: 'Szerokość', kind: 'RECTANGLE', value: '500', secondaryValue: '250', unit: 'CM', source: 'EMPLOYEE', authorId: 'SENTINEL-AUTHOR', authorContext: 'SENTINEL-CONTEXT', actorUserId: 'SENTINEL-USER', actorRole: 'ADMIN' }] },
        { id: 'scope-foreign', name: 'SENTINEL FOREIGN SCOPE', sortOrder: 1, assignments: [{ employeeId: 'installer-2' }], scopeProducts: [{ id: 'product-foreign', productNameSnapshot: 'SENTINEL FOREIGN PRODUCT', productCodeSnapshot: null, manufacturerSnapshot: null, collectionSnapshot: null, catalogProductId: 'catalog-foreign', sortOrder: 0 }], measurements: [{ id: 'measurement-foreign', elementName: 'SENTINEL FOREIGN MEASUREMENT', value: '1', unit: 'CM', source: 'CLIENT', authorId: 'foreign', authorContext: 'CLIENT', actorUserId: 'foreign-user', actorRole: 'ADMIN' }] },
      ],
    }])
  })

  it.each([
    ['disabled', () => currentUser('INSTALLER', false)],
    ['deleted', () => null],
    ['unknown role', () => currentUser('SUSPENDED')],
  ])('denies the next API request for a %s account before reading the installation', async (_scenario, user) => {
    mocks.findUser.mockResolvedValue(user())

    const response = await getOrder(new NextRequest('http://test/api/installations/order-1'), params)

    expect(response.status).toBe(403)
    expect(mocks.getOrder).not.toHaveBeenCalled()
  })

  it('returns an explicit installer order allowlist without client contact, audit, external, form, or fee data', async () => {
    const response = await getOrder(new NextRequest('http://test/api/installations/order-1'), params)
    const payload = await response.json()
    const serialized = JSON.stringify(payload)

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      id: 'order-1', number: 'MON-1', status: 'DRAFT', archivedAt: null,
      client: { name: 'Klient' },
      addressStreet: 'Testowa', addressBuildingNumber: '1', addressApartmentNumber: null, addressPostalCode: '00-001', addressCity: 'Warszawa',
      primaryEmployee: { firstName: 'Anna', lastName: 'Koordynator' },
      backupEmployee: { firstName: 'Marek', lastName: 'Zastępca' },
    })
    for (const sentinel of ['SENTINEL-client@example.test', 'SENTINEL-PHONE', 'SENTINEL-EXTERNAL', 'SENTINEL-ID', 'SENTINEL-ACTOR', 'SENTINEL-FORM', '123.45']) {
      expect(serialized).not.toContain(sentinel)
    }
  })

  it('keeps the full order API response for a current coordinator', async () => {
    mocks.session = { user: { id: 'manager-user', role: 'MANAGER' } }
    mocks.findUser.mockResolvedValue(currentUser('MANAGER'))

    const response = await getOrder(new NextRequest('http://test/api/installations/order-1'), params)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.client.email).toBe('SENTINEL-client@example.test')
    expect(payload.externalSystem).toBe('SENTINEL-EXTERNAL')
  })

  it('returns installers only their assigned scopes and a provenance-free measurement allowlist', async () => {
    mocks.getRooms.mockResolvedValueOnce([{
      id: 'room-1', name: 'Salon', sortOrder: 0, measurements: [], scopes: [{
        id: 'scope-own', name: 'Tapeta', sortOrder: 0,
        scopeProducts: [{ id: 'product-own', productNameSnapshot: 'Produkt własny', productCodeSnapshot: 'P-1', manufacturerSnapshot: 'Producent', collectionSnapshot: 'Kolekcja', batchSnapshot: 'PARTIA-24', sortOrder: 0 }],
        measurements: [{ id: 'measurement-own', elementName: 'Szerokość', kind: 'RECTANGLE', value: '500', secondaryValue: '250', unit: 'CM' }],
      }],
    }])
    const response = await getRooms(new NextRequest('http://test/api/installations/order-1/rooms'), params)
    const payload = await response.json()
    const serialized = JSON.stringify(payload)

    expect(response.status).toBe(200)
    expect(mocks.getRooms).toHaveBeenCalledWith(expect.anything(), 'order-1', 'installer-1')
    expect(payload).toEqual([{
      id: 'room-1', name: 'Salon', sortOrder: 0, measurements: [],
      scopes: [{
        id: 'scope-own', name: 'Tapeta', sortOrder: 0,
        scopeProducts: [{ id: 'product-own', productNameSnapshot: 'Produkt własny', productCodeSnapshot: 'P-1', manufacturerSnapshot: 'Producent', collectionSnapshot: 'Kolekcja', batchSnapshot: 'PARTIA-24', sortOrder: 0 }],
        measurements: [{ id: 'measurement-own', elementName: 'Szerokość', kind: 'RECTANGLE', value: '500', secondaryValue: '250', unit: 'CM' }],
      }],
    }])
    for (const sentinel of ['SENTINEL ROOM MEASUREMENT', 'SENTINEL FOREIGN SCOPE', 'SENTINEL FOREIGN PRODUCT', 'SENTINEL FOREIGN MEASUREMENT', 'SENTINEL-AUTHOR', 'SENTINEL-CONTEXT', 'SENTINEL-USER']) {
      expect(serialized).not.toContain(sentinel)
    }
    expect(serialized).not.toContain('catalog-own')
    expect(serialized).not.toContain('source')
    expect(serialized).not.toContain('author')
    expect(serialized).not.toContain('actor')
  })
})
