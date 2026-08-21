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
} from '@/lib/installations/schemas'
import { canAccessInstallationOrder } from '@/lib/installations/access'
import {
  archiveInstallationOrder,
  createInstallationOrder,
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
import { DELETE as deleteEmployee } from '@/app/api/hr/employees/[id]/route'
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
  getInstallationOrder: vi.fn(),
  listInstallationOrders: vi.fn(),
  updateInstallationOrder: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    employee: { findUnique: vi.fn(), count: vi.fn(), delete: vi.fn() },
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
  },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, refresh: mockRouterRefresh }),
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockArchiveInstallationOrder = vi.mocked(archiveInstallationOrder)
const mockCreateInstallationOrder = vi.mocked(createInstallationOrder)
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
})

describe('installation order access policy', () => {
  const order = {
    primaryEmployeeId: 'primary',
    backupEmployeeId: 'backup',
    isAssignedInstaller: false,
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
  }
  const now = new Date('2026-08-22T12:00:00.000Z')

  it('grants full access to admin and manager', () => {
    expect(canAccessInstallationOrder({ role: 'ADMIN', employeeId: null }, order, now)).toBe(true)
    expect(canAccessInstallationOrder({ role: 'MANAGER', employeeId: null }, order, now)).toBe(true)
  })

  it('grants employee access only to primary, backup, or an active delegate', () => {
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'primary' }, order, now)).toBe(true)
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'backup' }, order, now)).toBe(true)
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'delegate-active' }, order, now)).toBe(true)
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'delegate-ended' }, order, now)).toBe(false)
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: 'outsider' }, order, now)).toBe(false)
  })

  it('grants installer access only to an explicitly assigned installer record', () => {
    expect(canAccessInstallationOrder({ role: 'INSTALLER', employeeId: 'installer' }, order, now)).toBe(false)
    expect(canAccessInstallationOrder(
      { role: 'INSTALLER', employeeId: 'installer' },
      { ...order, isAssignedInstaller: true },
      now,
    )).toBe(true)
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
  isAssignedInstaller: false,
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
  })

  it('returns 401 without a session before listing orders', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await listOrders(new NextRequest('http://localhost/api/installations'))

    expect(response.status).toBe(401)
    expect(mockListInstallationOrders).not.toHaveBeenCalled()
  })

  it('filters an employee list to installation orders they may access', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'primary') as never)
    mockListInstallationOrders.mockResolvedValue([
      apiOrder,
      { ...apiOrder, id: 'order-2', primaryEmployeeId: 'other', backupEmployeeId: 'other-backup' },
    ] as never)

    const response = await listOrders(new NextRequest('http://localhost/api/installations'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.map((order: { id: string }) => order.id)).toEqual(['order-1'])
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

  it('does not disclose an order to an unrelated employee', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'outsider') as never)
    mockGetInstallationOrder.mockResolvedValue(apiOrder as never)

    const response = await getOrder(new NextRequest('http://localhost/api/installations/order-1'), {
      params: Promise.resolve({ id: 'order-1' }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
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
})

const installationEmployees = [
  { id: 'primary', firstName: 'Anna', lastName: 'Opiekun', email: 'anna@example.pl' },
  { id: 'backup', firstName: 'Bartek', lastName: 'Zastępca', email: 'bartek@example.pl' },
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
    render(createElement(InstallationOrderDetail, { order: apiOrder, employees: installationEmployees }))

    await user.click(screen.getByRole('button', { name: 'Archiwizuj zlecenie' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/installations/order-1', { method: 'DELETE' })
    expect(mockRouterPush).toHaveBeenCalledWith('/installations')
  })
})
