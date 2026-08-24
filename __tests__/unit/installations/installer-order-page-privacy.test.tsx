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
  listVisits: vi.fn(),
  listScopeAssignments: vi.fn(),
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
vi.mock('@/lib/installations/visit-service', () => ({ listInstallationVisits: mocks.listVisits }))
vi.mock('@/lib/installations/scope-assignment-service', () => ({ listScopeInstallerAssignments: mocks.listScopeAssignments }))
vi.mock('@/components/installations/order-detail', () => ({ InstallationOrderDetail: () => null }))

import InstallationOrderPage from '@/app/(dashboard)/installations/[id]/page'

describe('installer installation detail privacy', () => {
  it('does not fetch or pass links, client answers, evidence, readiness or revisions to an installer page', async () => {
    const order = {
      id: 'order-1',
      number: 'MON-PRIVATE-1',
      status: 'SCHEDULED',
      archivedAt: null,
      client: { name: 'Klient montażu', email: 'sentinel-client-secret@example.test', phone: '+48 SENTINEL PHONE' },
      addressStreet: 'Sienna',
      addressBuildingNumber: '10',
      addressApartmentNumber: '7',
      addressPostalCode: '00-001',
      addressCity: 'Warszawa',
      primaryEmployeeId: 'owner',
      backupEmployeeId: 'backup',
      primaryEmployee: { id: 'owner', firstName: 'Anna', lastName: 'Opiekun', active: true },
      backupEmployee: { id: 'backup', firstName: 'Bartek', lastName: 'Zastępca', active: true },
      installerAssignments: [{ employeeId: 'installer-employee' }],
      delegations: [],
      auditEvents: [{ id: 'audit-private', afterJson: 'SENTINEL PRIVATE AUDIT' }],
      formSubmissions: [{ answersJson: 'SENTINEL PRIVATE FORM ANSWER' }],
      externalSystem: 'SENTINEL TECHNICAL SYSTEM',
      externalId: 'SENTINEL TECHNICAL ID',
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
    mocks.listVisits.mockResolvedValue([{
      id: 'installer-visit', orderId: 'order-1', status: 'CONFIRMED', startsAt: '2026-09-14T06:00:00.000Z', endsAt: '2026-09-14T14:00:00.000Z', timezone: 'Europe/Warsaw', revision: 2,
      scopeIds: ['scope-1'], note: 'Prywatna notatka koordynatora', createdById: 'coordinator-1',
      participants: [{ employeeId: 'installer-employee', name: 'Instalator', email: 'installer@example.test', scopeIds: ['scope-1'], inviteStatus: 'READY' }],
      syncState: { status: 'PENDING', externalId: 'SENTINEL PAGE EXTERNAL ID', externalUrl: 'https://calendar.example.test/event', externalEtag: 'SENTINEL PAGE ETAG', lastErrorCode: 'SENTINEL PAGE ERROR CODE', lastErrorMessage: 'SENTINEL PAGE ERROR MESSAGE', lastAttemptAt: null, lastSyncedAt: null },
    }, {
      id: 'foreign-visit', orderId: 'order-1', status: 'CONFIRMED', startsAt: '2026-09-15T06:00:00.000Z', endsAt: '2026-09-15T14:00:00.000Z', timezone: 'Europe/Warsaw', revision: 1,
      scopeIds: ['scope-foreign'], note: 'SENTINEL FOREIGN VISIT',
      participants: [{ employeeId: 'other-installer', name: 'Inny instalator', email: 'other@example.test', scopeIds: ['scope-foreign'], inviteStatus: 'READY' }],
      syncState: { status: 'SYNCED' },
    }])
    mocks.listScopeAssignments.mockResolvedValue([{ scopeId: 'scope-1', employeeIds: ['installer-employee'] }])

    const result = await InstallationOrderPage({ params: Promise.resolve({ id: 'order-1' }) })

    expect(mocks.getRooms).toHaveBeenCalledWith(expect.anything(), 'order-1')
    expect(mocks.listVisits).toHaveBeenCalledWith(expect.anything(), 'order-1')
    expect(mocks.listScopeAssignments).toHaveBeenCalledWith(expect.anything(), 'order-1')
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
    expect(result.props.visits[0]).toMatchObject({ id: 'installer-visit', scopeIds: ['scope-1'], syncState: { status: 'PENDING' } })
    expect(result.props.visits[0]).not.toHaveProperty('note')
    expect(result.props.visits[0]).not.toHaveProperty('createdById')
    expect(result.props.visits[0].participants[0]).not.toHaveProperty('email')
    expect(result.props.visits[0].syncState).not.toHaveProperty('externalUrl')
    expect(result.props.visits).toHaveLength(1)
    expect(result.props.scopeAssignments).toEqual([])
    expect(result.props.order).toEqual({
      id: 'order-1',
      number: 'MON-PRIVATE-1',
      status: 'SCHEDULED',
      archivedAt: null,
      client: { name: 'Klient montażu' },
      addressStreet: 'Sienna',
      addressBuildingNumber: '10',
      addressApartmentNumber: '7',
      addressPostalCode: '00-001',
      addressCity: 'Warszawa',
      primaryEmployee: { firstName: 'Anna', lastName: 'Opiekun' },
      backupEmployee: { firstName: 'Bartek', lastName: 'Zastępca' },
    })
    const flightProps = JSON.stringify(result.props)
    for (const secret of ['sentinel-client-secret@example.test', '+48 SENTINEL PHONE', 'SENTINEL PRIVATE AUDIT', 'SENTINEL PRIVATE FORM ANSWER', 'SENTINEL TECHNICAL SYSTEM', 'SENTINEL TECHNICAL ID', 'SENTINEL FOREIGN VISIT', 'SENTINEL PAGE EXTERNAL ID', 'SENTINEL PAGE ETAG', 'SENTINEL PAGE ERROR CODE', 'SENTINEL PAGE ERROR MESSAGE']) {
      expect(flightProps).not.toContain(secret)
    }
  })
})
