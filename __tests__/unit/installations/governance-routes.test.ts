import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string; employeeId?: string | null } } | null,
  ownership: vi.fn(),
  delegation: vi.fn(),
  endDelegation: vi.fn(),
  defaultFee: vi.fn(),
  overrideFee: vi.fn(),
  approveFee: vi.fn(),
  rejectFee: vi.fn(),
  editable: vi.fn(),
  viewerFromSession: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/http-access', () => ({ installationViewerFromSession: mocks.viewerFromSession }))
vi.mock('@/lib/installations/delegation-service', () => ({
  changeInstallationOwnership: mocks.ownership,
  createInstallationDelegation: mocks.delegation,
  endInstallationDelegation: mocks.endDelegation,
  selectDefaultInstallationVisitFee: mocks.defaultFee,
  requestInstallationVisitFeeOverride: mocks.overrideFee,
  approveInstallationVisitFeeOverride: mocks.approveFee,
  rejectInstallationVisitFeeOverride: mocks.rejectFee,
  InstallationGovernanceValidationError: class InstallationGovernanceValidationError extends Error { fieldErrors = { form: 'bad' } },
}))
vi.mock('@/lib/installations/room-route-access', () => ({ editableInstallationOrder: mocks.editable }))

import { PATCH as ownership } from '@/app/api/installations/[id]/ownership/route'
import { POST as visitFee } from '@/app/api/installations/[id]/visit-fee/route'

const params = { params: Promise.resolve({ id: 'order-1' }) }
const request = (url: string, body: unknown) => new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('installation governance routes', () => {
  beforeEach(() => {
    mocks.session = { user: { id: 'admin-user', role: 'ADMIN', employeeId: 'employee-admin' } }
    for (const mock of [mocks.ownership, mocks.delegation, mocks.endDelegation, mocks.defaultFee, mocks.overrideFee, mocks.approveFee, mocks.rejectFee]) {
      mock.mockReset().mockResolvedValue({ id: 'result-1' })
    }
    mocks.viewerFromSession.mockReset().mockImplementation(async () => ({
      role: mocks.session!.user.role,
      employeeId: mocks.session!.user.employeeId ?? null,
      employeeActive: mocks.session!.user.role === 'EMPLOYEE',
      authorized: true,
    }))
    mocks.editable.mockReset().mockImplementation(async () => ({
      order: { id: 'order-1' },
      viewer: {
        role: mocks.session!.user.role,
        employeeId: mocks.session!.user.employeeId ?? null,
        employeeActive: mocks.session!.user.role === 'EMPLOYEE',
        authorized: true,
      },
    }))
  })

  it('allows only admin or manager to change named owners and create/end a delegation', async () => {
    const changed = await ownership(request('http://test/api/installations/order-1/ownership', {
      action: 'SET_OWNERS', primaryEmployeeId: 'employee-a', backupEmployeeId: 'employee-b',
    }), params)
    expect(changed.status).toBe(200)
    expect(mocks.ownership).toHaveBeenCalledWith({}, 'order-1', { primaryEmployeeId: 'employee-a', backupEmployeeId: 'employee-b' }, 'admin-user')

    const delegated = await ownership(request('http://test/api/installations/order-1/ownership', {
      action: 'CREATE_DELEGATION', delegateEmployeeId: 'employee-c', startsAt: '2026-08-23T08:00:00.000Z', endsAt: '2026-08-24T08:00:00.000Z', reason: 'Zastępstwo',
    }), params)
    expect(delegated.status).toBe(201)
    expect(mocks.delegation).toHaveBeenCalledWith({}, 'order-1', expect.objectContaining({ delegateEmployeeId: 'employee-c' }), 'admin-user')

    mocks.session = { user: { id: 'employee-user', role: 'EMPLOYEE', employeeId: 'employee-a' } }
    const forbidden = await ownership(request('http://test/api/installations/order-1/ownership', {
      action: 'SET_OWNERS', primaryEmployeeId: 'employee-a', backupEmployeeId: 'employee-b',
    }), params)
    expect(forbidden.status).toBe(403)
    expect(mocks.ownership).toHaveBeenCalledTimes(1)
  })

  it('lets an owner choose/request fee but reserves approval for admin or manager', async () => {
    mocks.session = { user: { id: 'owner-user', role: 'EMPLOYEE', employeeId: 'employee-owner' } }
    const defaultResult = await visitFee(request('http://test/api/installations/order-1/visit-fee', { action: 'USE_DEFAULT' }), params)
    expect(defaultResult.status).toBe(200)
    expect(mocks.defaultFee).toHaveBeenCalledWith({}, 'order-1', 'owner-user')

    const pending = await visitFee(request('http://test/api/installations/order-1/visit-fee', {
      action: 'REQUEST_OVERRIDE', grossAmount: '299.00', reason: 'Nietypowy dojazd',
    }), params)
    expect(pending.status).toBe(202)
    expect(mocks.overrideFee).toHaveBeenCalledWith({}, 'order-1', { grossAmount: '299.00', reason: 'Nietypowy dojazd' }, 'owner-user')

    const forbidden = await visitFee(request('http://test/api/installations/order-1/visit-fee', { action: 'APPROVE_OVERRIDE' }), params)
    expect(forbidden.status).toBe(403)

    mocks.session = { user: { id: 'manager-user', role: 'MANAGER', employeeId: 'employee-manager' } }
    const approved = await visitFee(request('http://test/api/installations/order-1/visit-fee', { action: 'APPROVE_OVERRIDE' }), params)
    expect(approved.status).toBe(200)
    expect(mocks.approveFee).toHaveBeenCalledWith({}, 'order-1', 'manager-user')
  })
})
