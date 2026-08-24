import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.userFindUnique, findMany: vi.fn(), update: vi.fn() } } }))
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn() } }))

import { authOptions } from '@/lib/auth'

describe('INSTALLER NextAuth role preservation', () => {
  beforeEach(() => mocks.userFindUnique.mockReset())

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
})
