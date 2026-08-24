import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'installer-employee' } },
  getOrder: vi.fn(),
  getRooms: vi.fn(),
  listCatalog: vi.fn(),
  listTemplates: vi.fn(),
  getSnapshot: vi.fn(),
  listLinks: vi.fn(),
  listClarifications: vi.fn(),
  listRevisions: vi.fn(),
  getReadiness: vi.fn(),
  listFiles: vi.fn(),
  listMismatches: vi.fn(),
  canView: vi.fn(),
  canEdit: vi.fn(),
  canArchive: vi.fn(),
  employeeFindUnique: vi.fn(),
  viewerFromSession: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { employee: { findUnique: mocks.employeeFindUnique } } }))
vi.mock('@/lib/installations/constants', () => ({ INSTALLATION_ROLES: ['ADMIN', 'MANAGER', 'EMPLOYEE', 'INSTALLER'] }))
vi.mock('@/lib/installations/http-access', () => ({ installationViewerFromSession: mocks.viewerFromSession }))
vi.mock('@/lib/installations/access', () => ({
  canViewInstallationOrder: mocks.canView,
  canEditInstallationOrder: mocks.canEdit,
  canArchiveInstallationOrder: mocks.canArchive,
}))
vi.mock('@/lib/installations/order-service', () => ({ getInstallationOrder: mocks.getOrder }))
vi.mock('@/lib/installations/catalog-service', () => ({
  getInstallationOrderRooms: mocks.getRooms,
  listInstallationCatalog: mocks.listCatalog,
  listInstallationFormTemplates: mocks.listTemplates,
  getInstallationOrderFormSnapshot: mocks.getSnapshot,
}))
vi.mock('@/lib/installations/client-link', () => ({ listClientLinkStatuses: mocks.listLinks }))
vi.mock('@/lib/installations/form-service', () => ({
  listInstallationClarifications: mocks.listClarifications,
  listInstallationFormRevisions: mocks.listRevisions,
}))
vi.mock('@/lib/installations/readiness', () => ({ getInstallationReadiness: mocks.getReadiness }))
vi.mock('@/lib/installation-media/service', () => ({
  listInstallationFiles: mocks.listFiles,
  listInstallationMismatchesForEvidence: mocks.listMismatches,
}))
vi.mock('@/components/installations/order-detail', () => ({ InstallationOrderDetail: () => null }))

import InstallationOrderPage from '@/app/(dashboard)/installations/[id]/page'

describe('installer installation detail privacy', () => {
  it('does not fetch or pass links, client answers, evidence, readiness or revisions to an installer page', async () => {
    const order = {
      id: 'order-1',
      primaryEmployeeId: 'owner',
      backupEmployeeId: 'backup',
      installerAssignments: [{ employeeId: 'installer-employee' }],
      delegations: [],
    }
    mocks.getOrder.mockResolvedValue(order)
    mocks.getRooms.mockResolvedValue([{ id: 'room-1', name: 'Salon' }])
    mocks.canView.mockReturnValue(true)
    mocks.canEdit.mockReturnValue(false)
    mocks.canArchive.mockReturnValue(false)
    mocks.viewerFromSession.mockResolvedValue({
      role: 'INSTALLER',
      employeeId: 'installer-employee',
      employeeActive: true,
    })

    const result = await InstallationOrderPage({ params: Promise.resolve({ id: 'order-1' }) })

    expect(mocks.getRooms).toHaveBeenCalledWith(expect.anything(), 'order-1')
    expect(mocks.listLinks).not.toHaveBeenCalled()
    expect(mocks.listClarifications).not.toHaveBeenCalled()
    expect(mocks.listRevisions).not.toHaveBeenCalled()
    expect(mocks.getReadiness).not.toHaveBeenCalled()
    expect(mocks.listFiles).not.toHaveBeenCalled()
    expect(mocks.listMismatches).not.toHaveBeenCalled()
    expect(mocks.getSnapshot).not.toHaveBeenCalled()
    expect(mocks.listCatalog).not.toHaveBeenCalled()
    expect(mocks.listTemplates).not.toHaveBeenCalled()
    expect(result.props.clientLinks).toEqual([])
    expect(result.props.clarifications).toEqual([])
    expect(result.props.formRevisions).toEqual([])
    expect(result.props.files).toEqual([])
  })
})
