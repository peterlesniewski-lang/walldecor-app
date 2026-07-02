import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET as getWeeklyTimeTracking } from '@/app/api/hr/time-tracking/weekly/route'
import { POST as createTimeEntry } from '@/app/api/hr/time-tracking/route'
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
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    timeEntry: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    leaveRequestNew: {
      findMany: vi.fn(),
    },
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockEmployeeFindUnique = vi.mocked(prisma.employee.findUnique)
const mockEmployeeFindMany = vi.mocked(prisma.employee.findMany)
const mockTimeEntryFindMany = vi.mocked(prisma.timeEntry.findMany)
const mockTimeEntryFindFirst = vi.mocked(prisma.timeEntry.findFirst)
const mockTimeEntryCreate = vi.mocked(prisma.timeEntry.create)
const mockLeaveRequestFindMany = vi.mocked(prisma.leaveRequestNew.findMany)

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE', employeeId: string | null = null) {
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HR operational access scoping', () => {
  it('scopes weekly time tracking for managers to their linked division', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
    mockEmployeeFindUnique.mockResolvedValue({ id: 'manager-1', divisionId: 'JAG', active: true })
    mockEmployeeFindMany.mockResolvedValue([])
    mockTimeEntryFindMany.mockResolvedValue([])
    mockLeaveRequestFindMany.mockResolvedValue([])

    const response = await getWeeklyTimeTracking(new NextRequest('http://localhost/api/hr/time-tracking/weekly?week=2026-W27'))

    expect(response.status).toBe(200)
    expect(mockEmployeeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, divisionId: 'JAG' },
    }))
  })

  it('does not expose weekly time tracking to managers without a linked profile', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER'))

    const response = await getWeeklyTimeTracking(new NextRequest('http://localhost/api/hr/time-tracking/weekly?week=2026-W27'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.employees).toEqual([])
    expect(mockEmployeeFindMany).not.toHaveBeenCalled()
  })

  it('blocks managers from creating a manual time entry outside their division', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
    mockEmployeeFindUnique
      .mockResolvedValueOnce({ id: 'manager-1', divisionId: 'JAG', active: true })
      .mockResolvedValueOnce({ id: 'employee-2', divisionId: 'PUL', active: true })
    mockTimeEntryFindFirst.mockResolvedValue(null)
    mockTimeEntryCreate.mockResolvedValue({ id: 'entry-1' })

    const response = await createTimeEntry(new NextRequest('http://localhost/api/hr/time-tracking', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'employee-2',
        date: '2026-07-02',
        clockIn: '2026-07-02T08:00:00.000Z',
        clockOut: '2026-07-02T16:00:00.000Z',
      }),
    }))

    expect(response.status).toBe(403)
    expect(mockTimeEntryCreate).not.toHaveBeenCalled()
  })

  it('blocks bulk time entries when any selected employee is outside the manager division', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
    mockEmployeeFindUnique.mockResolvedValue({ id: 'manager-1', divisionId: 'JAG', active: true })
    mockEmployeeFindMany.mockResolvedValue([{ id: 'employee-1' }])

    const response = await createBulkTimeEntries(new NextRequest('http://localhost/api/hr/time-tracking/bulk', {
      method: 'POST',
      body: JSON.stringify({
        employeeIds: ['employee-1', 'employee-2'],
        startDate: '2026-07-01',
        endDate: '2026-07-01',
        clockInUtc: '2026-07-01T08:00:00.000Z',
        clockOutUtc: '2026-07-01T16:00:00.000Z',
        skipWeekends: false,
      }),
    }))

    expect(response.status).toBe(403)
    expect(mockTimeEntryCreate).not.toHaveBeenCalled()
  })
})
