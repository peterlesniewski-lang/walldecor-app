import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { loadTimeTrackingRange } from '@/lib/hr/time-tracking/range-loader'
import { GET } from '@/app/api/hr/time-tracking/monthly/route'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/hr/time-tracking/range-loader', () => ({
  loadTimeTrackingRange: vi.fn(),
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockLoadRange = vi.mocked(loadTimeTrackingRange)
const originalTimezone = process.env.TZ

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

function request(query = '') {
  const suffix = query ? `?${query}` : ''
  return new NextRequest(`http://localhost/api/hr/time-tracking/monthly${suffix}`)
}

const julyData = {
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  days: ['2026-07-01', '2026-07-31'],
  employees: [{
    id: 'employee-1',
    firstName: 'Anna',
    lastName: 'Kowalska',
    divisionId: 'JAG',
    divisionName: 'Jagiellonska',
    avatarUrl: null,
    entries: {
      '2026-07-01': {
        id: 'entry-1',
        clockIn: '2026-07-01T09:00:00.000Z',
        clockOut: '2026-07-01T17:00:00.000Z',
        totalMinutes: 450,
        breakMinutes: 30,
        status: 'approved',
        leaveType: 'Urlop bezplatny',
        leaveCode: 'UB',
        leaveColor: '#64748B',
      },
    },
  }],
  dailyTotals: {
    '2026-07-01': 450,
    '2026-07-31': 0,
  },
  holidays: [{ date: '2026-07-10', name: 'Dzien wolny', divisionId: 'JAG' }],
  saturdayWorkable: true,
  standardClockIn: '11:00',
  standardClockOut: '19:00',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadRange.mockResolvedValue(julyData)
})

afterEach(() => {
  vi.useRealTimers()
  if (originalTimezone === undefined) {
    delete process.env.TZ
  } else {
    process.env.TZ = originalTimezone
  }
})

describe('GET /api/hr/time-tracking/monthly', () => {
  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await GET(request('month=2026-07'))

    expect(response.status).toBe(401)
    expect(mockLoadRange).not.toHaveBeenCalled()
  })

  it('rejects employee accounts', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const response = await GET(request('month=2026-07'))

    expect(response.status).toBe(403)
    expect(mockLoadRange).not.toHaveBeenCalled()
  })

  it('rejects invalid month input', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const response = await GET(request('month=2026-13'))

    expect(response.status).toBe(400)
    expect(mockLoadRange).not.toHaveBeenCalled()
  })

  it('defaults to the Warsaw business month at a UTC month boundary', async () => {
    process.env.TZ = 'UTC'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T22:30:00.000Z'))
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const response = await GET(request())
    const input = mockLoadRange.mock.calls[0][0]

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ month: '2026-09' })
    expect([
      input.start.getFullYear(),
      input.start.getMonth() + 1,
      input.start.getDate(),
      input.end.getFullYear(),
      input.end.getMonth() + 1,
      input.end.getDate(),
    ]).toEqual([2026, 9, 1, 2026, 9, 30])
  })

  it('rejects years below 1000 before calling the range loader', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const response = await GET(request('month=0999-07'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Month year must be 1000 or later' })
    expect(mockLoadRange).not.toHaveBeenCalled()
  })

  it('accepts year 1000 and returns canonical four-digit range keys', async () => {
    process.env.TZ = 'UTC'
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockLoadRange.mockResolvedValueOnce({
      ...julyData,
      startDate: '1000-07-01',
      endDate: '1000-07-31',
      days: ['1000-07-01', '1000-07-31'],
      employees: [],
      dailyTotals: {
        '1000-07-01': 0,
        '1000-07-31': 0,
      },
      holidays: [],
    })

    const response = await GET(request('month=1000-07'))
    const input = mockLoadRange.mock.calls[0][0]

    expect(response.status).toBe(200)
    expect([
      input.start.getFullYear(),
      input.start.getMonth() + 1,
      input.start.getDate(),
      input.end.getFullYear(),
      input.end.getMonth() + 1,
      input.end.getDate(),
    ]).toEqual([1000, 7, 1, 1000, 7, 31])
    expect(await response.json()).toMatchObject({
      month: '1000-07',
      monthStart: '1000-07-01',
      monthEnd: '1000-07-31',
      days: ['1000-07-01', '1000-07-31'],
      dailyTotals: {
        '1000-07-01': 0,
        '1000-07-31': 0,
      },
    })
  })

  it('loads exactly the requested month with all filters and returns the monthly contract', async () => {
    const adminSession = session('ADMIN')
    mockGetServerSession.mockResolvedValue(adminSession)

    const response = await GET(request(
      'month=2026-07&divisionId=JAG&departmentId=sales&employeeId=employee-1'
    ))
    const input = mockLoadRange.mock.calls[0][0]

    expect(input).toEqual({
      session: adminSession,
      start: expect.any(Date),
      end: expect.any(Date),
      divisionId: 'JAG',
      departmentId: 'sales',
      employeeId: 'employee-1',
    })
    expect([
      input.start.getFullYear(),
      input.start.getMonth() + 1,
      input.start.getDate(),
      input.start.getHours(),
      input.start.getMinutes(),
      input.start.getSeconds(),
      input.start.getMilliseconds(),
    ]).toEqual([2026, 7, 1, 0, 0, 0, 0])
    expect([
      input.end.getFullYear(),
      input.end.getMonth() + 1,
      input.end.getDate(),
      input.end.getHours(),
      input.end.getMinutes(),
      input.end.getSeconds(),
      input.end.getMilliseconds(),
    ]).toEqual([2026, 7, 31, 23, 59, 59, 999])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      month: '2026-07',
      monthStart: julyData.startDate,
      monthEnd: julyData.endDate,
      days: julyData.days,
      employees: julyData.employees,
      dailyTotals: julyData.dailyTotals,
      holidays: julyData.holidays,
      saturdayWorkable: julyData.saturdayWorkable,
      standardClockIn: julyData.standardClockIn,
      standardClockOut: julyData.standardClockOut,
    })
  })
})
