import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canViewInstallationOrder } from '@/lib/installations/access'

const mocks = vi.hoisted(() => ({
  session: { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'installer-employee' } },
  viewerFromSession: vi.fn(),
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  getRooms: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  listCatalog: vi.fn(),
  listTemplates: vi.fn(),
  getSnapshot: vi.fn(),
  listLinks: vi.fn(),
  listClarifications: vi.fn(),
  listRevisions: vi.fn(),
  getReadiness: vi.fn(),
  getOwnership: vi.fn(),
  getVisitFee: vi.fn(),
  listFiles: vi.fn(),
  listMismatches: vi.fn(),
  listVisits: vi.fn(),
  listScopeAssignments: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/http-access', () => ({ installationViewerFromSession: mocks.viewerFromSession }))
vi.mock('@/lib/installations/order-service', () => ({
  listInstallationOrders: mocks.listOrders,
  getInstallationOrder: mocks.getOrder,
}))
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
vi.mock('@/lib/installations/delegation-service', () => ({
  getInstallationOwnershipView: mocks.getOwnership,
  getInstallationVisitFeeView: mocks.getVisitFee,
}))
vi.mock('@/lib/installation-media/service', () => ({
  listInstallationFiles: mocks.listFiles,
  listInstallationMismatchesForEvidence: mocks.listMismatches,
}))
vi.mock('@/lib/installations/visit-service', () => ({ listInstallationVisits: mocks.listVisits }))
vi.mock('@/lib/installations/scope-assignment-service', () => ({ listScopeInstallerAssignments: mocks.listScopeAssignments }))
vi.mock('@/components/installations/order-list', () => ({ InstallationOrderList: () => null }))
vi.mock('@/components/installations/order-detail', () => ({ InstallationOrderDetail: () => null }))

import InstallationsPage from '@/app/(dashboard)/installations/page'
import InstallationOrderPage from '@/app/(dashboard)/installations/[id]/page'

const scopeAssignedOrder = {
  id: 'order-1',
  number: 'MON-20260824-0001',
  status: 'SCHEDULED',
  primaryEmployeeId: 'owner',
  backupEmployeeId: 'backup',
  installerAssignments: [],
  scopeAssignments: [{ employeeId: 'installer-employee' }],
  delegations: [],
}

function installerViewer(employeeActive: boolean) {
  return { role: 'INSTALLER' as const, employeeId: 'installer-employee', employeeActive }
}

describe('installer SSR installation access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.viewerFromSession.mockResolvedValue(installerViewer(true))
    mocks.listOrders.mockImplementation(async (_db, { viewer }) => (
      canViewInstallationOrder(viewer, scopeAssignedOrder) ? [scopeAssignedOrder] : []
    ))
    mocks.getOrder.mockResolvedValue(scopeAssignedOrder)
    mocks.getRooms.mockResolvedValue([])
    mocks.listVisits.mockResolvedValue([])
    mocks.listScopeAssignments.mockResolvedValue([])
    mocks.notFound.mockImplementation(() => {
      throw new Error('not-found')
    })
  })

  it('shows a scope-assigned order on the list for an active installer', async () => {
    const result = await InstallationsPage()

    expect(mocks.viewerFromSession).toHaveBeenCalledWith(mocks.session)
    expect(mocks.listOrders).toHaveBeenCalledWith(expect.anything(), { viewer: installerViewer(true) })
    expect(result.props.orders).toEqual([scopeAssignedOrder])
    expect(result.props.canCreate).toBe(false)
  })

  it('hides every order on the list for an inactive installer', async () => {
    mocks.viewerFromSession.mockResolvedValue(installerViewer(false))

    const result = await InstallationsPage()

    expect(mocks.viewerFromSession).toHaveBeenCalledWith(mocks.session)
    expect(result.props.orders).toEqual([])
    expect(result.props.canCreate).toBe(false)
  })

  it('renders a scope-assigned order detail for an active installer', async () => {
    const result = await InstallationOrderPage({ params: Promise.resolve({ id: 'order-1' }) })

    expect(mocks.viewerFromSession).toHaveBeenCalledWith(mocks.session)
    expect(result.props.order.id).toBe('order-1')
    expect(mocks.getRooms).toHaveBeenCalledWith(expect.anything(), 'order-1')
  })

  it('returns notFound for an inactive installer despite a scope assignment', async () => {
    mocks.viewerFromSession.mockResolvedValue(installerViewer(false))

    await expect(InstallationOrderPage({ params: Promise.resolve({ id: 'order-1' }) }))
      .rejects.toThrow('not-found')

    expect(mocks.viewerFromSession).toHaveBeenCalledWith(mocks.session)
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })
})
