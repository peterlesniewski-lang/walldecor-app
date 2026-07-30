import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/hr/time-tracking/batch/route'

const transactionTimeEntryCreate = vi.hoisted(() => vi.fn())
const transactionTimeEntryUpdate = vi.hoisted(() => vi.fn())
const transactionLeaveRequestFindMany = vi.hoisted(() => vi.fn())

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
    },
    timeEntry: {
      findMany: vi.fn(),
    },
    timeTrackingRule: {
      findFirst: vi.fn(),
    },
    leaveRequestNew: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockEmployeeFindUnique = vi.mocked(prisma.employee.findUnique)
const mockTimeEntryFindMany = vi.mocked(prisma.timeEntry.findMany)
const mockTimeRuleFindFirst = vi.mocked(prisma.timeTrackingRule.findFirst)
const mockLeaveRequestFindMany = vi.mocked(prisma.leaveRequestNew.findMany)
const mockTransaction = vi.mocked(prisma.$transaction)

type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'

function session(role: Role, employeeId: string | null = null) {
  return {
    user: {
      id: `${role.toLowerCase()}-user`,
      name: role,
      email: `${role.toLowerCase()}@test.pl`,
      role,
      employeeId,
    },
    expires: '',
  }
}

function row(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    clockIn: `${date}T08:00:00.000Z`,
    clockOut: `${date}T16:00:00.000Z`,
    breakMinutes: 30,
    ...overrides,
  }
}

function request(rows: Array<Record<string, unknown>>, employeeId = 'employee-1') {
  return new NextRequest('http://localhost/api/hr/time-tracking/batch', {
    method: 'POST',
    body: JSON.stringify({ employeeId, rows }),
  })
}

function employee(id: string, divisionId = 'JAG') {
  return { id, divisionId, active: true }
}

function transactionClient() {
  return {
    timeEntry: {
      create: transactionTimeEntryCreate,
      update: transactionTimeEntryUpdate,
    },
    leaveRequestNew: {
      findMany: transactionLeaveRequestFindMany,
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockEmployeeFindUnique.mockResolvedValue(employee('employee-1') as never)
  mockTimeEntryFindMany.mockResolvedValue([])
  mockTimeRuleFindFirst.mockResolvedValue(null)
  mockLeaveRequestFindMany.mockResolvedValue([])
  transactionLeaveRequestFindMany.mockResolvedValue([])
  transactionTimeEntryCreate.mockImplementation(async ({ data }) => ({
    id: `created-${data.date.toISOString().slice(0, 10)}`,
  }))
  transactionTimeEntryUpdate.mockImplementation(async ({ where }) => ({ id: where.id }))
  mockTransaction.mockImplementation(async (callback) =>
    callback(transactionClient() as never)
  )
})

describe('POST /api/hr/time-tracking/batch', () => {
  it('rejects employee accounts', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const response = await POST(request([row('2026-07-02')]))

    expect(response.status).toBe(403)
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects a manager targeting an employee outside their scope', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
    mockEmployeeFindUnique
      .mockResolvedValueOnce(employee('employee-1', 'PUL') as never)
      .mockResolvedValueOnce(employee('manager-1', 'JAG') as never)

    const response = await POST(request([row('2026-07-02')]))

    expect(response.status).toBe(403)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns the same 403 to a manager for a missing employee', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
    mockEmployeeFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(employee('manager-1', 'JAG') as never)

    const response = await POST(request([row('2026-07-02')], 'missing-employee'))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('retains 404 for an admin targeting a missing employee', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockEmployeeFindUnique.mockResolvedValueOnce(null)

    const response = await POST(request([row('2026-07-02')], 'missing-employee'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Employee not found' })
  })

  it('rejects batch sizes outside 1..31 and non-canonical dates', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const emptyResponse = await POST(request([]))
    const tooLargeResponse = await POST(request(
      Array.from({ length: 32 }, (_, index) => row(`2026-07-${String(index + 1).padStart(2, '0')}`))
    ))
    const invalidDateResponse = await POST(request([row('0999-12-31')]))

    expect([
      emptyResponse.status,
      tooLargeResponse.status,
      invalidDateResponse.status,
    ]).toEqual([400, 400, 400])
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns row conflicts for every duplicated date without saving either row', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const response = await POST(request([
      row('2026-07-02'),
      row('2026-07-02', { clockIn: '2026-07-02T09:00:00.000Z' }),
    ]))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      saved: [],
      failed: [
        { date: '2026-07-02', error: 'Data występuje w żądaniu więcej niż raz' },
        { date: '2026-07-02', error: 'Data występuje w żądaniu więcej niż raz' },
      ],
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns a row conflict when an entry belongs to another employee', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-other',
      employeeId: 'employee-2',
      date: new Date('2026-07-02T00:00:00.000Z'),
      status: 'approved',
    }] as never)

    const response = await POST(request([
      row('2026-07-02', { entryId: 'entry-other' }),
    ]))

    expect(await response.json()).toEqual({
      saved: [],
      failed: [{
        date: '2026-07-02',
        error: 'Wpis nie istnieje lub nie należy do wybranego pracownika',
      }],
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns a row conflict when an entry ID points at a different Warsaw date', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      employeeId: 'employee-1',
      date: new Date('2026-07-03T00:00:00.000Z'),
      status: 'pending',
    }] as never)

    const response = await POST(request([
      row('2026-07-02', { entryId: 'entry-1' }),
    ]))

    expect(await response.json()).toEqual({
      saved: [],
      failed: [{
        date: '2026-07-02',
        error: 'Wskazany wpis należy do innej daty',
      }],
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('detects an existing legacy entry on the same Warsaw logical day', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'legacy-entry',
      employeeId: 'employee-1',
      date: new Date('2026-07-01T22:00:00.000Z'),
      status: 'pending',
    }] as never)

    const response = await POST(request([row('2026-07-02')]))

    expect(await response.json()).toEqual({
      saved: [],
      failed: [{
        date: '2026-07-02',
        error: 'Wpis dla tego pracownika i dnia już istnieje',
      }],
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('writes valid creates and updates in one transaction with canonical fields', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      employeeId: 'employee-1',
      date: new Date('2026-07-02T00:00:00.000Z'),
      status: 'approved',
    }] as never)

    const response = await POST(request([
      row('2026-07-02', { entryId: 'entry-1' }),
      row('2026-07-03', { breakMinutes: 45 }),
    ]))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      saved: [
        { date: '2026-07-02', entryId: 'entry-1' },
        { date: '2026-07-03', entryId: 'created-2026-07-03' },
      ],
      failed: [],
    })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(transactionTimeEntryUpdate).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: {
        date: new Date('2026-07-02T00:00:00.000Z'),
        clockIn: new Date('2026-07-02T08:00:00.000Z'),
        clockOut: new Date('2026-07-02T16:00:00.000Z'),
        totalMinutes: 480,
        breakMinutes: 30,
        overtimeMinutes: 0,
        source: 'bulk',
      },
      select: { id: true },
    })
    expect(transactionTimeEntryCreate).toHaveBeenCalledWith({
      data: {
        employeeId: 'employee-1',
        date: new Date('2026-07-03T00:00:00.000Z'),
        clockIn: new Date('2026-07-03T08:00:00.000Z'),
        clockOut: new Date('2026-07-03T16:00:00.000Z'),
        totalMinutes: 480,
        breakMinutes: 45,
        overtimeMinutes: 0,
        source: 'bulk',
        status: 'pending',
      },
      select: { id: true },
    })
    expect(transactionTimeEntryUpdate.mock.calls[0][0].data).not.toHaveProperty('status')
    expect(mockTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' }
    )
  })

  it('calculates create overtime from net minutes using the deterministic division rule', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockTimeRuleFindFirst.mockResolvedValue({ dailyHours: 7.5 } as never)

    const response = await POST(request([
      row('2026-07-02', {
        clockOut: '2026-07-02T17:00:00.000Z',
        breakMinutes: 30,
      }),
    ]))

    expect(response.status).toBe(200)
    expect(mockTimeRuleFindFirst).toHaveBeenCalledWith({
      where: { divisionId: 'JAG' },
      orderBy: { id: 'asc' },
      select: { dailyHours: true },
    })
    expect(transactionTimeEntryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalMinutes: 540,
        breakMinutes: 30,
        overtimeMinutes: 60,
      }),
    }))
  })

  it('recalculates update overtime from net minutes with the default eight-hour rule', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      employeeId: 'employee-1',
      date: new Date('2026-07-02T00:00:00.000Z'),
    }] as never)

    const response = await POST(request([
      row('2026-07-02', {
        entryId: 'entry-1',
        clockOut: '2026-07-02T18:00:00.000Z',
        breakMinutes: 60,
      }),
    ]))

    expect(response.status).toBe(200)
    expect(transactionTimeEntryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalMinutes: 600,
        breakMinutes: 60,
        overtimeMinutes: 60,
      }),
    }))
  })

  it('validates every row and saves the valid subset in one transaction', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const response = await POST(request([
      row('2026-07-02', {
        clockIn: '2026-07-02T16:00:00.000Z',
        clockOut: '2026-07-02T08:00:00.000Z',
      }),
      row('2026-07-03'),
    ]))

    expect(await response.json()).toEqual({
      saved: [{ date: '2026-07-03', entryId: 'created-2026-07-03' }],
      failed: [{
        date: '2026-07-02',
        error: 'Godzina wyjścia musi być późniejsza niż wejścia',
      }],
    })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(transactionTimeEntryCreate).toHaveBeenCalledTimes(1)
  })

  it('blocks creates on approved leave but allows an existing entry update', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      employeeId: 'employee-1',
      date: new Date('2026-07-02T00:00:00.000Z'),
      status: 'approved',
    }] as never)
    transactionLeaveRequestFindMany.mockResolvedValue([{
      startDate: new Date('2026-07-02T00:00:00.000Z'),
      endDate: new Date('2026-07-03T00:00:00.000Z'),
      isRemoteWork: false,
      isDelegation: false,
    }] as never)

    const response = await POST(request([
      row('2026-07-02', { entryId: 'entry-1' }),
      row('2026-07-03'),
    ]))

    expect(await response.json()).toEqual({
      saved: [{ date: '2026-07-02', entryId: 'entry-1' }],
      failed: [{
        date: '2026-07-03',
        error: 'Zatwierdzony urlop blokuje utworzenie wpisu dla tego dnia',
      }],
    })
    expect(mockLeaveRequestFindMany).not.toHaveBeenCalled()
    expect(transactionLeaveRequestFindMany).toHaveBeenCalledWith({
      where: {
        employeeId: 'employee-1',
        status: 'approved',
        isRemoteWork: false,
        isDelegation: false,
        startDate: { lte: new Date('2026-07-04T23:59:59.999Z') },
        endDate: { gte: new Date('2026-07-02T00:00:00.000Z') },
      },
      select: {
        startDate: true,
        endDate: true,
        isRemoteWork: true,
        isDelegation: true,
      },
    })
    expect(transactionTimeEntryUpdate).toHaveBeenCalledTimes(1)
    expect(transactionTimeEntryCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['remote work', { isRemoteWork: true, isDelegation: false }],
    ['delegation', { isRemoteWork: false, isDelegation: true }],
  ])('allows worked-time creation for approved %s metadata', async (_label, metadata) => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    transactionLeaveRequestFindMany.mockResolvedValue([{
      startDate: new Date('2026-07-02T00:00:00.000Z'),
      endDate: new Date('2026-07-02T00:00:00.000Z'),
      ...metadata,
    }] as never)

    const response = await POST(request([row('2026-07-02')]))

    expect(await response.json()).toEqual({
      saved: [{ date: '2026-07-02', entryId: 'created-2026-07-02' }],
      failed: [],
    })
    expect(transactionTimeEntryCreate).toHaveBeenCalledTimes(1)
  })

  it('maps a uniqueness race to one row failure and retries valid rows atomically', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    const uniqueError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: {
        modelName: 'TimeEntry',
        target: ['employeeId', 'date'],
      },
    })
    transactionTimeEntryCreate.mockImplementation(async ({ data }) => {
      const date = data.date.toISOString().slice(0, 10)
      if (date === '2026-07-03') throw uniqueError
      return { id: `created-${date}` }
    })

    const response = await POST(request([
      row('2026-07-02'),
      row('2026-07-03'),
    ]))

    expect(await response.json()).toEqual({
      saved: [{ date: '2026-07-02', entryId: 'created-2026-07-02' }],
      failed: [{
        date: '2026-07-03',
        error: 'Wpis dla tego pracownika i dnia już istnieje',
      }],
    })
    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['another model', {
      modelName: 'Project',
      target: ['employeeId', 'date'],
    }],
    ['another TimeEntry target', {
      modelName: 'TimeEntry',
      target: ['id'],
    }],
  ])('rethrows P2002 for %s', async (_label, meta) => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    const unrelatedError = Object.assign(new Error('Different unique constraint'), {
      code: 'P2002',
      meta,
    })
    transactionTimeEntryCreate.mockRejectedValue(unrelatedError)

    await expect(POST(request([row('2026-07-02')]))).rejects.toBe(unrelatedError)
  })

  it.each([
    ['P2034', 'Write conflict'],
    ['P2028', 'Transaction already closed because of an expired transaction'],
  ])('retries retryable %s transaction failures', async (code, message) => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    const conflict = Object.assign(new Error(message), { code })
    mockTransaction
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (callback) =>
        callback(transactionClient() as never)
      )

    const response = await POST(request([row('2026-07-02')]))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      saved: [{ date: '2026-07-02', entryId: 'created-2026-07-02' }],
      failed: [],
    })
    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  it('returns a controlled 409 after serializable retries are exhausted', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    const conflict = Object.assign(new Error('Write conflict'), { code: 'P2034' })
    mockTransaction.mockRejectedValue(conflict)

    const response = await POST(request([row('2026-07-02')]))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Zmiany czasu pracy nie zostały zapisane z powodu równoczesnej zmiany. Spróbuj ponownie.',
    })
    expect(mockTransaction).toHaveBeenCalledTimes(3)
  })
})
