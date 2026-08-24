import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; employeeId?: string | null } },
  viewer: { role: 'EMPLOYEE', employeeId: 'employee-1', employeeActive: true, authorized: true },
  viewerFromSession: vi.fn(),
  editable: vi.fn(),
  changeOwnership: vi.fn(),
  createDelegation: vi.fn(),
  endDelegation: vi.fn(),
  approveFee: vi.fn(),
  rejectFee: vi.fn(),
  defaultFee: vi.fn(),
  requestFee: vi.fn(),
  requeueCalendar: vi.fn(),
  employeeFindMany: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/prisma', () => ({ prisma: { employee: { findMany: mocks.employeeFindMany } } }))
vi.mock('@/lib/installations/http-access', () => ({ installationViewerFromSession: mocks.viewerFromSession }))
vi.mock('@/lib/installations/room-route-access', () => ({ editableInstallationOrder: mocks.editable }))
vi.mock('@/lib/installations/delegation-service', () => ({
  changeInstallationOwnership: mocks.changeOwnership,
  createInstallationDelegation: mocks.createDelegation,
  endInstallationDelegation: mocks.endDelegation,
  approveInstallationVisitFeeOverride: mocks.approveFee,
  rejectInstallationVisitFeeOverride: mocks.rejectFee,
  selectDefaultInstallationVisitFee: mocks.defaultFee,
  requestInstallationVisitFeeOverride: mocks.requestFee,
  InstallationGovernanceValidationError: class InstallationGovernanceValidationError extends Error {},
}))
vi.mock('@/lib/installations/visit-service', () => ({
  requeueInstallationCalendar: mocks.requeueCalendar,
  InstallationVisitArchivedOrderError: class InstallationVisitArchivedOrderError extends Error {},
  InstallationVisitNotFoundError: class InstallationVisitNotFoundError extends Error {},
  InstallationVisitRevisionConflictError: class InstallationVisitRevisionConflictError extends Error {},
}))
vi.mock('@/lib/installations/visit-schemas', () => ({ InstallationVisitValidationError: class InstallationVisitValidationError extends Error {} }))
vi.mock('@/components/installations/order-form', () => ({ InstallationOrderForm: () => null }))

import { PATCH as patchOwnership } from '@/app/api/installations/[id]/ownership/route'
import { POST as postFee } from '@/app/api/installations/[id]/visit-fee/route'
import { POST as postCalendar } from '@/app/api/installations/[id]/visits/[visitId]/calendar/route'
import NewInstallationOrderPage from '@/app/(dashboard)/installations/new/page'

const orderParams = { params: Promise.resolve({ id: 'order-1' }) }
const visitParams = { params: Promise.resolve({ id: 'order-1', visitId: 'visit-1' }) }
const jsonRequest = (url: string, body: unknown) => new NextRequest(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('fresh viewer for privileged installation operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session = { user: { id: 'user-1', role: 'ADMIN' } }
    mocks.viewer = { role: 'EMPLOYEE', employeeId: 'employee-1', employeeActive: true, authorized: true }
    mocks.viewerFromSession.mockImplementation(async () => mocks.viewer)
    mocks.editable.mockImplementation(async () => ({ order: { id: 'order-1' }, viewer: mocks.viewer }))
    mocks.changeOwnership.mockResolvedValue({ id: 'order-1' })
    mocks.approveFee.mockResolvedValue({ id: 'order-1' })
    mocks.requeueCalendar.mockResolvedValue({ id: 'visit-1' })
    mocks.employeeFindMany.mockResolvedValue([])
  })

  it('rejects a stale ADMIN session after the current User is demoted before ownership writes', async () => {
    const response = await patchOwnership(jsonRequest('http://test/api/installations/order-1/ownership', {
      action: 'SET_OWNERS', primaryEmployeeId: 'owner-1', backupEmployeeId: 'owner-2',
    }), orderParams)

    expect(response.status).toBe(403)
    expect(mocks.changeOwnership).not.toHaveBeenCalled()
  })

  it('rejects a disabled or deleted viewer before every ownership or delegation write', async () => {
    mocks.viewer = { role: 'EMPLOYEE', employeeId: null, employeeActive: false, authorized: false }

    const changed = await patchOwnership(jsonRequest('http://test/api/installations/order-1/ownership', {
      action: 'SET_OWNERS', primaryEmployeeId: 'owner-1', backupEmployeeId: 'owner-2',
    }), orderParams)
    const delegated = await patchOwnership(jsonRequest('http://test/api/installations/order-1/ownership', {
      action: 'CREATE_DELEGATION', delegateEmployeeId: 'owner-3', startsAt: '2026-08-24T08:00:00.000Z', reason: 'Test',
    }), orderParams)
    const ended = await patchOwnership(jsonRequest('http://test/api/installations/order-1/ownership', {
      action: 'END_DELEGATION', delegationId: 'delegation-1',
    }), orderParams)

    expect(changed.status).toBe(403)
    expect(delegated.status).toBe(403)
    expect(ended.status).toBe(403)
    expect(mocks.changeOwnership).not.toHaveBeenCalled()
    expect(mocks.createDelegation).not.toHaveBeenCalled()
    expect(mocks.endDelegation).not.toHaveBeenCalled()
  })

  it('allows ownership writes from a current MANAGER even when the session is stale', async () => {
    mocks.session = { user: { id: 'user-1', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    mocks.viewer = { role: 'MANAGER', employeeId: null, authorized: true }

    const response = await patchOwnership(jsonRequest('http://test/api/installations/order-1/ownership', {
      action: 'SET_OWNERS', primaryEmployeeId: 'owner-1', backupEmployeeId: 'owner-2',
    }), orderParams)

    expect(response.status).toBe(200)
    expect(mocks.changeOwnership).toHaveBeenCalledWith(expect.anything(), 'order-1', {
      primaryEmployeeId: 'owner-1', backupEmployeeId: 'owner-2',
    }, 'user-1')
  })

  it('rejects stale-admin fee approval after the current role is EMPLOYEE', async () => {
    const response = await postFee(jsonRequest('http://test/api/installations/order-1/visit-fee', { action: 'APPROVE_OVERRIDE' }), orderParams)

    expect(response.status).toBe(403)
    expect(mocks.approveFee).not.toHaveBeenCalled()
  })

  it('allows fee approval for a current ADMIN or MANAGER, not the session claim', async () => {
    mocks.session = { user: { id: 'user-1', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    mocks.viewer = { role: 'MANAGER', employeeId: null, authorized: true }

    const response = await postFee(jsonRequest('http://test/api/installations/order-1/visit-fee', { action: 'APPROVE_OVERRIDE' }), orderParams)

    expect(response.status).toBe(200)
    expect(mocks.approveFee).toHaveBeenCalledWith(expect.anything(), 'order-1', 'user-1')
  })

  it('rejects stale-admin force overwrite after the current role is EMPLOYEE', async () => {
    const response = await postCalendar(jsonRequest('http://test/api/installations/order-1/visits/visit-1/calendar', { forceOverwrite: true }), visitParams)

    expect(response.status).toBe(403)
    expect(mocks.requeueCalendar).not.toHaveBeenCalled()
  })

  it('allows force overwrite for a current MANAGER even when the session is stale', async () => {
    mocks.session = { user: { id: 'user-1', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    mocks.viewer = { role: 'MANAGER', employeeId: null, authorized: true }

    const response = await postCalendar(jsonRequest('http://test/api/installations/order-1/visits/visit-1/calendar', { forceOverwrite: true }), visitParams)

    expect(response.status).toBe(200)
    expect(mocks.requeueCalendar).toHaveBeenCalledWith(expect.anything(), 'order-1', 'visit-1', true, 'user-1')
  })

  it('redirects a disabled/deleted fresh viewer before querying active employees for the new-card page', async () => {
    mocks.viewer = { role: 'EMPLOYEE', employeeId: null, employeeActive: false, authorized: false }
    mocks.redirect.mockImplementation(() => { throw new Error('redirected') })

    await expect(NewInstallationOrderPage()).rejects.toThrow('redirected')

    expect(mocks.employeeFindMany).not.toHaveBeenCalled()
  })

  it('uses the current EMPLOYEE identity to lock primary owner rather than stale ADMIN session role', async () => {
    mocks.viewer = { role: 'EMPLOYEE', employeeId: 'employee-current', employeeActive: true, authorized: true }

    const result = await NewInstallationOrderPage()

    expect(mocks.employeeFindMany).toHaveBeenCalled()
    expect(result.props.primaryEmployeeIdLocked).toBe('employee-current')
  })
})
