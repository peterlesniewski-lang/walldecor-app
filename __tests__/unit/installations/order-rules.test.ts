import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  InstallationOrderValidationError,
  parseCreateInstallationOrder,
  parseUpdateInstallationOrder,
} from '@/lib/installations/schemas'
import {
  canAccessInstallationOrder,
  canArchiveInstallationOrder,
  canEditInstallationOrder,
} from '@/lib/installations/access'
import {
  archiveInstallationOrder,
  createInstallationOrder,
  deactivateEmployeeIfNoActiveInstallationOrder,
  getInstallationOrder,
  listInstallationOrders,
  updateInstallationOrder,
} from '@/lib/installations/order-service'
import { GET as listOrders, POST as createOrder } from '@/app/api/installations/route'
import {
  DELETE as archiveOrder,
  GET as getOrder,
  PATCH as updateOrder,
} from '@/app/api/installations/[id]/route'
import { DELETE as deleteEmployee, PATCH as updateEmployee } from '@/app/api/hr/employees/[id]/route'
import { InstallationOrderForm } from '@/components/installations/order-form'
import { InstallationOrderList } from '@/components/installations/order-list'
import { InstallationOrderDetail } from '@/components/installations/order-detail'

const mockRouterPush = vi.fn()
const mockRouterRefresh = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/installations/order-service', () => ({
  archiveInstallationOrder: vi.fn(),
  createInstallationOrder: vi.fn(),
  deactivateEmployeeIfNoActiveInstallationOrder: vi.fn(),
  getInstallationOrder: vi.fn(),
  listInstallationOrders: vi.fn(),
  updateInstallationOrder: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    employee: { findUnique: vi.fn(), count: vi.fn(), delete: vi.fn(), update: vi.fn() },
    timeEntry: { count: vi.fn() },
    leaveRequestNew: { count: vi.fn() },
    contract: { count: vi.fn() },
    additionalContract: { count: vi.fn() },
    salaryHistory: { count: vi.fn() },
    leaveRequest: { count: vi.fn() },
    workTimeRecord: { count: vi.fn() },
    workSchedule: { count: vi.fn() },
    overtimeRequest: { count: vi.fn() },
    user: { count: vi.fn() },
    leaveBalanceNew: { deleteMany: vi.fn() },
    leaveBalance: { deleteMany: vi.fn() },
    installationOrder: { count: vi.fn() },
    installationDelegation: { count: vi.fn() },
    installationOrderInstaller: { count: vi.fn() },
  },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, refresh: mockRouterRefresh }),
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockArchiveInstallationOrder = vi.mocked(archiveInstallationOrder)
const mockCreateInstallationOrder = vi.mocked(createInstallationOrder)
const mockDeactivateEmployeeIfNoActiveInstallationOrder = vi.mocked(deactivateEmployeeIfNoActiveInstallationOrder)
const mockGetInstallationOrder = vi.mocked(getInstallationOrder)
const mockListInstallationOrders = vi.mocked(listInstallationOrders)
const mockUpdateInstallationOrder = vi.mocked(updateInstallationOrder)

const validOrder = {
  client: {
    name: 'Anna Kowalska',
    email: 'anna@example.pl',
    phone: '+48 501 234 567',
  },
  address: {
    street: 'Puławska',
    buildingNumber: '17',
    postalCode: '02-515',
    city: 'Warszawa',
  },
  primaryEmployeeId: 'employee-primary',
  backupEmployeeId: 'employee-backup',
}

describe('installation order rules', () => {
  it('rejects a missing backup owner with a field-level Polish error', async () => {
    await expect(parseCreateInstallationOrder({ ...validOrder, backupEmployeeId: '' })).rejects.toMatchObject({
      fieldErrors: { backupEmployeeId: 'Wybierz zastępcę opiekuna.' },
    } satisfies Partial<InstallationOrderValidationError>)
  })

  it('rejects the same employee as primary and backup', async () => {
    await expect(parseCreateInstallationOrder({ ...validOrder, backupEmployeeId: validOrder.primaryEmployeeId })).rejects.toMatchObject({
      fieldErrors: { backupEmployeeId: 'Opiekun i zastępca muszą być różnymi osobami.' },
    } satisfies Partial<InstallationOrderValidationError>)
  })

  it('rejects an inactive owner after checking the employee directory', async () => {
    await expect(parseCreateInstallationOrder(validOrder, {
      isEmployeeActive: async (employeeId) => employeeId !== 'employee-backup',
    })).rejects.toMatchObject({
      fieldErrors: { backupEmployeeId: 'Wybrany zastępca nie jest aktywnym pracownikiem.' },
    } satisfies Partial<InstallationOrderValidationError>)
  })

  it('rejects empty client and address data as well as an invalid phone and email', async () => {
    await expect(parseCreateInstallationOrder({
      ...validOrder,
      client: { name: '', email: 'nie-email', phone: '123' },
      address: { street: '', buildingNumber: '', postalCode: '12-3', city: '' },
    })).rejects.toMatchObject({
      fieldErrors: expect.objectContaining({
        'client.name': 'Podaj imię i nazwisko lub nazwę klienta.',
        'client.email': 'Podaj poprawny adres e-mail.',
        'client.phone': 'Podaj poprawny numer telefonu.',
        'address.street': 'Podaj ulicę.',
        'address.postalCode': 'Podaj kod pocztowy w formacie 00-000.',
        'address.city': 'Podaj miejscowość.',
      }),
    } satisfies Partial<InstallationOrderValidationError>)
  })

  it('removes empty optional status and date values before persistence', async () => {
    const parsed = await parseCreateInstallationOrder({
      ...validOrder,
      status: '',
      scheduledAt: '',
      externalSystem: '',
      externalId: '',
    })

    expect(parsed).not.toHaveProperty('status')
    expect(parsed).not.toHaveProperty('scheduledAt')
    expect(parsed).not.toHaveProperty('externalSystem')
    expect(parsed).not.toHaveProperty('externalId')
  })

  it('reserves ARCHIVED for the archive endpoint instead of regular create or update payloads', async () => {
    await expect(parseCreateInstallationOrder({ ...validOrder, status: 'ARCHIVED' })).rejects.toMatchObject({
      fieldErrors: { status: 'Status ARCHIVED jest ustawiany wyłącznie podczas archiwizacji.' },
    } satisfies Partial<InstallationOrderValidationError>)
    expect(() => parseUpdateInstallationOrder({ status: 'ARCHIVED' })).toThrow(InstallationOrderValidationError)
    try {
      parseUpdateInstallationOrder({ status: 'ARCHIVED' })
    } catch (error) {
      expect(error).toMatchObject({
      fieldErrors: { status: 'Status ARCHIVED jest ustawiany wyłącznie podczas archiwizacji.' },
      } satisfies Partial<InstallationOrderValidationError>)
    }
  })

  it('keeps explicit null and empty optional address fields as a clear operation in an update payload', () => {
    expect(parseUpdateInstallationOrder({
      address: { buildingNumber: null, apartmentNumber: '' },
    })).toEqual({
      address: { buildingNumber: null, apartmentNumber: null },
    })
  })
})

describe('installation order access policy', () => {
  const order = {
    primaryEmployeeId: 'primary',
    backupEmployeeId: 'backup',
    installerAssignments: [{ employeeId: 'installer-a' }],
    scopeAssignments: [{ employeeId: 'installer-b' }],
    delegations: [
      {
        delegateEmployeeId: 'delegate-active',
        startsAt: new Date('2026-08-20T08:00:00.000Z'),
        endsAt: new Date('2026-08-23T18:00:00.000Z'),
        endedAt: null,
      },
      {
        delegateEmployeeId: 'delegate-ended',
        startsAt: new Date('2026-08-20T08:00:00.000Z'),
        endsAt: new Date('2026-08-23T18:00:00.000Z'),
        endedAt: new Date('2026-08-21T12:00:00.000Z'),
      },
    ],
  } as unknown as Parameters<typeof canAccessInstallationOrder>[1]
  const now = new Date('2026-08-22T12:00:00.000Z')

  it('grants full access to admin and manager', () => {
    expect(canAccessInstallationOrder({ role: 'ADMIN', employeeId: null }, order, now)).toBe(true)
    expect(canAccessInstallationOrder({ role: 'MANAGER', employeeId: null }, order, now)).toBe(true)
  })

  it('grants employee access only to primary, backup, or an active delegate', () => {
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'primary', employeeActive: true }, order, now)).toBe(true)
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'backup', employeeActive: true }, order, now)).toBe(true)
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'delegate-active', employeeActive: true }, order, now)).toBe(true)
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'delegate-ended', employeeActive: true }, order, now)).toBe(false)
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'outsider', employeeActive: true }, order, now)).toBe(false)
  })

  it('grants installer access only to their own explicitly assigned installer record', () => {
    expect(canAccessInstallationOrder({ role: 'INSTALLER', employeeId: 'installer-a', employeeActive: true }, order, now)).toBe(true)
    expect(canAccessInstallationOrder({ role: 'INSTALLER', employeeId: 'installer-c', employeeActive: true }, order, now)).toBe(false)
  })

  it('grants installer access through an installer assignment on a work scope', () => {
    expect(canAccessInstallationOrder({ role: 'INSTALLER', employeeId: 'installer-b', employeeActive: true }, order, now)).toBe(true)
  })

  it('fails closed for an inactive installer with an explicit assignment', () => {
    expect(canAccessInstallationOrder({ role: 'INSTALLER', employeeId: 'installer-a', employeeActive: false }, order, now)).toBe(false)
  })

  it('fails closed for an inactive installer with a scope assignment', () => {
    expect(canAccessInstallationOrder({ role: 'INSTALLER', employeeId: 'installer-b', employeeActive: false }, order, now)).toBe(false)
  })

  it('fails closed when an EMPLOYEE account is no longer active', () => {
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'primary', employeeActive: false }, order, now)).toBe(false)
  })

  it('allows an active delegate to edit operations, but not ownership or archiving', () => {
    const delegate = { role: 'EMPLOYEE' as const, employeeId: 'delegate-active', employeeActive: true }

    expect(canAccessInstallationOrder(delegate, order, now)).toBe(true)
    expect(canEditInstallationOrder(delegate, order, now)).toBe(true)
    expect(canArchiveInstallationOrder(delegate, order, now)).toBe(false)
  })

  it('allows primary and backup to archive, but never an installer', () => {
    expect(canArchiveInstallationOrder({ role: 'EMPLOYEE', employeeId: 'primary', employeeActive: true }, order, now)).toBe(true)
    expect(canArchiveInstallationOrder({ role: 'EMPLOYEE', employeeId: 'backup', employeeActive: true }, order, now)).toBe(true)
    expect(canEditInstallationOrder({ role: 'INSTALLER', employeeId: 'installer-a' }, order, now)).toBe(false)
    expect(canArchiveInstallationOrder({ role: 'INSTALLER', employeeId: 'installer-a' }, order, now)).toBe(false)
  })
})

const apiOrder = {
  id: 'order-1',
  number: 'MON-20260822-1234',
  status: 'DRAFT',
  clientId: 'client-1',
  client: validOrder.client,
  addressStreet: validOrder.address.street,
  addressBuildingNumber: validOrder.address.buildingNumber,
  addressApartmentNumber: null,
  addressPostalCode: validOrder.address.postalCode,
  addressCity: validOrder.address.city,
  primaryEmployeeId: 'primary',
  backupEmployeeId: 'backup',
  installerAssignments: [],
  scopeAssignments: [],
  scheduledAt: null,
  externalSystem: null,
  externalId: null,
  archivedAt: null,
  createdAt: new Date('2026-08-22T10:00:00.000Z'),
  updatedAt: new Date('2026-08-22T10:00:00.000Z'),
  primaryEmployee: { id: 'primary', firstName: 'Anna', lastName: 'Opiekun', email: 'anna@example.pl', active: true },
  backupEmployee: { id: 'backup', firstName: 'Bartek', lastName: 'Zastępca', email: 'bartek@example.pl', active: true },
  delegations: [],
  auditEvents: [],
  clientFormStatus: { code: 'NO_FORM' as const, label: 'Brak formularza', requiresClarification: false },
}

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'INSTALLER', employeeId: string | null = null) {
  return {
    user: { id: `${role.toLowerCase()}-user`, name: role, email: `${role.toLowerCase()}@example.pl`, role, employeeId },
    expires: '',
  }
}

function jsonRequest(body: unknown, method = 'POST') {
  return new NextRequest('http://localhost/api/installations', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('installation order API boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: 'primary', active: true } as never)
  })

  it('returns 401 without a session before listing orders', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await listOrders(new NextRequest('http://localhost/api/installations'))

    expect(response.status).toBe(401)
    expect(mockListInstallationOrders).not.toHaveBeenCalled()
  })

  it('filters an employee list to installation orders they may access', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'primary') as never)
    mockListInstallationOrders.mockResolvedValue([apiOrder] as never)

    const response = await listOrders(new NextRequest('http://localhost/api/installations'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.map((order: { id: string }) => order.id)).toEqual(['order-1'])
    expect(mockListInstallationOrders).toHaveBeenCalledWith(prisma, {
      viewer: { role: 'EMPLOYEE', employeeId: 'primary', employeeActive: true },
    })
  })

  it('returns field-level 400 errors for an invalid create payload', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN') as never)
    mockCreateInstallationOrder.mockRejectedValue(new InstallationOrderValidationError({
      'client.email': 'Podaj poprawny adres e-mail.',
    }))

    const response = await createOrder(jsonRequest({ ...validOrder, client: { ...validOrder.client, email: 'zły' } }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Dane zlecenia są niepoprawne.',
      fieldErrors: { 'client.email': 'Podaj poprawny adres e-mail.' },
    })
  })

  it('returns 403 to an installer before a create mutation', async () => {
    mockGetServerSession.mockResolvedValue(session('INSTALLER', 'installer-1') as never)

    const response = await createOrder(jsonRequest(validOrder))

    expect(response.status).toBe(403)
    expect(mockCreateInstallationOrder).not.toHaveBeenCalled()
  })

  it('allows an employee to create only an order where they are the primary owner', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'employee-self') as never)
    mockCreateInstallationOrder.mockResolvedValue(apiOrder as never)

    const response = await createOrder(jsonRequest({ ...validOrder, primaryEmployeeId: 'employee-self' }))

    expect(response.status).toBe(201)
    expect(mockCreateInstallationOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      primaryEmployeeId: 'employee-self',
    }), 'employee-user')
  })

  it('returns 403 before service invocation when an employee creates an order for another primary owner', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'employee-self') as never)

    const response = await createOrder(jsonRequest({ ...validOrder, primaryEmployeeId: 'employee-other' }))

    expect(response.status).toBe(403)
    expect(mockCreateInstallationOrder).not.toHaveBeenCalled()
  })

  it('returns 403 before service invocation when an employee lacks an employeeId', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE') as never)

    const response = await createOrder(jsonRequest(validOrder))

    expect(response.status).toBe(403)
    expect(mockCreateInstallationOrder).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'null', payload: null },
    { label: 'tablicę', payload: [] },
    { label: 'string', payload: 'nie formularz' },
    { label: 'liczbę', payload: 42 },
  ])('returns form-level 400 instead of 403 or 500 for EMPLOYEE body shaped as $label', async ({ payload }) => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'employee-self') as never)

    const response = await createOrder(jsonRequest(payload))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Dane zlecenia są niepoprawne.',
      fieldErrors: { form: 'Prześlij formularz zlecenia w poprawnym formacie.' },
    })
    expect(mockCreateInstallationOrder).not.toHaveBeenCalled()
  })

  it.each(['ADMIN', 'MANAGER'] as const)('allows %s to create with arbitrary active owners', async (role) => {
    mockGetServerSession.mockResolvedValue(session(role) as never)
    mockCreateInstallationOrder.mockResolvedValue(apiOrder as never)

    const response = await createOrder(jsonRequest({ ...validOrder, primaryEmployeeId: 'employee-a', backupEmployeeId: 'employee-b' }))

    expect(response.status).toBe(201)
    expect(mockCreateInstallationOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      primaryEmployeeId: 'employee-a', backupEmployeeId: 'employee-b',
    }), `${role.toLowerCase()}-user`)
  })

  it('does not disclose an order to an unrelated employee', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'outsider') as never)
    mockGetInstallationOrder.mockResolvedValue(apiOrder as never)

    const response = await getOrder(new NextRequest('http://localhost/api/installations/order-1'), {
      params: Promise.resolve({ id: 'order-1' }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
  })

  it('fails closed for an inactive EMPLOYEE even if their id is a card owner', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'primary') as never)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: 'primary', active: false } as never)
    mockGetInstallationOrder.mockResolvedValue(apiOrder as never)

    const response = await getOrder(new NextRequest('http://localhost/api/installations/order-1'), {
      params: Promise.resolve({ id: 'order-1' }),
    })

    expect(response.status).toBe(403)
  })

  it('checks a session independently before patching or archiving', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const context = { params: Promise.resolve({ id: 'order-1' }) }

    const patchResponse = await updateOrder(jsonRequest(validOrder, 'PATCH'), context)
    const deleteResponse = await archiveOrder(new NextRequest('http://localhost/api/installations/order-1', { method: 'DELETE' }), context)

    expect(patchResponse.status).toBe(401)
    expect(deleteResponse.status).toBe(401)
    expect(mockUpdateInstallationOrder).not.toHaveBeenCalled()
    expect(mockArchiveInstallationOrder).not.toHaveBeenCalled()
  })

  it('updates an order for its primary employee', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'primary') as never)
    mockGetInstallationOrder.mockResolvedValue(apiOrder as never)
    mockUpdateInstallationOrder.mockResolvedValue({ ...apiOrder, addressBuildingNumber: '19' } as never)

    const response = await updateOrder(jsonRequest({ address: { buildingNumber: '19' } }, 'PATCH'), {
      params: Promise.resolve({ id: 'order-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockUpdateInstallationOrder).toHaveBeenCalledWith(expect.anything(), 'order-1', { address: { buildingNumber: '19' } }, 'employee-user')
  })

  it('lets an active delegate edit operating data but blocks both owner changes and archive', async () => {
    vi.setSystemTime(new Date('2026-08-23T17:00:00.000Z'))
    try {
      const delegatedOrder = {
        ...apiOrder,
        primaryEmployeeId: 'other-primary',
        backupEmployeeId: 'other-backup',
        delegations: [{
          delegateEmployeeId: 'delegate-active',
          startsAt: new Date('2026-08-20T08:00:00.000Z'),
          endsAt: new Date('2026-08-23T18:00:00.000Z'),
          endedAt: null,
        }],
      }
      mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'delegate-active') as never)
      vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: 'delegate-active', active: true } as never)
      mockGetInstallationOrder.mockResolvedValue(delegatedOrder as never)
      mockUpdateInstallationOrder.mockResolvedValue(delegatedOrder as never)

      const editResponse = await updateOrder(jsonRequest({ address: { city: 'Piaseczno' } }, 'PATCH'), {
        params: Promise.resolve({ id: 'order-1' }),
      })
      const ownerResponse = await updateOrder(jsonRequest({ primaryEmployeeId: 'other-owner' }, 'PATCH'), {
        params: Promise.resolve({ id: 'order-1' }),
      })
      const archiveResponse = await archiveOrder(new NextRequest('http://localhost/api/installations/order-1', { method: 'DELETE' }), {
        params: Promise.resolve({ id: 'order-1' }),
      })

      expect(editResponse.status).toBe(200)
      expect(ownerResponse.status).toBe(403)
      expect(archiveResponse.status).toBe(403)
      expect(mockUpdateInstallationOrder).toHaveBeenCalledTimes(1)
      expect(mockArchiveInstallationOrder).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('employee deletion installation protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: 'employee-1' } as never)
    for (const count of [
      prisma.timeEntry.count,
      prisma.leaveRequestNew.count,
      prisma.contract.count,
      prisma.additionalContract.count,
      prisma.salaryHistory.count,
      prisma.leaveRequest.count,
      prisma.workTimeRecord.count,
      prisma.workSchedule.count,
      prisma.overtimeRequest.count,
      prisma.user.count,
      prisma.employee.count,
      prisma.installationOrder.count,
      prisma.installationDelegation.count,
      prisma.installationOrderInstaller.count,
    ]) {
      vi.mocked(count).mockResolvedValue(0 as never)
    }
  })

  it('returns 409 instead of attempting a hard delete for an installation owner', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN') as never)
    vi.mocked(prisma.installationOrder.count).mockResolvedValue(1 as never)

    const response = await deleteEmployee(new NextRequest('http://localhost/api/hr/employees/employee-1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'employee-1' }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Pracownik ma dane historyczne. Użyj opcji "Ukryj".' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 409 instead of attempting a hard delete for an assigned installer', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN') as never)
    vi.mocked(prisma.installationOrderInstaller.count).mockResolvedValue(1 as never)

    const response = await deleteEmployee(new NextRequest('http://localhost/api/hr/employees/employee-1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'employee-1' }),
    })

    expect(response.status).toBe(409)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 409 before deactivating an owner of an active installation order', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN') as never)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: 'employee-1', active: true } as never)
    mockDeactivateEmployeeIfNoActiveInstallationOrder.mockResolvedValue(0 as never)

    const response = await updateEmployee(jsonRequest({ active: false }, 'PATCH'), {
      params: Promise.resolve({ id: 'employee-1' }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Pracownik jest opiekunem aktywnych kart montaży. Najpierw przypnij karty do innego opiekuna.',
    })
    expect(mockDeactivateEmployeeIfNoActiveInstallationOrder).toHaveBeenCalledWith(prisma, 'employee-1')
    expect(prisma.installationOrder.count).not.toHaveBeenCalled()
    expect(prisma.employee.update).not.toHaveBeenCalled()
  })

  it('keeps an employee active when an order appears during an atomic deactivation attempt', async () => {
    let employeeActive = true
    let activeOrderAppeared = false
    mockGetServerSession.mockResolvedValue(session('ADMIN') as never)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: 'employee-1', active: true } as never)
    mockDeactivateEmployeeIfNoActiveInstallationOrder.mockImplementation(async () => {
      activeOrderAppeared = true
      return 0
    })
    vi.mocked(prisma.employee.update).mockImplementation(async () => {
      employeeActive = false
      return { id: 'employee-1', active: false } as never
    })

    const response = await updateEmployee(jsonRequest({ active: false }, 'PATCH'), {
      params: Promise.resolve({ id: 'employee-1' }),
    })

    expect(response.status).toBe(409)
    expect(activeOrderAppeared).toBe(true)
    expect(employeeActive).toBe(true)
    expect(prisma.employee.update).not.toHaveBeenCalled()
  })
})

const installationEmployees = [
  { id: 'primary', firstName: 'Anna', lastName: 'Opiekun' },
  { id: 'backup', firstName: 'Bartek', lastName: 'Zastępca' },
]

describe('installation order controls', () => {
  beforeEach(() => {
    mockRouterPush.mockReset()
    mockRouterRefresh.mockReset()
    vi.unstubAllGlobals()
  })

  it('links every listed order to its detail view', () => {
    render(createElement(InstallationOrderList, { orders: [apiOrder] }))

    expect(screen.getByRole('link', { name: /MON-20260822-1234/ }).getAttribute('href')).toBe('/installations/order-1')
  })

  it('renders the derived client-form and clarification badges inside the single card link', () => {
    render(createElement(InstallationOrderList, { orders: [{
      ...apiOrder,
      clientFormStatus: { code: 'IN_PROGRESS' as const, label: 'Rozpoczęty', requiresClarification: true },
    }] }))

    expect(screen.getByText('Rozpoczęty')).not.toBeNull()
    expect(screen.getByText('Wymaga ustalenia')).not.toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('gives every client-form state a distinct visible badge tone', () => {
    const statuses = [
      { code: 'NO_FORM' as const, label: 'Brak formularza' },
      { code: 'READY_TO_SEND' as const, label: 'Do wysłania' },
      { code: 'WAITING' as const, label: 'Wysłany · czeka na klienta' },
      { code: 'IN_PROGRESS' as const, label: 'Rozpoczęty' },
      { code: 'COMPLETED' as const, label: 'Wypełniony' },
    ]
    render(createElement(InstallationOrderList, { orders: statuses.map((clientFormStatus, index) => ({
      ...apiOrder,
      id: `order-status-${index}`,
      clientFormStatus: { ...clientFormStatus, requiresClarification: false },
    })) }))

    const tones = statuses.map(({ label }) => {
      const badge = screen.getByText(label).closest('span')
      expect(badge).not.toBeNull()
      return `${badge!.style.backgroundColor}/${badge!.style.color}`
    })

    expect(new Set(tones).size).toBe(statuses.length)
  })

  it('does not render either creation control when the viewer cannot create an installation order', () => {
    render(createElement(InstallationOrderList, { orders: [], canCreate: false } as never))

    expect(screen.queryByRole('link', { name: 'Nowa karta' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Utwórz kartę montażu' })).toBeNull()
  })

  it('does not render edit or archive controls when the viewer cannot mutate an order', () => {
    render(createElement(InstallationOrderDetail, {
      order: apiOrder,
      employees: installationEmployees,
      canEdit: false,
      canArchive: false,
    } as never))

    expect(screen.queryByRole('heading', { name: 'Dane zlecenia' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archiwizuj zlecenie' })).toBeNull()
  })

  it('locks an employee create form to their own primary owner while leaving backup selectable', () => {
    render(createElement(InstallationOrderForm, {
      mode: 'create',
      employees: installationEmployees,
      primaryEmployeeIdLocked: 'primary',
    } as never))

    expect(screen.getByRole('button', { name: 'Wybierz głównego opiekuna' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Wybierz zastępcę opiekuna' }).hasAttribute('disabled')).toBe(false)
  })

  it('creates an order through the API with styled owner pickers instead of native selects', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'order-1' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(InstallationOrderForm, { mode: 'create', employees: installationEmployees }))

    await user.type(screen.getByLabelText('Klient'), 'Anna Kowalska')
    await user.type(screen.getByLabelText('E-mail'), 'anna@example.pl')
    await user.type(screen.getByLabelText('Telefon'), '+48 501 234 567')
    await user.type(screen.getByLabelText('Ulica'), 'Puławska')
    await user.type(screen.getByLabelText('Numer budynku'), '17')
    await user.type(screen.getByLabelText('Kod pocztowy'), '02-515')
    await user.type(screen.getByLabelText('Miejscowość'), 'Warszawa')
    await user.click(screen.getByRole('button', { name: 'Wybierz głównego opiekuna' }))
    await user.click(screen.getByRole('option', { name: 'Ustaw Anna Opiekun jako głównego opiekuna' }))
    await user.click(screen.getByRole('button', { name: 'Wybierz zastępcę opiekuna' }))
    await user.click(screen.getByRole('option', { name: 'Ustaw Bartek Zastępca jako zastępcę opiekuna' }))
    await user.click(screen.getByRole('button', { name: 'Utwórz kartę' }))

    expect(document.querySelector('select')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/installations', expect.objectContaining({ method: 'POST' }))
    expect(mockRouterPush).toHaveBeenCalledWith('/installations/order-1')
  })

  it('archives a visible order through its working detail action', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...apiOrder, archivedAt: '2026-08-22T12:00:00.000Z' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(InstallationOrderDetail, { order: apiOrder, employees: installationEmployees, canEdit: true, canArchive: true } as never))

    await user.click(screen.getByRole('button', { name: 'Archiwizuj zlecenie' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/installations/order-1', { method: 'DELETE' })
    expect(mockRouterPush).toHaveBeenCalledWith('/installations')
  })

  it('renders an operational edit form but no archive control for a delegated viewer', () => {
    render(createElement(InstallationOrderDetail, {
      order: apiOrder,
      employees: installationEmployees,
      canEdit: true,
      canArchive: false,
    } as never))

    expect(screen.getByRole('heading', { name: 'Dane zlecenia' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Archiwizuj zlecenie' })).toBeNull()
  })

  it('sends null for an address field explicitly cleared while editing an order', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => apiOrder })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(InstallationOrderForm, {
      mode: 'edit', order: apiOrder, employees: installationEmployees,
    } as never))

    await user.clear(screen.getByLabelText('Numer budynku'))
    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany' }))

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(request.body as string)).toMatchObject({
      address: { buildingNumber: null },
    })
  })
})
