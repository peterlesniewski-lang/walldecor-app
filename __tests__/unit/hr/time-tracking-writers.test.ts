import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST as createManualTimeEntry } from '@/app/api/hr/time-tracking/route'
import { POST as clockIn } from '@/app/api/hr/time-tracking/clock-in/route'
import { POST as createBulkTimeEntries } from '@/app/api/hr/time-tracking/bulk/route'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    timeEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    leaveRequestNew: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockEmployeeFindFirst = vi.mocked(prisma.employee.findFirst)
const mockEmployeeFindMany = vi.mocked(prisma.employee.findMany)
const mockTimeEntryFindFirst = vi.mocked(prisma.timeEntry.findFirst)
const mockTimeEntryFindMany = vi.mocked(prisma.timeEntry.findMany)
const mockTimeEntryCreate = vi.mocked(prisma.timeEntry.create)
const mockLeaveRequestFindMany = vi.mocked(prisma.leaveRequestNew.findMany)
const mockTransaction = vi.mocked(prisma.$transaction)

function session(role: 'ADMIN' | 'EMPLOYEE') {
  return {
    user: {
      id: `${role.toLowerCase()}-user`,
      name: role,
      email: `${role.toLowerCase()}@test.pl`,
      role,
      employeeId: role === 'EMPLOYEE' ? 'employee-1' : null,
    },
    expires: '',
  }
}

function manualRequest() {
  return new NextRequest('http://localhost/api/hr/time-tracking', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: 'employee-1',
      date: '2026-07-02',
      clockIn: '2026-07-02T09:00:00.000Z',
      clockOut: '2026-07-02T17:00:00.000Z',
    }),
  })
}

const expectedLogicalDayQuery = {
  gte: new Date('2026-07-01T00:00:00.000Z'),
  lte: new Date('2026-07-03T23:59:59.999Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTimeEntryFindFirst.mockResolvedValue(null)
  mockTimeEntryFindMany.mockResolvedValue([])
  mockTimeEntryCreate.mockResolvedValue({ id: 'entry-1' } as never)
  mockLeaveRequestFindMany.mockResolvedValue([])
  mockTransaction.mockImplementation(async (callback) => callback(prisma as never) as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('time entry writer business dates', () => {
  it('stores manual entries at UTC midnight of the Warsaw business date', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const response = await createManualTimeEntry(manualRequest())

    expect(response.status).toBe(201)
    expect(mockTimeEntryFindMany).toHaveBeenCalledWith({
      where: {
        employeeId: 'employee-1',
        date: expectedLogicalDayQuery,
      },
      select: { id: true, date: true },
    })
    expect(mockTimeEntryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        date: new Date('2026-07-02T00:00:00.000Z'),
      }),
    }))
  })

  it('blocks manual creation when a legacy row maps to the Warsaw business date', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'legacy-entry',
      date: new Date('2026-07-01T22:00:00.000Z'),
    }] as never)

    const response = await createManualTimeEntry(manualRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Entry already exists for this employee on this date',
    })
    expect(mockTimeEntryCreate).not.toHaveBeenCalled()
  })

  it('blocks manual creation on approved leave but ignores remote work and delegation', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockLeaveRequestFindMany.mockResolvedValue([{
      startDate: new Date('2026-07-02T00:00:00.000Z'),
      endDate: new Date('2026-07-02T00:00:00.000Z'),
      isRemoteWork: false,
      isDelegation: false,
    }] as never)

    const blocked = await createManualTimeEntry(manualRequest())

    expect(blocked.status).toBe(409)
    expect(mockTimeEntryCreate).not.toHaveBeenCalled()

    mockLeaveRequestFindMany.mockResolvedValue([{
      startDate: new Date('2026-07-02T00:00:00.000Z'),
      endDate: new Date('2026-07-02T00:00:00.000Z'),
      isRemoteWork: true,
      isDelegation: false,
    }] as never)

    const allowed = await createManualTimeEntry(manualRequest())

    expect(allowed.status).toBe(201)
    expect(mockTimeEntryCreate).toHaveBeenCalledTimes(1)
  })

  it('stores clock-in at UTC midnight of the current Warsaw business date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T22:30:00.000Z'))
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE'))
    mockEmployeeFindFirst.mockResolvedValue({ id: 'employee-1' } as never)

    const response = await clockIn(new NextRequest('http://localhost/api/hr/time-tracking/clock-in', {
      method: 'POST',
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(201)
    expect(mockTimeEntryFindMany).toHaveBeenCalledWith({
      where: {
        employeeId: 'employee-1',
        date: expectedLogicalDayQuery,
      },
      select: { id: true, date: true },
    })
    expect(mockTimeEntryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        date: new Date('2026-07-02T00:00:00.000Z'),
        clockIn: new Date('2026-07-01T22:30:00.000Z'),
      }),
    }))
  })

  it('blocks clock-in when a legacy row maps to the current Warsaw business date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T22:30:00.000Z'))
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE'))
    mockEmployeeFindFirst.mockResolvedValue({ id: 'employee-1' } as never)
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'legacy-entry',
      date: new Date('2026-07-01T22:00:00.000Z'),
    }] as never)

    const response = await clockIn(new NextRequest('http://localhost/api/hr/time-tracking/clock-in', {
      method: 'POST',
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Entry already exists for today' })
    expect(mockTimeEntryCreate).not.toHaveBeenCalled()
  })

  it('blocks clock-in on approved leave', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T22:30:00.000Z'))
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE'))
    mockEmployeeFindFirst.mockResolvedValue({ id: 'employee-1' } as never)
    mockLeaveRequestFindMany.mockResolvedValue([{
      startDate: new Date('2026-07-02T00:00:00.000Z'),
      endDate: new Date('2026-07-02T00:00:00.000Z'),
      isRemoteWork: false,
      isDelegation: false,
    }] as never)

    const response = await clockIn(new NextRequest('http://localhost/api/hr/time-tracking/clock-in', {
      method: 'POST',
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(409)
    expect(mockTimeEntryCreate).not.toHaveBeenCalled()
  })

  it('skips bulk creation when a legacy row maps to the Warsaw business date', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockEmployeeFindMany.mockResolvedValue([{ id: 'employee-1' }] as never)
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'legacy-entry',
      date: new Date('2026-07-01T22:00:00.000Z'),
    }] as never)

    const response = await createBulkTimeEntries(
      new NextRequest('http://localhost/api/hr/time-tracking/bulk', {
        method: 'POST',
        body: JSON.stringify({
          employeeIds: ['employee-1'],
          startDate: '2026-07-02',
          endDate: '2026-07-02',
          clockInUtc: '2026-07-02T08:00:00.000Z',
          clockOutUtc: '2026-07-02T16:00:00.000Z',
          skipWeekends: false,
        }),
      })
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ created: 0, skipped: 1 })
    expect(mockTimeEntryFindMany).toHaveBeenCalledWith({
      where: {
        employeeId: 'employee-1',
        date: expectedLogicalDayQuery,
      },
      select: { id: true, date: true },
    })
    expect(mockTimeEntryCreate).not.toHaveBeenCalled()
  })

  it('skips bulk creation on approved leave', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockEmployeeFindMany.mockResolvedValue([{ id: 'employee-1' }] as never)
    mockLeaveRequestFindMany.mockResolvedValue([{
      startDate: new Date('2026-07-02T00:00:00.000Z'),
      endDate: new Date('2026-07-02T00:00:00.000Z'),
      isRemoteWork: false,
      isDelegation: false,
    }] as never)

    const response = await createBulkTimeEntries(
      new NextRequest('http://localhost/api/hr/time-tracking/bulk', {
        method: 'POST',
        body: JSON.stringify({
          employeeIds: ['employee-1'],
          startDate: '2026-07-02',
          endDate: '2026-07-02',
          clockInUtc: '2026-07-02T08:00:00.000Z',
          clockOutUtc: '2026-07-02T16:00:00.000Z',
          skipWeekends: false,
        }),
      })
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ created: 0, skipped: 1 })
    expect(mockTimeEntryCreate).not.toHaveBeenCalled()
  })
})
