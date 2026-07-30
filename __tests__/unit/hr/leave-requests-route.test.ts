import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '@/app/api/hr/leave-requests/route'
import { PATCH as approveLeave } from '@/app/api/hr/leave-requests/[id]/approve/route'
import { PATCH as rejectLeave } from '@/app/api/hr/leave-requests/[id]/reject/route'
import { DELETE as cancelLeave } from '@/app/api/hr/leave-requests/[id]/route'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    leaveType: {
      findUnique: vi.fn(),
    },
    leaveBalanceNew: {
      findUnique: vi.fn(),
    },
    leaveRequestNew: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockFindMany = vi.mocked(prisma.leaveRequestNew.findMany)
const mockEmployeeFindUnique = vi.mocked(prisma.employee.findUnique)
const mockLeaveTypeFindUnique = vi.mocked(prisma.leaveType.findUnique)
const mockBalanceFindUnique = vi.mocked(prisma.leaveBalanceNew.findUnique)
const mockRequestFindFirst = vi.mocked(prisma.leaveRequestNew.findFirst)
const mockRequestFindUnique = vi.mocked(prisma.leaveRequestNew.findUnique)
const mockRequestAggregate = vi.mocked(prisma.leaveRequestNew.aggregate)
const mockNotificationCreate = vi.mocked(prisma.notification.create)
const mockTransaction = vi.mocked(prisma.$transaction)

const txRequestCreate = vi.fn()
const txRequestUpdate = vi.fn()
const txRequestUpdateMany = vi.fn()
const txRequestFindFirst = vi.fn()
const txRequestFindUnique = vi.fn()
const txRequestAggregate = vi.fn()
const txBalanceFindUnique = vi.fn()
const txBalanceUpdate = vi.fn()
const txBalanceUpdateMany = vi.fn()
const txTimeEntryFindMany = vi.fn()

const tx = {
  leaveRequestNew: {
    create: txRequestCreate,
    update: txRequestUpdate,
    updateMany: txRequestUpdateMany,
    findFirst: txRequestFindFirst,
    findUnique: txRequestFindUnique,
    aggregate: txRequestAggregate,
  },
  leaveBalanceNew: {
    findUnique: txBalanceFindUnique,
    update: txBalanceUpdate,
    updateMany: txBalanceUpdateMany,
  },
  timeEntry: {
    findMany: txTimeEntryFindMany,
  },
}

const adminSession = {
  user: {
    id: 'admin-1',
    name: 'Administrator',
    email: 'admin@test.pl',
    role: 'ADMIN',
    employeeId: null,
  },
  expires: '',
}

const employeeSession = {
  user: {
    id: 'employee-user',
    name: 'Jan Kowalski',
    email: 'jan@test.pl',
    role: 'EMPLOYEE',
    employeeId: 'employee-1',
  },
  expires: '',
}

const employee = {
  id: 'employee-1',
  firstName: 'Jan',
  lastName: 'Kowalski',
  email: 'jan@test.pl',
  position: 'Sprzedawca',
  userId: 'employee-user',
  divisionId: 'division-1',
  active: true,
  division: { id: 'division-1', name: 'Janki' },
}

function leaveType(
  code: 'VL' | 'VLD' | 'SL' | 'UB',
  overrides: Record<string, unknown> = {}
) {
  const defaults = {
    VL: { id: 'leave-type-vl', name: 'Urlop wypoczynkowy', tracksBalance: true, parentId: null },
    VLD: { id: 'leave-type-vld', name: 'Urlop na zadanie', tracksBalance: true, parentId: 'leave-type-vl' },
    SL: { id: 'leave-type-sl', name: 'Zwolnienie lekarskie', tracksBalance: false, parentId: null },
    UB: { id: 'leave-type-ub', name: 'Urlop bezplatny', tracksBalance: false, parentId: null },
  }

  return {
    ...defaults[code],
    code,
    color: '#123456',
    ...overrides,
  }
}

function balance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'balance-vl-2026',
    employeeId: employee.id,
    leaveTypeId: 'leave-type-vl',
    year: 2026,
    totalDays: 20,
    usedDays: 3,
    pendingDays: 1,
    carriedOver: 0,
    ...overrides,
  }
}

function pendingLeave(
  type = leaveType('VLD'),
  overrides: Record<string, unknown> = {}
) {
  return {
    id: 'request-1',
    employeeId: employee.id,
    leaveTypeId: type.id,
    startDate: new Date('2026-07-29T00:00:00.000Z'),
    endDate: new Date('2026-07-29T00:00:00.000Z'),
    days: 1,
    isOnDemand: type.code === 'VLD',
    isRemoteWork: false,
    isDelegation: false,
    status: 'pending',
    approverId: null,
    approvedAt: null,
    rejectionNote: null,
    substituteId: null,
    notifySubstitute: false,
    note: null,
    attachments: null,
    gcalEventId: null,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    leaveType: type,
    employee,
    ...overrides,
  }
}

function request(
  method = 'GET',
  body?: Record<string, unknown>,
  url = 'http://localhost/api/hr/leave-requests'
) {
  return new NextRequest(url, {
    method,
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  })
}

function params(id = 'request-1') {
  return { params: Promise.resolve({ id }) }
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    employeeId: employee.id,
    leaveTypeId: 'leave-type-sl',
    startDate: '2026-07-29',
    endDate: '2026-07-29',
    isOnDemand: false,
    isRemoteWork: false,
    isDelegation: false,
    notifySubstitute: false,
    ...overrides,
  }
}

async function postLeave(overrides: Record<string, unknown> = {}) {
  return POST(request('POST', createBody(overrides)))
}

function arrangeLifecycle(type = leaveType('VLD'), overrides: Record<string, unknown> = {}) {
  const leave = pendingLeave(type, overrides)
  mockRequestFindUnique.mockResolvedValue(leave as never)
  txRequestFindUnique.mockResolvedValue({
    ...leave,
    status: 'approved',
  })
  txRequestUpdate.mockResolvedValue({
    ...leave,
    status: 'approved',
  })
  return leave
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTransaction.mockReset()
  delete process.env.N8N_WEBHOOK_URL

  mockGetServerSession.mockResolvedValue(adminSession as never)
  mockEmployeeFindUnique.mockResolvedValue(employee as never)
  mockLeaveTypeFindUnique.mockResolvedValue(leaveType('SL') as never)
  mockRequestFindFirst.mockResolvedValue(null)
  mockRequestAggregate.mockResolvedValue({ _sum: { days: 0 } } as never)
  mockBalanceFindUnique.mockResolvedValue(null)
  mockNotificationCreate.mockResolvedValue({ id: 'notification-1' } as never)

  txRequestCreate.mockResolvedValue({
    id: 'request-created',
    employeeId: employee.id,
    leaveTypeId: 'leave-type-sl',
    status: 'pending',
  })
  txRequestUpdateMany.mockResolvedValue({ count: 1 })
  txRequestFindFirst.mockResolvedValue(null)
  txRequestAggregate.mockResolvedValue({ _sum: { days: 0 } })
  txBalanceFindUnique.mockResolvedValue(null)
  txBalanceUpdate.mockResolvedValue(balance())
  txBalanceUpdateMany.mockResolvedValue({ count: 1 })
  txTimeEntryFindMany.mockResolvedValue([])

  mockTransaction.mockImplementation(
    async (callback) => callback(tx as never) as never
  )
})

afterEach(() => {
  delete process.env.N8N_WEBHOOK_URL
  vi.unstubAllGlobals()
})

describe('GET /api/hr/leave-requests', () => {
  it('returns an empty array for an employee account without linked employee profile', async () => {
    mockGetServerSession.mockResolvedValue({
      ...employeeSession,
      user: { ...employeeSession.user, employeeId: null },
    } as never)

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('uses canonical UTC boundaries for the year filter', async () => {
    mockFindMany.mockResolvedValue([])

    const response = await GET(request(
      'GET',
      undefined,
      'http://localhost/api/hr/leave-requests?year=2026'
    ))

    expect(response.status).toBe(200)
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        startDate: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-12-31T23:59:59.999Z'),
        },
      }),
    }))
  })
})

describe('POST /api/hr/leave-requests', () => {
  it('rejects a UTC calendar-year crossing before starting a transaction', async () => {
    const response = await postLeave({
      startDate: '2026-12-31',
      endDate: '2027-01-04',
    })

    expect(response.status).toBe(422)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(txRequestCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('returns 503 before mutation when VLD has no parent pool', async () => {
    mockLeaveTypeFindUnique.mockResolvedValue(
      leaveType('VLD', { parentId: null }) as never
    )

    const response = await postLeave({
      leaveTypeId: 'leave-type-vld',
      isOnDemand: false,
    })

    expect(response.status).toBe(503)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(txRequestCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('checks overlap inside the transaction before balance or request writes', async () => {
    txRequestFindFirst.mockResolvedValue({ id: 'overlap' })

    const response = await postLeave()

    expect(response.status).toBe(422)
    expect(mockRequestFindFirst).not.toHaveBeenCalled()
    expect(txRequestFindFirst).toHaveBeenCalledWith({
      where: {
        employeeId: employee.id,
        status: { notIn: ['cancelled', 'rejected'] },
        OR: [
          {
            startDate: { lte: new Date('2026-07-29T00:00:00.000Z') },
            endDate: { gte: new Date('2026-07-29T00:00:00.000Z') },
          },
        ],
      },
    })
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txRequestCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('rechecks overlap after a transaction conflict before creating', async () => {
    txRequestFindFirst
      .mockRejectedValueOnce(Object.assign(new Error('Write conflict'), {
        code: 'P2034',
      }))
      .mockResolvedValueOnce({ id: 'overlap-after-retry' })

    const response = await postLeave()

    expect(response.status).toBe(422)
    expect(mockTransaction).toHaveBeenCalledTimes(2)
    expect(txRequestFindFirst).toHaveBeenCalledTimes(2)
    expect(txRequestCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('maps exhausted transaction conflicts to a controlled 409', async () => {
    mockTransaction.mockRejectedValue(Object.assign(
      new Error('Transaction failed due to a write conflict'),
      { code: 'P2034' }
    ))

    const response = await postLeave()

    expect(response.status).toBe(409)
    expect(mockTransaction).toHaveBeenCalledTimes(3)
    expect(txRequestCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('propagates a non-retryable transaction failure', async () => {
    const failure = new Error('Database connection lost')
    mockTransaction.mockRejectedValue(failure)

    await expect(postLeave()).rejects.toBe(failure)
    expect(mockTransaction).toHaveBeenCalledOnce()
  })

  it.each([
    ['SL', 'leave-type-sl'],
    ['UB', 'leave-type-ub'],
  ] as const)('creates %s without reading or mutating a balance', async (code, id) => {
    mockLeaveTypeFindUnique.mockResolvedValue(leaveType(code) as never)

    const response = await postLeave({ leaveTypeId: id })

    expect(response.status).toBe(201)
    expect(mockBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('uses the ordinary tracked leave type as its own balance pool', async () => {
    mockLeaveTypeFindUnique.mockResolvedValue(leaveType('VL') as never)
    txBalanceFindUnique.mockResolvedValue(balance())

    const response = await postLeave({ leaveTypeId: 'leave-type-vl' })

    expect(response.status).toBe(201)
    expect(txBalanceFindUnique).toHaveBeenCalledWith({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: 'leave-type-vl',
          year: 2026,
        },
      },
    })
    expect(txBalanceUpdate).toHaveBeenCalledWith({
      where: { id: 'balance-vl-2026' },
      data: { pendingDays: { increment: 1 } },
    })
  })

  it('canonicalizes VLD, reserves its parent VL pool, and increments requested days', async () => {
    mockLeaveTypeFindUnique.mockResolvedValue(leaveType('VLD') as never)
    txBalanceFindUnique.mockResolvedValue(balance())

    const response = await postLeave({
      leaveTypeId: 'leave-type-vld',
      startDate: '2026-07-29',
      endDate: '2026-07-30',
      isOnDemand: false,
    })

    expect(response.status).toBe(201)
    expect(txBalanceFindUnique).toHaveBeenCalledWith({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: 'leave-type-vl',
          year: 2026,
        },
      },
    })
    expect(txRequestCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        leaveTypeId: 'leave-type-vld',
        days: 2,
        isOnDemand: true,
      }),
    }))
    expect(txBalanceUpdate).toHaveBeenCalledWith({
      where: { id: 'balance-vl-2026' },
      data: { pendingDays: { increment: 2 } },
    })
  })

  it('sums annual on-demand days across explicit historical rows and VLD rows', async () => {
    mockLeaveTypeFindUnique.mockResolvedValue(leaveType('VLD') as never)
    txBalanceFindUnique.mockResolvedValue(balance())
    txRequestAggregate.mockResolvedValue({ _sum: { days: 3 } })

    const response = await postLeave({
      leaveTypeId: 'leave-type-vld',
      isOnDemand: false,
    })

    expect(response.status).toBe(201)
    expect(txRequestAggregate).toHaveBeenCalledWith({
      where: {
        employeeId: employee.id,
        status: { notIn: ['cancelled', 'rejected'] },
        startDate: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-12-31T23:59:59.999Z'),
        },
        OR: [
          { isOnDemand: true },
          { leaveType: { code: 'VLD' } },
        ],
      },
      _sum: { days: true },
    })
  })

  it('rejects a fifth annual on-demand day before request or balance writes', async () => {
    mockLeaveTypeFindUnique.mockResolvedValue(leaveType('VLD') as never)
    txBalanceFindUnique.mockResolvedValue(balance())
    txRequestAggregate.mockResolvedValue({ _sum: { days: 4 } })

    const response = await postLeave({
      leaveTypeId: 'leave-type-vld',
      isOnDemand: false,
    })

    expect(response.status).toBe(422)
    expect(txRequestCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('allows a single four-day VLD request and reserves all four days', async () => {
    mockLeaveTypeFindUnique.mockResolvedValue(leaveType('VLD') as never)
    txBalanceFindUnique.mockResolvedValue(balance({ pendingDays: 0 }))

    const response = await postLeave({
      leaveTypeId: 'leave-type-vld',
      startDate: '2026-07-27',
      endDate: '2026-07-30',
      isOnDemand: false,
    })

    expect(response.status).toBe(201)
    expect(txBalanceUpdate).toHaveBeenCalledWith({
      where: { id: 'balance-vl-2026' },
      data: { pendingDays: { increment: 4 } },
    })
  })

  it('uses total minus used minus pending for availability and performs no writes on failure', async () => {
    mockLeaveTypeFindUnique.mockResolvedValue(leaveType('VL') as never)
    txBalanceFindUnique.mockResolvedValue(balance({
      totalDays: 10,
      usedDays: 6,
      pendingDays: 3,
    }))

    const response = await postLeave({
      leaveTypeId: 'leave-type-vl',
      startDate: '2026-07-29',
      endDate: '2026-07-30',
    })
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body).toEqual(expect.objectContaining({
      available: 1,
      requested: 2,
    }))
    expect(txRequestCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('does not create a tracked request when its resolved balance is missing', async () => {
    mockLeaveTypeFindUnique.mockResolvedValue(leaveType('VLD') as never)
    txBalanceFindUnique.mockResolvedValue(null)

    const response = await postLeave({
      leaveTypeId: 'leave-type-vld',
      isOnDemand: false,
    })

    expect(response.status).toBe(422)
    expect(txRequestCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['P2034', 'Transaction failed due to a write conflict'],
    [
      'P2028',
      'Transaction API error: Transaction already closed because of an expired transaction',
    ],
  ])('retries transient transaction conflict %s and returns a fresh domain error', async (code, message) => {
    mockLeaveTypeFindUnique.mockResolvedValue(leaveType('VL') as never)
    txBalanceFindUnique.mockResolvedValue(balance({
      totalDays: 1,
      usedDays: 0,
      pendingDays: 1,
    }))
    mockTransaction
      .mockRejectedValueOnce(Object.assign(new Error(message), { code }))
      .mockImplementationOnce(async (callback) => callback(tx as never) as never)

    const response = await postLeave({ leaveTypeId: 'leave-type-vl' })

    expect(response.status).toBe(422)
    expect(mockTransaction).toHaveBeenCalledTimes(2)
    expect(txRequestCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['remote work', { isRemoteWork: true }],
    ['delegation', { isDelegation: true }],
  ])('does not use a balance for %s', async (_label, flags) => {
    mockLeaveTypeFindUnique.mockResolvedValue(leaveType('VL') as never)

    const response = await postLeave({
      leaveTypeId: 'leave-type-vl',
      ...flags,
    })

    expect(response.status).toBe(201)
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/hr/leave-requests/[id]/approve', () => {
  it('blocks normal leave approval when worked time exists on a covered Warsaw date', async () => {
    arrangeLifecycle(leaveType('VL'))
    txTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      date: new Date('2026-07-28T22:00:00.000Z'),
    }])

    const response = await approveLeave(request('PATCH'), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Nie można zatwierdzić urlopu w dniu z zarejestrowanym czasem pracy',
    })
    expect(txTimeEntryFindMany).toHaveBeenCalledWith({
      where: {
        employeeId: employee.id,
        date: {
          gte: new Date('2026-07-28T00:00:00.000Z'),
          lte: new Date('2026-07-30T23:59:59.999Z'),
        },
      },
      select: { id: true, date: true },
    })
    expect(txRequestUpdateMany).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['remote work', { isRemoteWork: true }],
    ['delegation', { isDelegation: true }],
  ])('allows %s approval alongside worked time', async (_label, flags) => {
    arrangeLifecycle(leaveType('VL'), flags)
    txTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      date: new Date('2026-07-29T00:00:00.000Z'),
    }])

    const response = await approveLeave(request('PATCH'), params())

    expect(response.status).toBe(200)
    expect(txTimeEntryFindMany).not.toHaveBeenCalled()
    expect(txRequestUpdateMany).toHaveBeenCalledTimes(1)
  })

  it('returns 503 before mutation when VLD has no parent pool', async () => {
    arrangeLifecycle(leaveType('VLD', { parentId: null }))

    const response = await approveLeave(request('PATCH'), params())

    expect(response.status).toBe(503)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(txRequestUpdateMany).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })

  it('moves VLD pending days to used days on the parent VL balance id', async () => {
    arrangeLifecycle()
    txBalanceFindUnique.mockResolvedValue(balance())

    const response = await approveLeave(request('PATCH'), params())

    expect(response.status).toBe(200)
    expect(txBalanceFindUnique).toHaveBeenCalledWith({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: 'leave-type-vl',
          year: 2026,
        },
      },
    })
    expect(txBalanceUpdate).toHaveBeenCalledWith({
      where: { id: 'balance-vl-2026' },
      data: {
        usedDays: { increment: 1 },
        pendingDays: { decrement: 1 },
      },
    })
    expect(txBalanceUpdateMany).not.toHaveBeenCalled()
  })

  it.each(['SL', 'UB'] as const)('approves %s without reading or mutating a balance', async (code) => {
    arrangeLifecycle(leaveType(code))

    const response = await approveLeave(request('PATCH'), params())

    expect(response.status).toBe(200)
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('requires a resolved balance for approval of tracked leave', async () => {
    arrangeLifecycle(leaveType('VL'))
    txBalanceFindUnique.mockResolvedValue(null)

    const response = await approveLeave(request('PATCH'), params())

    expect(response.status).toBe(422)
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })

  it('rejects approval when total minus used cannot cover request days', async () => {
    arrangeLifecycle(leaveType('VL'), { days: 2 })
    txBalanceFindUnique.mockResolvedValue(balance({
      totalDays: 10,
      usedDays: 9,
      pendingDays: 2,
    }))

    const response = await approveLeave(request('PATCH'), params())

    expect(response.status).toBe(422)
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })

  it('rejects approval before mutation when pending balance would underflow', async () => {
    arrangeLifecycle(leaveType('VL'), { days: 2 })
    txBalanceFindUnique.mockResolvedValue(balance({ pendingDays: 1 }))

    const response = await approveLeave(request('PATCH'), params())

    expect(response.status).toBe(409)
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })

  it('allows only one concurrent approval transition and sends side effects once', async () => {
    arrangeLifecycle()
    txBalanceFindUnique.mockResolvedValue(balance())
    txRequestUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    process.env.N8N_WEBHOOK_URL = 'https://example.test/webhook'
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await approveLeave(request('PATCH'), params())
    const second = await approveLeave(request('PATCH'), params())

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(txBalanceUpdate).toHaveBeenCalledTimes(1)
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries P2028 and returns deterministic 409 when another lifecycle action won', async () => {
    arrangeLifecycle()
    txRequestUpdateMany.mockResolvedValue({ count: 0 })
    mockTransaction
      .mockRejectedValueOnce(Object.assign(
        new Error('Transaction already closed because of an expired transaction'),
        { code: 'P2028' }
      ))
      .mockImplementationOnce(async (callback) => callback(tx as never) as never)

    const response = await approveLeave(request('PATCH'), params())

    expect(response.status).toBe(409)
    expect(mockTransaction).toHaveBeenCalledTimes(2)
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/hr/leave-requests/[id]/reject', () => {
  it('returns 503 before mutation when VLD has no parent pool', async () => {
    arrangeLifecycle(leaveType('VLD', { parentId: null }))

    const response = await rejectLeave(
      request('PATCH', { rejectionNote: 'Brak obsady' }),
      params()
    )

    expect(response.status).toBe(503)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(txRequestUpdateMany).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })

  it('decrements VLD pending days on the parent VL balance id', async () => {
    arrangeLifecycle()
    txBalanceFindUnique.mockResolvedValue(balance())

    const response = await rejectLeave(
      request('PATCH', { rejectionNote: 'Brak obsady' }),
      params()
    )

    expect(response.status).toBe(200)
    expect(txBalanceFindUnique).toHaveBeenCalledWith({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: 'leave-type-vl',
          year: 2026,
        },
      },
    })
    expect(txBalanceUpdate).toHaveBeenCalledWith({
      where: { id: 'balance-vl-2026' },
      data: { pendingDays: { decrement: 1 } },
    })
    expect(txBalanceUpdateMany).not.toHaveBeenCalled()
  })

  it('rejects UB without reading or mutating a balance', async () => {
    arrangeLifecycle(leaveType('UB'))

    const response = await rejectLeave(
      request('PATCH', { rejectionNote: 'Brak obsady' }),
      params()
    )

    expect(response.status).toBe(200)
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('releases a historical tracked request even when its balance is missing', async () => {
    arrangeLifecycle()
    txBalanceFindUnique.mockResolvedValue(null)

    const response = await rejectLeave(
      request('PATCH', { rejectionNote: 'Brak obsady' }),
      params()
    )

    expect(response.status).toBe(200)
    expect(txRequestUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'request-1', status: 'pending' },
    }))
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('rejects pending balance underflow without notification', async () => {
    arrangeLifecycle(undefined, { days: 2 })
    txBalanceFindUnique.mockResolvedValue(balance({ pendingDays: 1 }))

    const response = await rejectLeave(
      request('PATCH', { rejectionNote: 'Brak obsady' }),
      params()
    )

    expect(response.status).toBe(409)
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })

  it('does not notify when a concurrent lifecycle transition wins', async () => {
    arrangeLifecycle()
    txRequestUpdateMany.mockResolvedValue({ count: 0 })

    const response = await rejectLeave(
      request('PATCH', { rejectionNote: 'Brak obsady' }),
      params()
    )

    expect(response.status).toBe(409)
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/hr/leave-requests/[id]', () => {
  it('returns 503 before mutation when VLD has no parent pool', async () => {
    arrangeLifecycle(leaveType('VLD', { parentId: null }))

    const response = await cancelLeave(request('DELETE'), params())

    expect(response.status).toBe(503)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(txRequestUpdateMany).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('decrements VLD pending days on the parent VL balance id', async () => {
    arrangeLifecycle()
    txBalanceFindUnique.mockResolvedValue(balance())

    const response = await cancelLeave(request('DELETE'), params())

    expect(response.status).toBe(200)
    expect(txBalanceFindUnique).toHaveBeenCalledWith({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: 'leave-type-vl',
          year: 2026,
        },
      },
    })
    expect(txBalanceUpdate).toHaveBeenCalledWith({
      where: { id: 'balance-vl-2026' },
      data: { pendingDays: { decrement: 1 } },
    })
    expect(txBalanceUpdateMany).not.toHaveBeenCalled()
  })

  it('cancels UB without reading or mutating a balance', async () => {
    arrangeLifecycle(leaveType('UB'))

    const response = await cancelLeave(request('DELETE'), params())

    expect(response.status).toBe(200)
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('releases a historical tracked request even when its balance is missing', async () => {
    arrangeLifecycle()
    txBalanceFindUnique.mockResolvedValue(null)

    const response = await cancelLeave(request('DELETE'), params())

    expect(response.status).toBe(200)
    expect(txRequestUpdateMany).toHaveBeenCalledWith({
      where: { id: 'request-1', status: 'pending' },
      data: { status: 'cancelled' },
    })
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('rejects pending balance underflow', async () => {
    arrangeLifecycle(undefined, { days: 2 })
    txBalanceFindUnique.mockResolvedValue(balance({ pendingDays: 1 }))

    const response = await cancelLeave(request('DELETE'), params())

    expect(response.status).toBe(409)
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('returns a conflict when another lifecycle transition wins', async () => {
    arrangeLifecycle()
    txRequestUpdateMany.mockResolvedValue({ count: 0 })

    const response = await cancelLeave(request('DELETE'), params())

    expect(response.status).toBe(409)
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it('allows the request owner to cancel', async () => {
    mockGetServerSession.mockResolvedValue(employeeSession as never)
    arrangeLifecycle(leaveType('UB'))

    const response = await cancelLeave(request('DELETE'), params())

    expect(response.status).toBe(200)
    expect(txRequestUpdateMany).toHaveBeenCalledOnce()
  })

  it('allows an admin to cancel another employee request', async () => {
    arrangeLifecycle(leaveType('UB'))

    const response = await cancelLeave(request('DELETE'), params())

    expect(response.status).toBe(200)
    expect(txRequestUpdateMany).toHaveBeenCalledOnce()
  })

  it('forbids a non-owner employee from cancelling', async () => {
    mockGetServerSession.mockResolvedValue({
      ...employeeSession,
      user: { ...employeeSession.user, id: 'other-user', employeeId: 'employee-2' },
    } as never)
    arrangeLifecycle(leaveType('UB'))

    const response = await cancelLeave(request('DELETE'), params())

    expect(response.status).toBe(403)
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
