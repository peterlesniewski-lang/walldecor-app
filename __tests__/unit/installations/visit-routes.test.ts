import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string; employeeId?: string | null } } | null,
  viewerFromSession: vi.fn(),
  accessible: vi.fn(),
  editable: vi.fn(),
  listVisits: vi.fn(),
  createVisit: vi.fn(),
  changeVisit: vi.fn(),
  requeueCalendar: vi.fn(),
  setAssignments: vi.fn(),
  VisitValidation: class InstallationVisitValidationError extends Error {
    constructor(public readonly fieldErrors: Record<string, string>) {
      super('Dane wizyty są niepoprawne.')
    }
  },
  VisitRevisionConflict: class InstallationVisitRevisionConflictError extends Error {},
  VisitArchivedOrder: class InstallationVisitArchivedOrderError extends Error {},
  VisitNotFound: class InstallationVisitNotFoundError extends Error {},
  ScopeValidation: class InstallationScopeAssignmentValidationError extends Error {},
  ScopeArchivedOrder: class InstallationScopeAssignmentArchivedOrderError extends Error {},
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/http-access', () => ({
  installationViewerFromSession: mocks.viewerFromSession,
  accessibleInstallationOrder: mocks.accessible,
}))
vi.mock('@/lib/installations/room-route-access', () => ({ editableInstallationOrder: mocks.editable }))
vi.mock('@/lib/installations/visit-service', () => ({
  listInstallationVisits: mocks.listVisits,
  createInstallationVisit: mocks.createVisit,
  changeInstallationVisit: mocks.changeVisit,
  requeueInstallationCalendar: mocks.requeueCalendar,
  InstallationVisitValidationError: mocks.VisitValidation,
  InstallationVisitRevisionConflictError: mocks.VisitRevisionConflict,
  InstallationVisitArchivedOrderError: mocks.VisitArchivedOrder,
  InstallationVisitNotFoundError: mocks.VisitNotFound,
}))
vi.mock('@/lib/installations/visit-schemas', () => ({
  InstallationVisitValidationError: mocks.VisitValidation,
}))
vi.mock('@/lib/installations/scope-assignment-service', () => ({
  setScopeInstallerAssignments: mocks.setAssignments,
  InstallationScopeAssignmentValidationError: mocks.ScopeValidation,
  InstallationScopeAssignmentArchivedOrderError: mocks.ScopeArchivedOrder,
}))

import { PUT as putScopeAssignments } from '@/app/api/installations/[id]/scope-assignments/[scopeId]/route'
import { GET as getVisits, POST as postVisits } from '@/app/api/installations/[id]/visits/route'
import { PATCH as patchVisit } from '@/app/api/installations/[id]/visits/[visitId]/route'
import { POST as postCalendar } from '@/app/api/installations/[id]/visits/[visitId]/calendar/route'

const orderParams = { params: Promise.resolve({ id: 'order-1' }) }
const visitParams = { params: Promise.resolve({ id: 'order-1', visitId: 'visit-1' }) }
const scopeParams = { params: Promise.resolve({ id: 'order-1', scopeId: 'scope-1' }) }
const request = (url: string, method: string, body?: unknown) => new NextRequest(url, {
  method,
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

describe('installation visit routes', () => {
  beforeEach(() => {
    mocks.session = { user: { id: 'user-1', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    mocks.viewerFromSession.mockReset().mockResolvedValue({ role: 'EMPLOYEE', employeeId: 'employee-1', employeeActive: true })
    mocks.accessible.mockReset().mockResolvedValue({ order: { id: 'order-1' } })
    mocks.editable.mockReset().mockResolvedValue({ order: { id: 'order-1' } })
    mocks.listVisits.mockReset().mockResolvedValue([{ id: 'visit-1' }])
    mocks.createVisit.mockReset().mockResolvedValue({ id: 'visit-1' })
    mocks.changeVisit.mockReset().mockResolvedValue({ id: 'visit-1', revision: 2 })
    mocks.requeueCalendar.mockReset().mockResolvedValue({ id: 'visit-1' })
    mocks.setAssignments.mockReset().mockResolvedValue({ scopeId: 'scope-1', employeeIds: ['installer-1'] })
  })

  it('returns 401 before loading visits when no server session exists', async () => {
    mocks.session = null

    const response = await getVisits(request('http://test/api/installations/order-1/visits', 'GET'), orderParams)

    expect(response.status).toBe(401)
    expect(mocks.viewerFromSession).not.toHaveBeenCalled()
    expect(mocks.listVisits).not.toHaveBeenCalled()
  })

  it('allows an assigned active installer to list only a card already admitted by shared read access', async () => {
    mocks.session = { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'installer-1' } }
    mocks.viewerFromSession.mockResolvedValue({ role: 'INSTALLER', employeeId: 'installer-1', employeeActive: true })
    mocks.listVisits.mockResolvedValue([{ id: 'visit-1', participants: [], syncState: { status: 'NOT_REQUESTED' } }])

    const response = await getVisits(request('http://test/api/installations/order-1/visits', 'GET'), orderParams)

    expect(response.status).toBe(200)
    expect(mocks.accessible).toHaveBeenCalledWith('order-1', expect.objectContaining({ role: 'INSTALLER', employeeId: 'installer-1' }))
    expect(mocks.listVisits).toHaveBeenCalledWith({}, 'order-1')
  })

  it('projects installer visit reads without notes, authors, emails, or calendar diagnostics', async () => {
    mocks.session = { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'installer-1' } }
    mocks.viewerFromSession.mockResolvedValue({ role: 'INSTALLER', employeeId: 'installer-1', employeeActive: true })
    mocks.listVisits.mockResolvedValueOnce([{
      id: 'visit-1', orderId: 'order-1', status: 'CONFIRMED', startsAt: new Date('2026-08-25T08:00:00.000Z'), endsAt: new Date('2026-08-25T10:00:00.000Z'), timezone: 'Europe/Warsaw',
      note: 'Kod do bramy 1234', revision: 2, confirmedAt: null, cancelledAt: null, completedAt: null, createdById: 'coordinator-user', createdAt: new Date('2026-08-24T08:00:00.000Z'), updatedAt: new Date('2026-08-24T08:00:00.000Z'), scopeIds: ['scope-1'],
      participants: [{ employeeId: 'installer-1', name: 'Jan Instalator', email: 'jan@example.com', scopeIds: ['scope-1'], inviteStatus: 'READY' }],
      syncState: { status: 'ATTENTION', externalId: 'event-1', externalUrl: 'https://calendar.example/event-1', externalEtag: 'etag-secret', lastErrorCode: 'AUTH_FAILED', lastErrorMessage: 'OAuth details', lastAttemptAt: new Date('2026-08-24T09:00:00.000Z'), lastSyncedAt: null },
    }])

    const response = await getVisits(request('http://test/api/installations/order-1/visits', 'GET'), orderParams)
    const [visit] = await response.json()

    expect(response.status).toBe(200)
    expect(visit).toMatchObject({ id: 'visit-1', status: 'CONFIRMED', scopeIds: ['scope-1'], participants: [{ name: 'Jan Instalator', inviteStatus: 'READY' }], syncState: { status: 'ATTENTION' } })
    expect(visit).not.toHaveProperty('note')
    expect(visit).not.toHaveProperty('createdById')
    expect(visit.participants[0]).not.toHaveProperty('email')
    expect(visit.syncState).not.toHaveProperty('externalEtag')
    expect(visit.syncState).not.toHaveProperty('lastErrorCode')
    expect(visit.syncState).not.toHaveProperty('lastErrorMessage')
    expect(visit.syncState).not.toHaveProperty('lastAttemptAt')
  })

  it('does not redact coordinator visit reads', async () => {
    mocks.listVisits.mockResolvedValueOnce([{
      id: 'visit-1', note: 'Koordynator widzi notatkę', createdById: 'coordinator-user', participants: [{ name: 'Jan', email: 'jan@example.com' }], syncState: { status: 'ATTENTION', externalEtag: 'etag' },
    }])

    const response = await getVisits(request('http://test/api/installations/order-1/visits', 'GET'), orderParams)
    const [visit] = await response.json()

    expect(visit).toMatchObject({ note: 'Koordynator widzi notatkę', createdById: 'coordinator-user', participants: [{ email: 'jan@example.com' }], syncState: { externalEtag: 'etag' } })
  })

  it.each([
    ['forbidden', 403],
    ['missing', 404],
  ])('returns %s from shared access when listing visits', async (_scenario, status) => {
    mocks.accessible.mockResolvedValue({ response: new Response(JSON.stringify({ error: 'blocked' }), { status }) })

    const response = await getVisits(request('http://test/api/installations/order-1/visits', 'GET'), orderParams)

    expect(response.status).toBe(status)
    expect(mocks.listVisits).not.toHaveBeenCalled()
  })

  it('does not let an installer create a visit', async () => {
    mocks.session = { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'installer-1' } }
    mocks.editable.mockResolvedValue({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) })

    const response = await postVisits(request('http://test/api/installations/order-1/visits', 'POST', { scopeIds: [] }), orderParams)

    expect(response.status).toBe(403)
    expect(mocks.createVisit).not.toHaveBeenCalled()
  })

  it('maps malformed create JSON to 400 without invoking the service', async () => {
    const response = await postVisits(new NextRequest('http://test/api/installations/order-1/visits', { method: 'POST', body: '{' }), orderParams)

    expect(response.status).toBe(400)
    expect(mocks.createVisit).not.toHaveBeenCalled()
  })

  it('maps create validation failures to 400 with field errors', async () => {
    mocks.createVisit.mockRejectedValueOnce(new mocks.VisitValidation({ scopeIds: 'Wybierz zakres.' }))

    const response = await postVisits(request('http://test/api/installations/order-1/visits', 'POST', { scopeIds: [] }), orderParams)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ fieldErrors: { scopeIds: 'Wybierz zakres.' } })
  })

  it('creates a visit with the authenticated actor and Promise params', async () => {
    const response = await postVisits(request('http://test/api/installations/order-1/visits', 'POST', { scopeIds: ['scope-1'] }), orderParams)

    expect(response.status).toBe(201)
    expect(mocks.createVisit).toHaveBeenCalledWith({}, 'order-1', { scopeIds: ['scope-1'] }, 'user-1')
  })

  it('changes a visit with the authenticated actor', async () => {
    const payload = { action: 'CONFIRM', expectedRevision: 1, startsAt: '2026-08-25T08:00:00.000Z', endsAt: '2026-08-25T10:00:00.000Z', scopeIds: ['scope-1'] }

    const response = await patchVisit(request('http://test/api/installations/order-1/visits/visit-1', 'PATCH', payload), visitParams)

    expect(response.status).toBe(200)
    expect(mocks.changeVisit).toHaveBeenCalledWith({}, 'order-1', 'visit-1', payload, 'user-1')
  })

  it('maps visit domain and revision conflicts without leaking implementation details', async () => {
    mocks.changeVisit.mockRejectedValueOnce(new mocks.VisitValidation({ action: 'Niedozwolona akcja.' }))
    const invalid = await patchVisit(request('http://test/api/installations/order-1/visits/visit-1', 'PATCH', { action: 'CANCEL', expectedRevision: 1 }), visitParams)
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ fieldErrors: { action: 'Niedozwolona akcja.' } })

    mocks.changeVisit.mockRejectedValueOnce(new mocks.VisitRevisionConflict())
    const conflict = await patchVisit(request('http://test/api/installations/order-1/visits/visit-1', 'PATCH', { action: 'CANCEL', expectedRevision: 1 }), visitParams)
    expect(conflict.status).toBe(409)

    mocks.changeVisit.mockRejectedValueOnce(new mocks.VisitArchivedOrder())
    const archived = await patchVisit(request('http://test/api/installations/order-1/visits/visit-1', 'PATCH', { action: 'CANCEL', expectedRevision: 1 }), visitParams)
    expect(archived.status).toBe(409)
  })

  it('returns 404 when the visit does not belong to the accessible order', async () => {
    mocks.changeVisit.mockRejectedValueOnce(new mocks.VisitNotFound())

    const response = await patchVisit(request('http://test/api/installations/order-1/visits/visit-1', 'PATCH', { action: 'CANCEL', expectedRevision: 1 }), visitParams)

    expect(response.status).toBe(404)
  })

  it('reserves force overwrite to admin and manager while allowing an editable owner to requeue normally', async () => {
    const forbidden = await postCalendar(request('http://test/api/installations/order-1/visits/visit-1/calendar', 'POST', { forceOverwrite: true }), visitParams)
    expect(forbidden.status).toBe(403)
    expect(mocks.requeueCalendar).not.toHaveBeenCalled()

    const ownerRequeue = await postCalendar(request('http://test/api/installations/order-1/visits/visit-1/calendar', 'POST', { forceOverwrite: false }), visitParams)
    expect(ownerRequeue.status).toBe(200)
    expect(mocks.requeueCalendar).toHaveBeenLastCalledWith({}, 'order-1', 'visit-1', false, 'user-1')

    mocks.session = { user: { id: 'manager-user', role: 'MANAGER', employeeId: 'manager-1' } }
    const managerRequeue = await postCalendar(request('http://test/api/installations/order-1/visits/visit-1/calendar', 'POST', { forceOverwrite: true }), visitParams)
    expect(managerRequeue.status).toBe(200)
    expect(mocks.requeueCalendar).toHaveBeenLastCalledWith({}, 'order-1', 'visit-1', true, 'manager-user')
  })

  it('maps requeue validation and archived-order errors to the public 400 and 409 contract', async () => {
    mocks.requeueCalendar.mockRejectedValueOnce(new mocks.VisitValidation({ form: 'Brak zadania.' }))
    const invalid = await postCalendar(request('http://test/api/installations/order-1/visits/visit-1/calendar', 'POST', { forceOverwrite: false }), visitParams)
    expect(invalid.status).toBe(400)

    mocks.requeueCalendar.mockRejectedValueOnce(new mocks.VisitArchivedOrder())
    const archived = await postCalendar(request('http://test/api/installations/order-1/visits/visit-1/calendar', 'POST', { forceOverwrite: false }), visitParams)
    expect(archived.status).toBe(409)
  })

  it('validates scope assignment body before the service', async () => {
    const badJson = await putScopeAssignments(new NextRequest('http://test/api/installations/order-1/scope-assignments/scope-1', { method: 'PUT', body: '{' }), scopeParams)
    expect(badJson.status).toBe(400)

    const invalid = await putScopeAssignments(request('http://test/api/installations/order-1/scope-assignments/scope-1', 'PUT', { employeeIds: 'installer-1' }), scopeParams)
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ fieldErrors: expect.any(Object) })
    expect(mocks.setAssignments).not.toHaveBeenCalled()
  })

  it('updates scope installers, maps domain validation, and preserves archive conflicts', async () => {
    const success = await putScopeAssignments(request('http://test/api/installations/order-1/scope-assignments/scope-1', 'PUT', { employeeIds: ['installer-1'] }), scopeParams)
    expect(success.status).toBe(200)
    expect(mocks.setAssignments).toHaveBeenCalledWith({}, 'order-1', 'scope-1', ['installer-1'], 'user-1')

    mocks.setAssignments.mockRejectedValueOnce(new mocks.ScopeValidation('Nieaktywny pracownik.'))
    const invalid = await putScopeAssignments(request('http://test/api/installations/order-1/scope-assignments/scope-1', 'PUT', { employeeIds: ['installer-1'] }), scopeParams)
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ fieldErrors: { form: 'Nieaktywny pracownik.' } })

    mocks.setAssignments.mockRejectedValueOnce(new mocks.ScopeArchivedOrder())
    const archived = await putScopeAssignments(request('http://test/api/installations/order-1/scope-assignments/scope-1', 'PUT', { employeeIds: ['installer-1'] }), scopeParams)
    expect(archived.status).toBe(409)

    mocks.setAssignments.mockRejectedValueOnce(new mocks.VisitRevisionConflict())
    const concurrentRefresh = await putScopeAssignments(request('http://test/api/installations/order-1/scope-assignments/scope-1', 'PUT', { employeeIds: ['installer-1'] }), scopeParams)
    expect(concurrentRefresh.status).toBe(409)
  })

  it('rethrows unexpected service failures instead of turning them into silent 500 responses', async () => {
    mocks.createVisit.mockRejectedValueOnce(new Error('create telemetry'))
    await expect(postVisits(request('http://test/api/installations/order-1/visits', 'POST', { scopeIds: [] }), orderParams)).rejects.toThrow('create telemetry')

    mocks.changeVisit.mockRejectedValueOnce(new Error('change telemetry'))
    await expect(patchVisit(request('http://test/api/installations/order-1/visits/visit-1', 'PATCH', { action: 'CANCEL', expectedRevision: 1 }), visitParams)).rejects.toThrow('change telemetry')

    mocks.requeueCalendar.mockRejectedValueOnce(new Error('calendar telemetry'))
    await expect(postCalendar(request('http://test/api/installations/order-1/visits/visit-1/calendar', 'POST', { forceOverwrite: false }), visitParams)).rejects.toThrow('calendar telemetry')

    mocks.setAssignments.mockRejectedValueOnce(new Error('assignment telemetry'))
    await expect(putScopeAssignments(request('http://test/api/installations/order-1/scope-assignments/scope-1', 'PUT', { employeeIds: [] }), scopeParams)).rejects.toThrow('assignment telemetry')
  })
})
