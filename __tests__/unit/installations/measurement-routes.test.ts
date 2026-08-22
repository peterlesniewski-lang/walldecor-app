import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; employeeId?: string | null } },
  editable: vi.fn(),
  room: vi.fn(),
  actor: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/room-route-access', () => ({
  editableInstallationOrder: mocks.editable,
  roomInInstallationOrder: mocks.room,
  measurementActorFromSession: mocks.actor,
}))
vi.mock('@/lib/installations/catalog-service', () => ({
  addInstallationMeasurement: mocks.add,
  updateInstallationMeasurement: mocks.update,
  deleteInstallationMeasurement: mocks.remove,
  InstallationCatalogValidationError: class InstallationCatalogValidationError extends Error { fieldErrors = { form: 'invalid' } },
}))

import { POST } from '@/app/api/installations/[id]/rooms/[roomId]/measurements/route'
import { PATCH } from '@/app/api/installations/[id]/rooms/[roomId]/measurements/[measurementId]/route'

const room = { id: 'room-1', measurements: [], scopes: [] }
const actor = { userId: 'employee-user', role: 'EMPLOYEE', employeeId: 'employee-1' }

describe('internal measurement routes', () => {
  beforeEach(() => {
    mocks.session = null
    mocks.editable.mockResolvedValue({ order: { id: 'order-1' } })
    mocks.room.mockResolvedValue(room)
    mocks.actor.mockResolvedValue(actor)
    mocks.add.mockResolvedValue({ id: 'measurement-1', source: 'EMPLOYEE', authorId: 'employee-1' })
    mocks.update.mockResolvedValue({ id: 'measurement-1', source: 'EMPLOYEE', authorId: 'employee-1' })
  })

  it('rejects unauthenticated measurement creation', async () => {
    const response = await POST(new NextRequest('http://test/api/installations/order-1/rooms/room-1/measurements', { method: 'POST' }), { params: Promise.resolve({ id: 'order-1', roomId: 'room-1' }) })
    expect(response.status).toBe(401)
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('does not let an installer mutate measurements through the Task 2 endpoint', async () => {
    mocks.session = { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'installer-1' } }
    mocks.editable.mockResolvedValue({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) })

    const response = await POST(new NextRequest('http://test/api/installations/order-1/rooms/room-1/measurements', { method: 'POST', body: JSON.stringify({ elementName: 'Szerokość', value: '12', unit: 'CM' }) }), { params: Promise.resolve({ id: 'order-1', roomId: 'room-1' }) })
    expect(response.status).toBe(403)
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('does not expose the internal endpoint to a CLIENT session before Task 3', async () => {
    mocks.session = { user: { id: 'client-user', role: 'CLIENT' } }
    mocks.editable.mockResolvedValue({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) })

    const response = await POST(new NextRequest('http://test/api/installations/order-1/rooms/room-1/measurements', { method: 'POST', body: JSON.stringify({ elementName: 'Szerokość', value: '12', unit: 'CM' }) }), { params: Promise.resolve({ id: 'order-1', roomId: 'room-1' }) })
    expect(response.status).toBe(403)
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('strips spoofed source and author fields before create and patch, leaving trusted provenance to the service', async () => {
    mocks.session = { user: { id: 'employee-user', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    const payload = { elementName: 'Szerokość', value: '12', unit: 'CM', source: 'CLIENT', authorId: 'foreign-employee', authorContext: 'CLIENT:spoofed' }

    const created = await POST(new NextRequest('http://test/api/installations/order-1/rooms/room-1/measurements', { method: 'POST', body: JSON.stringify(payload) }), { params: Promise.resolve({ id: 'order-1', roomId: 'room-1' }) })
    expect(created.status).toBe(201)
    expect(mocks.add).toHaveBeenCalledWith(expect.anything(), 'room-1', { elementName: 'Szerokość', value: '12', unit: 'CM' }, actor)

    mocks.room.mockResolvedValueOnce({ id: 'room-1', measurements: [{ id: 'measurement-1' }], scopes: [] })
    const patched = await PATCH(new NextRequest('http://test/api/installations/order-1/rooms/room-1/measurements/measurement-1', { method: 'PATCH', body: JSON.stringify({ value: '13', source: 'CLIENT', authorId: 'foreign-employee', authorContext: 'CLIENT:patched' }) }), { params: Promise.resolve({ id: 'order-1', roomId: 'room-1', measurementId: 'measurement-1' }) })
    expect(patched.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), 'measurement-1', { value: '13' }, actor)
  })
})
