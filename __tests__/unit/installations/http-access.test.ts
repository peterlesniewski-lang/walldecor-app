import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: mocks.findUser } },
}))
vi.mock('@/lib/installations/order-service', () => ({ getInstallationOrder: vi.fn() }))

import { installationViewerFromSession } from '@/lib/installations/http-access'

describe('installationViewerFromSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the current user role and linked employee instead of stale session claims', async () => {
    mocks.findUser.mockResolvedValue({
      id: 'installer-user', role: 'INSTALLER', isActive: true, employeeId: 'installer-1', employee: { active: true },
    })

    await expect(installationViewerFromSession({ user: { id: 'installer-user', role: 'ADMIN', employeeId: null } }))
      .resolves.toMatchObject({ role: 'INSTALLER', employeeId: 'installer-1', employeeActive: true, authorized: true })
    expect(mocks.findUser).toHaveBeenCalledWith({
      where: { id: 'installer-user' },
      select: expect.objectContaining({ role: true, isActive: true, employeeId: true, employee: { select: { active: true } } }),
    })
  })

  it.each([
    ['the account is disabled', { id: 'user-1', role: 'ADMIN', isActive: false, employeeId: null, employee: null }],
    ['the account was deleted', null],
    ['the account role is no longer an installation role', { id: 'user-1', role: 'SUSPENDED', isActive: true, employeeId: null, employee: null }],
    ['the current installer employee is inactive', { id: 'user-1', role: 'INSTALLER', isActive: true, employeeId: 'installer-1', employee: { active: false } }],
  ])('fails closed when %s', async (_scenario, currentUser) => {
    mocks.findUser.mockResolvedValue(currentUser)

    await expect(installationViewerFromSession({ user: { id: 'user-1', role: 'ADMIN', employeeId: null } }))
      .resolves.toMatchObject({ authorized: false })
  })
})
