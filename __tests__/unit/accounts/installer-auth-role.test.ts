import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  employeeFindUnique: vi.fn(),
  compare: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, findMany: vi.fn(), update: vi.fn() },
    employee: { findUnique: mocks.employeeFindUnique },
  },
}))
vi.mock('bcryptjs', () => ({ default: { compare: mocks.compare } }))

import { authOptions } from '@/lib/auth'

describe('INSTALLER NextAuth role preservation', () => {
  beforeEach(() => {
    mocks.userFindUnique.mockReset()
    mocks.employeeFindUnique.mockReset()
    mocks.compare.mockReset().mockResolvedValue(true)
  })

  it('keeps INSTALLER and employee provenance through login JWT and session projection', async () => {
    const jwt = authOptions.callbacks?.jwt
    const session = authOptions.callbacks?.session
    if (!jwt || !session) throw new Error('Missing NextAuth callbacks')

    const token = await jwt({
      token: {},
      user: { id: 'installer-user', username: 'installer', email: 'installer@example.com', name: 'Installer', role: 'INSTALLER', employeeId: 'employee-1', mustChangePassword: false },
    } as never)
    const projected = await session({ session: { user: {} }, token } as never)

    expect(token).toMatchObject({ role: 'INSTALLER', employeeId: 'employee-1' })
    expect(projected.user).toMatchObject({ id: 'installer-user', role: 'INSTALLER', employeeId: 'employee-1' })
  })

  it('preserves INSTALLER when a JWT refresh reloads the account', async () => {
    const jwt = authOptions.callbacks?.jwt
    if (!jwt) throw new Error('Missing NextAuth JWT callback')
    mocks.userFindUnique.mockResolvedValue({
      username: 'installer', role: 'INSTALLER', employeeId: 'employee-1', mustChangePassword: false, isActive: true,
    })

    const token = await jwt({ token: { id: 'installer-user', role: 'EMPLOYEE' }, trigger: 'update' } as never)

    expect(token).toMatchObject({ role: 'INSTALLER', employeeId: 'employee-1', mustChangePassword: false })
  })

  it.each([
    ['without an employee link', null, undefined],
    ['with a missing employee', 'missing-employee', null],
    ['with an inactive employee', 'inactive-employee', { id: 'inactive-employee', active: false }],
  ])('denies a stale active INSTALLER login %s', async (_description, employeeId, employee) => {
    const provider = authOptions.providers.find((candidate) => candidate.id === 'credentials') as {
      options?: { authorize?: (credentials: Record<string, string>) => Promise<unknown> }
    }
    if (!provider.options?.authorize) throw new Error('Missing credentials authorize callback')
    mocks.userFindUnique.mockResolvedValue({
      id: 'installer-user', username: 'installer', email: 'installer@example.com', name: 'Installer',
      role: 'INSTALLER', employeeId, isActive: true, passwordHash: 'hash', mustChangePassword: false,
    })
    if (employeeId) mocks.employeeFindUnique.mockResolvedValue(employee)

    await expect(provider.options.authorize({ username: 'installer', password: 'correct-password' }))
      .rejects.toThrow(/instalatora/i)
  })
})
