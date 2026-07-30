import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/hr/time-tracking/batch/route'

const transactionTimeEntryCreate = vi.hoisted(() => vi.fn())
const transactionTimeEntryUpdate = vi.hoisted(() => vi.fn())

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
    leaveRequestNew: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockEmployeeFindUnique = vi.mocked(prisma.employee.findUnique)
const mockTimeEntryFindMany = vi.mocked(prisma.timeEntry.findMany)
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

beforeEach(() => {
  vi.clearAllMocks()
  mockEmployeeFindUnique.mockResolvedValue(employee('employee-1') as never)
  mockTimeEntryFindMany.mockResolvedValue([])
  mockLeaveRequestFindMany.mockResolvedValue([])
  transactionTimeEntryCreate.mockImplementation(async ({ data }) => ({
    id: `created-${data.date.toISOString().slice(0, 10)}`,
  }))
  transactionTimeEntryUpdate.mockImplementation(async ({ where }) => ({ id: where.id }))
  mockTransaction.mockImplementation(async (callback) => callback({
    timeEntry: {
      create: transactionTimeEntryCreate,
      update: transactionTimeEntryUpdate,
    },
  } as never))
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
        source: 'bulk',
        status: 'pending',
      },
      select: { id: true },
    })
    expect(transactionTimeEntryUpdate.mock.calls[0][0].data).not.toHaveProperty('status')
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
    mockLeaveRequestFindMany.mockResolvedValue([{
      startDate: new Date('2026-07-02T00:00:00.000Z'),
      endDate: new Date('2026-07-03T00:00:00.000Z'),
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
    expect(transactionTimeEntryUpdate).toHaveBeenCalledTimes(1)
    expect(transactionTimeEntryCreate).not.toHaveBeenCalled()
  })

  it('maps a uniqueness race to one row failure and retries valid rows atomically', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    const uniqueError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['employeeId', 'date'] },
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
})
