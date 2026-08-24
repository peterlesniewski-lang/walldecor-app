import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findEmployee: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { employee: { findUnique: mocks.findEmployee } },
}))
vi.mock('@/lib/installations/order-service', () => ({ getInstallationOrder: vi.fn() }))

import { installationViewerFromSession } from '@/lib/installations/http-access'

describe('installationViewerFromSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the current active flag for an INSTALLER with an employee record', async () => {
    mocks.findEmployee.mockResolvedValue({ active: true })

    await expect(installationViewerFromSession({ user: { role: 'INSTALLER', employeeId: 'installer-1' } }))
      .resolves.toEqual({ role: 'INSTALLER', employeeId: 'installer-1', employeeActive: true })
    expect(mocks.findEmployee).toHaveBeenCalledWith({ where: { id: 'installer-1' }, select: { active: true } })
  })

  it('fails closed for an inactive INSTALLER', async () => {
    mocks.findEmployee.mockResolvedValue({ active: false })

    await expect(installationViewerFromSession({ user: { role: 'INSTALLER', employeeId: 'installer-1' } }))
      .resolves.toEqual({ role: 'INSTALLER', employeeId: 'installer-1', employeeActive: false })
    expect(mocks.findEmployee).toHaveBeenCalledWith({ where: { id: 'installer-1' }, select: { active: true } })
  })

  it.each(['ADMIN', 'MANAGER'])('keeps %s on the no-lookup fast path', async (role) => {
    await expect(installationViewerFromSession({ user: { role, employeeId: 'manager-1' } }))
      .resolves.toEqual({ role, employeeId: 'manager-1' })
    expect(mocks.findEmployee).not.toHaveBeenCalled()
  })
})
