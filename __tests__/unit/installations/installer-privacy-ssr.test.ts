import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  getOrder: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'installer-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUser } } }))
vi.mock('@/lib/installations/order-service', () => ({ getInstallationOrder: mocks.getOrder }))
vi.mock('@/lib/installations/catalog-service', () => ({
  getInstallationOrderFormSnapshot: vi.fn(), getInstallationOrderRooms: vi.fn(), getInstallerInstallationOrderRooms: vi.fn(), listInstallationCatalog: vi.fn(), listInstallationFormTemplates: vi.fn(),
}))
vi.mock('@/lib/installations/client-link', () => ({ listClientLinkStatuses: vi.fn() }))
vi.mock('@/lib/installations/form-service', () => ({ listInstallationClarifications: vi.fn(), listInstallationFormRevisions: vi.fn() }))
vi.mock('@/lib/installations/readiness', () => ({ getInstallationReadiness: vi.fn() }))
vi.mock('@/lib/installations/delegation-service', () => ({ getInstallationOwnershipView: vi.fn(), getInstallationVisitFeeView: vi.fn() }))
vi.mock('@/lib/installation-media/service', () => ({ listInstallationFiles: vi.fn(), listInstallationMismatchesForEvidence: vi.fn() }))
vi.mock('@/lib/installations/visit-service', () => ({ listInstallationVisits: vi.fn() }))
vi.mock('@/lib/installations/scope-assignment-service', () => ({ listScopeInstallerAssignments: vi.fn() }))
vi.mock('@/components/installations/order-detail', () => ({ InstallationOrderDetail: () => null }))

import InstallationOrderPage from '@/app/(dashboard)/installations/[id]/page'

describe('installation SSR privacy', () => {
  it.each([
    ['is disabled', { id: 'installer-user', role: 'INSTALLER', isActive: false, employeeId: 'installer-1', employee: { active: true } }],
    ['is deleted', null],
    ['has an unknown current role', { id: 'installer-user', role: 'SUSPENDED', isActive: true, employeeId: null, employee: null }],
  ])('denies a stale active installer session when the User account %s before reading the card', async (_scenario, currentUser) => {
    mocks.findUser.mockResolvedValue(currentUser)

    await expect(InstallationOrderPage({ params: Promise.resolve({ id: 'order-1' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.getOrder).not.toHaveBeenCalled()
  })
})
