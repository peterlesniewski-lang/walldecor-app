import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getHrSettings } from '@/lib/hr/hr-settings'
import { loadTimeTrackingRange } from '@/lib/hr/time-tracking/range-loader'
import type { HrSessionLike } from '@/lib/hr/access'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    timeEntry: {
      findMany: vi.fn(),
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

const mockEmployeeFindUnique = vi.mocked(prisma.employee.findUnique)
const mockEmployeeFindMany = vi.mocked(prisma.employee.findMany)
const mockTimeEntryFindMany = vi.mocked(prisma.timeEntry.findMany)
const mockLeaveRequestFindMany = vi.mocked(prisma.leaveRequestNew.findMany)
const mockCustomHolidayFindMany = vi.mocked(prisma.customHoliday.findMany)
const mockGetHrSettings = vi.mocked(getHrSettings)

function session(role: HrSessionLike['user']['role'], employeeId: string | null = null): HrSessionLike {
  return { user: { role, employeeId } }
}

function julyRange() {
  return {
    start: new Date(2026, 6, 1, 0, 0, 0, 0),
    end: new Date(2026, 6, 31, 23, 59, 59, 999),
  }
}

const employee = {
  id: 'employee-1',
  firstName: 'Anna',
  lastName: 'Kowalska',
  divisionId: 'JAG',
  avatarUrl: null,
  division: { name: 'Jagiellonska' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEmployeeFindUnique.mockResolvedValue(null)
  mockEmployeeFindMany.mockResolvedValue([])
  mockTimeEntryFindMany.mockResolvedValue([])
  mockLeaveRequestFindMany.mockResolvedValue([])
  mockCustomHolidayFindMany.mockResolvedValue([])
  mockGetHrSettings.mockResolvedValue({
    saturdayWorkable: true,
    standardClockIn: '11:00',
    standardClockOut: '19:00',
    overtimeThresholdMinutes: 480,
  })
})

describe('loadTimeTrackingRange', () => {
  it('scopes a manager to their division', async () => {
    mockEmployeeFindUnique.mockResolvedValue({
      id: 'manager-1',
      divisionId: 'JAG',
      active: true,
    } as never)

    const result = await loadTimeTrackingRange({
      session: session('MANAGER', 'manager-1'),
      ...julyRange(),
    })

    expect(mockEmployeeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, divisionId: 'JAG' },
    }))
    expect(result.employees).toEqual([])
  })

  it('returns an empty result when a manager filters outside their division', async () => {
    mockEmployeeFindUnique.mockResolvedValue({
      id: 'manager-1',
      divisionId: 'JAG',
      active: true,
    } as never)

    const result = await loadTimeTrackingRange({
      session: session('MANAGER', 'manager-1'),
      divisionId: 'PUL',
      ...julyRange(),
    })

    expect(result.employees).toEqual([])
    expect(mockEmployeeFindMany).not.toHaveBeenCalled()
  })

  it('returns an empty result for a manager without an employee profile', async () => {
    const result = await loadTimeTrackingRange({
      session: session('MANAGER'),
      ...julyRange(),
    })

    expect(result.employees).toEqual([])
    expect(mockEmployeeFindMany).not.toHaveBeenCalled()
  })

  it('applies optional filters and selects only range response fields', async () => {
    await loadTimeTrackingRange({
      session: session('ADMIN'),
      divisionId: 'JAG',
      departmentId: 'sales',
      employeeId: 'employee-1',
      ...julyRange(),
    })

    expect(mockEmployeeFindMany).toHaveBeenCalledWith({
      where: {
        active: true,
        divisionId: 'JAG',
        departmentId: 'sales',
        id: 'employee-1',
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        divisionId: true,
        avatarUrl: true,
        division: { select: { name: true } },
      },
    })
  })

  it('overlays approved leave without replacing an existing time entry', async () => {
    mockEmployeeFindMany.mockResolvedValue([employee] as never)
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
        name: 'Urlop bezpłatny',
        code: 'UB',
        color: '#64748B',
      },
    }] as never)

    const result = await loadTimeTrackingRange({
      session: session('ADMIN'),
      ...julyRange(),
    })

    expect(result.employees[0].entries['2026-07-02']).toMatchObject({
      id: 'entry-1',
      breakMinutes: 30,
      leaveType: 'Urlop bezpłatny',
      leaveCode: 'UB',
      leaveColor: '#64748B',
    })
  })

  it('computes stable date keys and daily totals for the full range', async () => {
    mockEmployeeFindMany.mockResolvedValue([employee] as never)
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      employeeId: 'employee-1',
      date: new Date('2026-07-02T00:00:00.000Z'),
      clockIn: new Date('2026-07-02T09:00:00.000Z'),
      clockOut: null,
      totalMinutes: 420,
      breakMinutes: 15,
      status: 'approved',
    }] as never)

    const result = await loadTimeTrackingRange({
      session: session('ADMIN'),
      start: new Date(2026, 6, 1, 0, 0, 0, 0),
      end: new Date(2026, 6, 3, 23, 59, 59, 999),
    })

    expect(result.days).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
    expect(result.dailyTotals).toEqual({
      '2026-07-01': 0,
      '2026-07-02': 420,
      '2026-07-03': 0,
    })
  })

  it('returns global and selected-division holidays in the range', async () => {
    mockCustomHolidayFindMany.mockResolvedValue([
      { date: new Date('2026-07-09T00:00:00.000Z'), name: 'Dzien globalny', divisionId: null },
      { date: new Date('2026-07-10T00:00:00.000Z'), name: 'Dzien wolny', divisionId: 'JAG' },
    ] as never)

    const result = await loadTimeTrackingRange({
      session: session('ADMIN'),
      divisionId: 'JAG',
      ...julyRange(),
    })

    expect(mockCustomHolidayFindMany).toHaveBeenCalledWith({
      where: {
        date: {
          gte: new Date('2026-06-30T00:00:00.000Z'),
          lte: new Date('2026-08-01T23:59:59.999Z'),
        },
        OR: [{ divisionId: null }, { divisionId: 'JAG' }],
      },
      orderBy: { date: 'asc' },
      select: { date: true, name: true, divisionId: true },
    })
    expect(result.holidays).toEqual([
      { date: '2026-07-09', name: 'Dzien globalny', divisionId: null },
      { date: '2026-07-10', name: 'Dzien wolny', divisionId: 'JAG' },
    ])
  })

  it.each(['UTC', 'America/Los_Angeles', 'Europe/Warsaw'])(
    'loads mixed persisted date representations without range leakage in %s',
    async (timezone) => {
      const originalTimezone = process.env.TZ
      process.env.TZ = timezone

      try {
        mockEmployeeFindMany.mockResolvedValue([employee] as never)
        mockTimeEntryFindMany.mockResolvedValue([
          {
            id: 'entry-utc',
            employeeId: 'employee-1',
            date: new Date('2026-07-01T00:00:00.000Z'),
            clockIn: new Date('2026-07-01T09:00:00.000Z'),
            clockOut: new Date('2026-07-01T17:00:00.000Z'),
            totalMinutes: 480,
            breakMinutes: 30,
            status: 'approved',
          },
          {
            id: 'entry-local',
            employeeId: 'employee-1',
            date: new Date(2026, 6, 2, 0, 0, 0, 0),
            clockIn: new Date('2026-07-02T09:00:00.000Z'),
            clockOut: new Date('2026-07-02T16:00:00.000Z'),
            totalMinutes: 420,
            breakMinutes: 15,
            status: 'pending',
          },
          {
            id: 'entry-outside',
            employeeId: 'employee-1',
            date: new Date(2026, 5, 30, 0, 0, 0, 0),
            clockIn: new Date('2026-06-30T09:00:00.000Z'),
            clockOut: new Date('2026-06-30T10:00:00.000Z'),
            totalMinutes: 60,
            breakMinutes: 0,
            status: 'approved',
          },
        ] as never)
        mockLeaveRequestFindMany.mockResolvedValue([
          {
            employeeId: 'employee-1',
            startDate: new Date(2026, 6, 2, 0, 0, 0, 0),
            endDate: new Date(2026, 6, 2, 0, 0, 0, 0),
            leaveType: {
              name: 'Urlop bezplatny',
              code: 'UB',
              color: '#64748B',
            },
          },
          {
            employeeId: 'employee-1',
            startDate: new Date('2026-07-03T00:00:00.000Z'),
            endDate: new Date('2026-07-03T00:00:00.000Z'),
            leaveType: {
              name: 'Urlop wypoczynkowy',
              code: 'VL',
              color: '#16A34A',
            },
          },
          {
            employeeId: 'employee-1',
            startDate: new Date(2026, 5, 30, 0, 0, 0, 0),
            endDate: new Date(2026, 5, 30, 0, 0, 0, 0),
            leaveType: {
              name: 'Poza zakresem',
              code: 'OUT',
              color: '#DC2626',
            },
          },
        ] as never)
        mockCustomHolidayFindMany.mockResolvedValue([
          {
            date: new Date('2026-07-03T00:00:00.000Z'),
            name: 'Dzien UTC',
            divisionId: null,
          },
          {
            date: new Date(2026, 6, 4, 0, 0, 0, 0),
            name: 'Dzien lokalny',
            divisionId: 'JAG',
          },
          {
            date: new Date(2026, 5, 30, 0, 0, 0, 0),
            name: 'Poza zakresem',
            divisionId: null,
          },
        ] as never)

        const result = await loadTimeTrackingRange({
          session: session('ADMIN'),
          start: new Date(2026, 6, 1, 0, 0, 0, 0),
          end: new Date(2026, 6, 4, 23, 59, 59, 999),
        })

        const expectedQueryRange = {
          gte: new Date('2026-06-30T00:00:00.000Z'),
          lte: new Date('2026-07-05T23:59:59.999Z'),
        }

        expect(mockTimeEntryFindMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ date: expectedQueryRange }),
        }))
        expect(mockLeaveRequestFindMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({
            startDate: { lte: expectedQueryRange.lte },
            endDate: { gte: expectedQueryRange.gte },
          }),
        }))
        expect(mockCustomHolidayFindMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ date: expectedQueryRange }),
        }))
        expect(result.employees[0].entries).toEqual({
          '2026-07-01': expect.objectContaining({ id: 'entry-utc' }),
          '2026-07-02': expect.objectContaining({
            id: 'entry-local',
            leaveCode: 'UB',
            totalMinutes: 420,
          }),
          '2026-07-03': expect.objectContaining({
            leaveCode: 'VL',
            status: 'leave',
          }),
        })
        expect(result.dailyTotals).toEqual({
          '2026-07-01': 480,
          '2026-07-02': 420,
          '2026-07-03': 0,
          '2026-07-04': 0,
        })
        expect(result.holidays).toEqual([
          { date: '2026-07-03', name: 'Dzien UTC', divisionId: null },
          { date: '2026-07-04', name: 'Dzien lokalny', divisionId: 'JAG' },
        ])
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ
        else process.env.TZ = originalTimezone
      }
    }
  )

  it('includes HR working-time settings', async () => {
    mockGetHrSettings.mockResolvedValue({
      saturdayWorkable: false,
      standardClockIn: '08:00',
      standardClockOut: '16:00',
      overtimeThresholdMinutes: 450,
    })

    const result = await loadTimeTrackingRange({
      session: session('ADMIN'),
      ...julyRange(),
    })

    expect(result).toMatchObject({
      saturdayWorkable: false,
      standardClockIn: '08:00',
      standardClockOut: '16:00',
    })
  })
})
