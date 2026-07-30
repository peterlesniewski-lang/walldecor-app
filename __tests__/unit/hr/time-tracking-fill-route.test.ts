import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { getHrSettings } from '@/lib/hr/hr-settings'
import { POST } from '@/app/api/hr/time-tracking/monthly/fill/route'

const txTimeEntryFindMany = vi.hoisted(() => vi.fn())
const txTimeEntryCreate = vi.hoisted(() => vi.fn())
const txTimeEntryUpdate = vi.hoisted(() => vi.fn())
const txLeaveRequestFindMany = vi.hoisted(() => vi.fn())
const txCustomHolidayFindMany = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/hr/hr-settings', () => ({
  getHrSettings: vi.fn(),
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
    customHoliday: {
      findMany: vi.fn(),
    },
    timeTrackingRule: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockEmployeeFindUnique = vi.mocked(prisma.employee.findUnique)
const mockTimeEntryFindMany = vi.mocked(prisma.timeEntry.findMany)
const mockLeaveRequestFindMany = vi.mocked(prisma.leaveRequestNew.findMany)
const mockCustomHolidayFindMany = vi.mocked(prisma.customHoliday.findMany)
const mockTimeRuleFindFirst = vi.mocked(prisma.timeTrackingRule.findFirst)
const mockTransaction = vi.mocked(prisma.$transaction)
const mockGetHrSettings = vi.mocked(getHrSettings)

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

function employee(id: string, divisionId = 'JAG') {
  return { id, divisionId, active: true }
}

function row(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    clockIn: `${date}T07:00:00.000Z`,
    clockOut: `${date}T15:00:00.000Z`,
    breakMinutes: 30,
    ...overrides,
  }
}

function request(
  rows: Array<Record<string, unknown>>,
  options: {
    employeeId?: string
    overwrite?: boolean
    preview?: boolean
  } = {}
) {
  return new NextRequest('http://localhost/api/hr/time-tracking/monthly/fill', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: options.employeeId ?? 'employee-1',
      rows,
      overwrite: options.overwrite ?? false,
      preview: options.preview ?? true,
    }),
  })
}

function transactionClient() {
  return {
    timeEntry: {
      findMany: txTimeEntryFindMany,
      create: txTimeEntryCreate,
      update: txTimeEntryUpdate,
    },
    leaveRequestNew: {
      findMany: txLeaveRequestFindMany,
    },
    customHoliday: {
      findMany: txCustomHolidayFindMany,
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockGetServerSession.mockResolvedValue(session('ADMIN'))
  mockEmployeeFindUnique.mockResolvedValue(employee('employee-1') as never)
  mockTimeEntryFindMany.mockResolvedValue([])
  mockLeaveRequestFindMany.mockResolvedValue([])
  mockCustomHolidayFindMany.mockResolvedValue([])
  mockTimeRuleFindFirst.mockResolvedValue(null)
  mockGetHrSettings.mockResolvedValue({
    saturdayWorkable: false,
    standardClockIn: '11:00',
    standardClockOut: '19:00',
    overtimeThresholdMinutes: 480,
  })
  txTimeEntryFindMany.mockResolvedValue([])
  txLeaveRequestFindMany.mockResolvedValue([])
  txCustomHolidayFindMany.mockResolvedValue([])
  txTimeEntryCreate.mockImplementation(async ({ data }) => ({
    id: `created-${data.date.toISOString().slice(0, 10)}`,
  }))
  txTimeEntryUpdate.mockImplementation(async ({ where }) => ({ id: where.id }))
  mockTransaction.mockImplementation(async (callback) =>
    callback(transactionClient() as never)
  )
})

describe('POST /api/hr/time-tracking/monthly/fill', () => {
  it('rejects employee accounts', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const response = await POST(request([row('2026-07-01')]))

    expect(response.status).toBe(403)
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
  })

  it('does not expose whether an employee exists to an out-of-scope manager', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
    mockEmployeeFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(employee('manager-1', 'JAG') as never)

    const missing = await POST(request([row('2026-07-01')], {
      employeeId: 'missing',
    }))

    expect(missing.status).toBe(403)
    expect(await missing.json()).toEqual({ error: 'Forbidden' })

    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
    mockEmployeeFindUnique
      .mockResolvedValueOnce(employee('employee-1', 'PUL') as never)
      .mockResolvedValueOnce(employee('manager-1', 'JAG') as never)

    const outsideScope = await POST(request([row('2026-07-01')]))

    expect(outsideScope.status).toBe(403)
    expect(await outsideScope.json()).toEqual({ error: 'Forbidden' })
  })

  it('returns 404 for an admin targeting a missing employee', async () => {
    mockEmployeeFindUnique.mockResolvedValueOnce(null)

    const response = await POST(request([row('2026-07-01')], {
      employeeId: 'missing',
    }))

    expect(response.status).toBe(404)
  })

  it('rejects duplicate logical dates and invalid row counts', async () => {
    const duplicate = await POST(request([
      row('2026-07-01'),
      row('2026-07-01', { clockIn: '2026-07-01T08:00:00.000Z' }),
    ]))
    const empty = await POST(request([]))

    expect(duplicate.status).toBe(400)
    expect(await duplicate.json()).toEqual({ error: 'Duplicate dates are not allowed' })
    expect(empty.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns a preview without starting a write transaction', async () => {
    const response = await POST(request([row('2026-07-01')]))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      preview: true,
      counts: {
        eligible: 1,
        existing: 0,
        weekends: 0,
        holidays: 0,
        approvedLeave: 0,
        invalid: 0,
      },
      rows: [{ date: '2026-07-01', action: 'create' }],
      saved: [],
    })
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(txTimeEntryCreate).not.toHaveBeenCalled()
  })

  it('skips Sundays and follows the Saturday setting', async () => {
    const rows = [
      row('2026-07-04'),
      row('2026-07-05'),
      row('2026-07-06'),
    ]

    const blockedSaturday = await POST(request(rows))
    expect(await blockedSaturday.json()).toMatchObject({
      counts: { eligible: 1, weekends: 2 },
      rows: [
        { date: '2026-07-04', action: 'skip', reason: 'weekend' },
        { date: '2026-07-05', action: 'skip', reason: 'weekend' },
        { date: '2026-07-06', action: 'create' },
      ],
    })

    mockGetHrSettings.mockResolvedValue({
      saturdayWorkable: true,
      standardClockIn: '11:00',
      standardClockOut: '19:00',
      overtimeThresholdMinutes: 480,
    })
    const workableSaturday = await POST(request(rows))
    expect(await workableSaturday.json()).toMatchObject({
      counts: { eligible: 2, weekends: 1 },
      rows: [
        { date: '2026-07-04', action: 'create' },
        { date: '2026-07-05', action: 'skip', reason: 'weekend' },
        { date: '2026-07-06', action: 'create' },
      ],
    })
  })

  it('skips global, statutory, and employee-division holidays but not another division holiday', async () => {
    mockCustomHolidayFindMany.mockResolvedValue([
      {
        date: new Date('2026-07-01T00:00:00.000Z'),
        divisionId: null,
      },
      {
        date: new Date('2026-07-02T00:00:00.000Z'),
        divisionId: 'JAG',
      },
      {
        date: new Date('2026-07-03T00:00:00.000Z'),
        divisionId: 'PUL',
      },
    ] as never)

    const response = await POST(request([
      row('2026-07-01'),
      row('2026-07-02'),
      row('2026-07-03'),
      row('2026-08-15', {
        clockIn: '2026-08-15T07:00:00.000Z',
        clockOut: '2026-08-15T15:00:00.000Z',
      }),
    ]))

    expect(await response.json()).toMatchObject({
      counts: { eligible: 1, holidays: 3 },
      rows: [
        { date: '2026-07-01', action: 'skip', reason: 'holiday' },
        { date: '2026-07-02', action: 'skip', reason: 'holiday' },
        { date: '2026-07-03', action: 'create' },
        { date: '2026-08-15', action: 'skip', reason: 'holiday' },
      ],
    })
  })

  it('skips approved leave but ignores remote work and delegation metadata', async () => {
    mockLeaveRequestFindMany.mockResolvedValue([
      {
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-07-01T00:00:00.000Z'),
        isRemoteWork: false,
        isDelegation: false,
      },
      {
        startDate: new Date('2026-07-02T00:00:00.000Z'),
        endDate: new Date('2026-07-02T00:00:00.000Z'),
        isRemoteWork: true,
        isDelegation: false,
      },
      {
        startDate: new Date('2026-07-03T00:00:00.000Z'),
        endDate: new Date('2026-07-03T00:00:00.000Z'),
        isRemoteWork: false,
        isDelegation: true,
      },
    ] as never)

    const response = await POST(request([
      row('2026-07-01'),
      row('2026-07-02'),
      row('2026-07-03'),
    ]))

    expect(await response.json()).toMatchObject({
      counts: { eligible: 2, approvedLeave: 1 },
      rows: [
        { date: '2026-07-01', action: 'skip', reason: 'approved_leave' },
        { date: '2026-07-02', action: 'create' },
        { date: '2026-07-03', action: 'create' },
      ],
    })
  })

  it('skips existing entries by default and updates them only when overwrite is enabled', async () => {
    mockTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      employeeId: 'employee-1',
      date: new Date('2026-06-30T22:00:00.000Z'),
    }] as never)

    const skipped = await POST(request([row('2026-07-01')]))
    expect(await skipped.json()).toMatchObject({
      counts: { eligible: 0, existing: 1 },
      rows: [{ date: '2026-07-01', action: 'skip', reason: 'existing' }],
    })

    const overwritten = await POST(request([row('2026-07-01')], {
      overwrite: true,
    }))
    expect(await overwritten.json()).toMatchObject({
      counts: { eligible: 1, existing: 0 },
      rows: [{ date: '2026-07-01', action: 'update' }],
    })
  })

  it('applies the exact evaluated rows in one serializable transaction', async () => {
    txTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      employeeId: 'employee-1',
      date: new Date('2026-07-01T00:00:00.000Z'),
    }] as never)

    const response = await POST(request([
      row('2026-07-01'),
      row('2026-07-02'),
    ], {
      overwrite: true,
      preview: false,
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      preview: false,
      counts: {
        eligible: 2,
        existing: 0,
        weekends: 0,
        holidays: 0,
        approvedLeave: 0,
        invalid: 0,
      },
      rows: [
        { date: '2026-07-01', action: 'update' },
        { date: '2026-07-02', action: 'create' },
      ],
      saved: [
        { date: '2026-07-01', entryId: 'entry-1' },
        { date: '2026-07-02', entryId: 'created-2026-07-02' },
      ],
    })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' }
    )
    expect(txTimeEntryUpdate).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: {
        date: new Date('2026-07-01T00:00:00.000Z'),
        clockIn: new Date('2026-07-01T07:00:00.000Z'),
        clockOut: new Date('2026-07-01T15:00:00.000Z'),
        totalMinutes: 480,
        breakMinutes: 30,
        overtimeMinutes: 0,
        source: 'bulk',
      },
      select: { id: true },
    })
    expect(txTimeEntryCreate).toHaveBeenCalledWith({
      data: {
        employeeId: 'employee-1',
        date: new Date('2026-07-02T00:00:00.000Z'),
        clockIn: new Date('2026-07-02T07:00:00.000Z'),
        clockOut: new Date('2026-07-02T15:00:00.000Z'),
        totalMinutes: 480,
        breakMinutes: 30,
        overtimeMinutes: 0,
        source: 'bulk',
        status: 'pending',
      },
      select: { id: true },
    })
  })

  it('never overwrites a day with newly approved leave', async () => {
    txTimeEntryFindMany.mockResolvedValue([{
      id: 'entry-1',
      employeeId: 'employee-1',
      date: new Date('2026-07-01T00:00:00.000Z'),
    }] as never)
    txLeaveRequestFindMany.mockResolvedValue([{
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-07-01T00:00:00.000Z'),
      isRemoteWork: false,
      isDelegation: false,
    }] as never)

    const response = await POST(request([row('2026-07-01')], {
      overwrite: true,
      preview: false,
    }))

    expect(await response.json()).toMatchObject({
      counts: { eligible: 0, approvedLeave: 1 },
      rows: [{
        date: '2026-07-01',
        action: 'skip',
        reason: 'approved_leave',
      }],
      saved: [],
    })
    expect(txTimeEntryUpdate).not.toHaveBeenCalled()
    expect(txTimeEntryCreate).not.toHaveBeenCalled()
  })

  it('returns identical counts and rows for preview and apply when data is unchanged', async () => {
    const rows = [row('2026-07-01'), row('2026-07-04')]

    const previewResponse = await POST(request(rows))
    const preview = await previewResponse.json()

    const applyResponse = await POST(request(rows, { preview: false }))
    const applied = await applyResponse.json()

    expect(applied.counts).toEqual(preview.counts)
    expect(applied.rows).toEqual(preview.rows)
    expect(applied.saved).toHaveLength(1)
  })

  it('marks structurally valid but logically invalid timestamps as invalid', async () => {
    const response = await POST(request([
      row('2026-07-01', {
        clockIn: '2026-07-02T07:00:00.000Z',
        clockOut: '2026-07-02T15:00:00.000Z',
      }),
    ]))

    expect(await response.json()).toMatchObject({
      counts: { eligible: 0, invalid: 1 },
      rows: [{ date: '2026-07-01', action: 'skip', reason: 'invalid' }],
    })
  })
})
