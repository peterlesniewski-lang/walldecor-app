import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { getHrSettings } from '@/lib/hr/hr-settings'
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
    customHoliday: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/hr/hr-settings', () => ({
  getHrSettings: vi.fn(),
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockEmployeeFindUnique = vi.mocked(prisma.employee.findUnique)
const mockEmployeeFindMany = vi.mocked(prisma.employee.findMany)
const mockTimeEntryFindMany = vi.mocked(prisma.timeEntry.findMany)
const mockTimeEntryFindFirst = vi.mocked(prisma.timeEntry.findFirst)
const mockTimeEntryCreate = vi.mocked(prisma.timeEntry.create)
const mockLeaveRequestFindMany = vi.mocked(prisma.leaveRequestNew.findMany)
const mockCustomHolidayFindMany = vi.mocked(prisma.customHoliday.findMany)
const mockGetHrSettings = vi.mocked(getHrSettings)

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
  mockCustomHolidayFindMany.mockResolvedValue([])
  mockGetHrSettings.mockResolvedValue({
    saturdayWorkable: true,
    standardClockIn: '11:00',
    standardClockOut: '19:00',
    overtimeThresholdMinutes: 480,
  })
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

  it('preserves the exact weekly response shape without loader-only entry fields', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockEmployeeFindMany.mockResolvedValue([{
      id: 'employee-1',
      firstName: 'Anna',
      lastName: 'Kowalska',
      divisionId: 'JAG',
      avatarUrl: null,
      division: { name: 'Jagiellonska' },
    }] as never)
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      employeeId: 'employee-1',
      date: new Date('2026-07-02T00:00:00.000Z'),
      clockIn: new Date('2026-07-02T09:00:00.000Z'),
      clockOut: new Date('2026-07-02T17:00:00.000Z'),
      totalMinutes: 480,
      breakMinutes: 30,
      status: 'pending',
    }] as never)
    mockLeaveRequestFindMany.mockResolvedValue([{
      employeeId: 'employee-1',
      startDate: new Date('2026-07-02T00:00:00.000Z'),
      endDate: new Date('2026-07-02T00:00:00.000Z'),
      leaveType: {
        name: 'Urlop bezplatny',
        code: 'UB',
        color: '#64748B',
      },
    }] as never)

    const response = await getWeeklyTimeTracking(
      new NextRequest('http://localhost/api/hr/time-tracking/weekly?week=2026-W27')
    )

    expect(await response.json()).toEqual({
      weekStart: '2026-06-29',
      weekEnd: '2026-07-05',
      days: [
        '2026-06-29',
        '2026-06-30',
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
        '2026-07-04',
        '2026-07-05',
      ],
      employees: [{
        id: 'employee-1',
        firstName: 'Anna',
        lastName: 'Kowalska',
        divisionId: 'JAG',
        divisionName: 'Jagiellonska',
        avatarUrl: null,
        entries: {
          '2026-07-02': {
            id: 'entry-1',
            clockIn: '2026-07-02T09:00:00.000Z',
            clockOut: '2026-07-02T17:00:00.000Z',
            totalMinutes: 480,
            status: 'pending',
            leaveType: 'Urlop bezplatny',
            leaveColor: '#64748B',
          },
        },
      }],
      dailyTotals: {
        '2026-06-29': 0,
        '2026-06-30': 0,
        '2026-07-01': 0,
        '2026-07-02': 480,
        '2026-07-03': 0,
        '2026-07-04': 0,
        '2026-07-05': 0,
      },
    })
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
