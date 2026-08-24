import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: { user: { id: 'admin-user', role: 'ADMIN' } } as { user: { id: string; role: string } } | null,
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  employeeFindUnique: vi.fn(),
  hash: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      create: mocks.userCreate,
      update: mocks.userUpdate,
    },
    employee: { findUnique: mocks.employeeFindUnique },
  },
}))
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash } }))

import { POST } from '@/app/api/users/route'
import { PATCH } from '@/app/api/users/[id]/route'

const installerPayload = {
  username: 'installer.one',
  email: 'installer@example.com',
  name: 'Installer One',
  role: 'INSTALLER',
  employeeId: 'employee-1',
}

const createRequest = (body: unknown) => new NextRequest('http://test/api/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

describe('installer user account API contract', () => {
  beforeEach(() => {
    mocks.session = { user: { id: 'admin-user', role: 'ADMIN' } }
    mocks.userFindUnique.mockReset().mockResolvedValue(null)
    mocks.userCreate.mockReset().mockResolvedValue({ id: 'installer-user', ...installerPayload })
    mocks.userUpdate.mockReset().mockResolvedValue({ id: 'installer-user', role: 'INSTALLER' })
    mocks.employeeFindUnique.mockReset().mockResolvedValue({ id: 'employee-1', active: true })
    mocks.hash.mockReset().mockResolvedValue('hash')
  })

  it('creates an INSTALLER only for an active employee with no existing account', async () => {
    const response = await POST(createRequest(installerPayload))

    expect(response.status).toBe(201)
    expect(mocks.employeeFindUnique).toHaveBeenCalledWith({ where: { id: 'employee-1' }, select: { id: true, active: true } })
    expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'INSTALLER', employeeId: 'employee-1' }),
    }))
  })

  it('rejects an INSTALLER create without an active employee in Polish', async () => {
    const missingEmployee = await POST(createRequest({ ...installerPayload, employeeId: undefined }))
    expect(missingEmployee.status).toBe(400)
    await expect(missingEmployee.json()).resolves.toMatchObject({ error: expect.stringMatching(/instalator/i) })

    mocks.employeeFindUnique.mockResolvedValueOnce({ id: 'employee-1', active: false })
    const inactiveEmployee = await POST(createRequest(installerPayload))
    expect(inactiveEmployee.status).toBe(400)
    await expect(inactiveEmployee.json()).resolves.toMatchObject({ error: expect.stringMatching(/aktywn/i) })
    expect(mocks.userCreate).not.toHaveBeenCalled()
  })

  it('allows a role change to INSTALLER only for a user already linked to an active employee', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'installer-user', employeeId: 'employee-1' })

    const response = await PATCH(new NextRequest('http://test/api/users/installer-user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'INSTALLER' }),
    }), { params: Promise.resolve({ id: 'installer-user' }) })

    expect(response.status).toBe(200)
    expect(mocks.employeeFindUnique).toHaveBeenCalledWith({ where: { id: 'employee-1' }, select: { id: true, active: true } })
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'INSTALLER' } }))
  })

  it('rejects a role change to INSTALLER without an active linked employee in Polish', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'installer-user', employeeId: null })
    const unlinked = await PATCH(new NextRequest('http://test/api/users/installer-user', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'INSTALLER' }),
    }), { params: Promise.resolve({ id: 'installer-user' }) })
    expect(unlinked.status).toBe(400)
    await expect(unlinked.json()).resolves.toMatchObject({ error: expect.stringMatching(/powiązan/i) })

    mocks.userFindUnique.mockResolvedValueOnce({ id: 'installer-user', employeeId: 'employee-1' })
    mocks.employeeFindUnique.mockResolvedValueOnce({ id: 'employee-1', active: false })
    const inactive = await PATCH(new NextRequest('http://test/api/users/installer-user', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'INSTALLER' }),
    }), { params: Promise.resolve({ id: 'installer-user' }) })
    expect(inactive.status).toBe(400)
    await expect(inactive.json()).resolves.toMatchObject({ error: expect.stringMatching(/aktywn/i) })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })
})
