import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import {
  GET,
  POST,
} from '@/app/api/hr/employees/[id]/leave-entitlement/route'

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
    leaveType: {
      findUnique: vi.fn(),
    },
    leaveEntitlementConfig: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    leaveBalanceNew: {
      findUnique: vi.fn(),
    },
    leaveBalanceCorrection: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockEmployeeFindUnique = vi.mocked(prisma.employee.findUnique)
const mockLeaveTypeFindUnique = vi.mocked(prisma.leaveType.findUnique)
const mockConfigFindMany = vi.mocked(prisma.leaveEntitlementConfig.findMany)
const mockConfigFindUnique = vi.mocked(prisma.leaveEntitlementConfig.findUnique)
const mockBalanceFindUnique = vi.mocked(prisma.leaveBalanceNew.findUnique)
const mockCorrectionFindMany = vi.mocked(prisma.leaveBalanceCorrection.findMany)
const mockTransaction = vi.mocked(prisma.$transaction)

const txConfigCreate = vi.fn()
const txBalanceUpsert = vi.fn()
const txCorrectionCreate = vi.fn()

const employee = {
  id: 'employee-1',
  startDate: new Date('2020-01-01T00:00:00.000Z'),
}

const vl = {
  id: 'leave-type-vl',
  code: 'VL',
}

const existingBalance = {
  id: 'balance-1',
  employeeId: employee.id,
  leaveTypeId: vl.id,
  year: 2026,
  totalDays: 26,
  usedDays: 5,
  pendingDays: 2,
  carriedOver: 3,
}

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' = 'ADMIN') {
  return {
    user: {
      id: `${role.toLowerCase()}-1`,
      name: role,
      email: `${role.toLowerCase()}@test.pl`,
      role,
      employeeId: null,
    },
    expires: '',
  }
}

function params(id = employee.id) {
  return { params: Promise.resolve({ id }) }
}

function getRequest(year = 2026) {
  return new NextRequest(
    `http://localhost/api/hr/employees/${employee.id}/leave-entitlement?year=${year}`
  )
}

function postRequest(
  overrides: Record<string, unknown> = {}
) {
  return new NextRequest(
    `http://localhost/api/hr/employees/${employee.id}/leave-entitlement`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'DAYS_20',
        employmentFraction: 1,
        effectiveFrom: '2026-01-01',
        year: 2026,
        preview: true,
        ...overrides,
      }),
    }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(session())
  mockEmployeeFindUnique.mockResolvedValue(employee as never)
  mockLeaveTypeFindUnique.mockResolvedValue(vl as never)
  mockConfigFindMany.mockResolvedValue([])
  mockConfigFindUnique.mockResolvedValue(null)
  mockBalanceFindUnique.mockResolvedValue(null)
  mockCorrectionFindMany.mockResolvedValue([])
  mockTransaction.mockImplementation(
    async (callback) => callback({
      leaveEntitlementConfig: { create: txConfigCreate },
      leaveBalanceNew: { upsert: txBalanceUpsert },
      leaveBalanceCorrection: { create: txCorrectionCreate },
    } as never) as never
  )
})

describe('leave entitlement route access control', () => {
  it.each(['GET', 'POST'] as const)('returns 401 for unauthenticated %s', async (method) => {
    mockGetServerSession.mockResolvedValue(null)

    const response = method === 'GET'
      ? await GET(getRequest(), params())
      : await POST(postRequest(), params())

    expect(response.status).toBe(401)
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
  })

  it.each(['GET', 'POST'] as const)('returns 403 for manager %s', async (method) => {
    mockGetServerSession.mockResolvedValue(session('MANAGER'))

    const response = method === 'GET'
      ? await GET(getRequest(), params())
      : await POST(postRequest(), params())

    expect(response.status).toBe(403)
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
  })
})

describe('POST /api/hr/employees/[id]/leave-entitlement validation', () => {
  it('rejects CUSTOM mode without customAnnualDays', async () => {
    const response = await POST(postRequest({ mode: 'CUSTOM' }), params())

    expect(response.status).toBe(400)
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
  })

  it('rejects effectiveFrom after the target year', async () => {
    const response = await POST(
      postRequest({ effectiveFrom: '2027-01-01', year: 2026 }),
      params()
    )

    expect(response.status).toBe(400)
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
  })

  it('rejects a correction reason longer than the schema maximum as invalid input', async () => {
    mockBalanceFindUnique.mockResolvedValue(existingBalance as never)

    const response = await POST(
      postRequest({
        preview: false,
        correctionReason: 'x'.repeat(1001),
      }),
      params()
    )

    expect(response.status).toBe(400)
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when the employee does not exist', async () => {
    mockEmployeeFindUnique.mockResolvedValue(null)

    const response = await POST(postRequest(), params())

    expect(response.status).toBe(404)
  })

  it('returns a non-2xx response when canonical VL is missing', async () => {
    mockLeaveTypeFindUnique.mockResolvedValue(null)

    const response = await POST(postRequest(), params())
    const body = await response.json()

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(body.error).toContain('VL')
  })
})

describe('GET /api/hr/employees/[id]/leave-entitlement', () => {
  it('marks an employee without an effective config for review', async () => {
    const response = await GET(getRequest(), params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      config: null,
      calculatedDays: null,
      balance: null,
      corrections: [],
      needsReview: true,
    })
  })

  it('selects the latest effective config and returns calculation, balance, and corrections', async () => {
    const oldConfig = {
      id: 'config-old',
      employeeId: employee.id,
      mode: 'DAYS_20',
      customAnnualDays: null,
      employmentFraction: 1,
      effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
      note: null,
      createdById: 'admin-1',
    }
    const latestConfig = {
      ...oldConfig,
      id: 'config-latest',
      mode: 'DAYS_26',
      effectiveFrom: new Date('2025-06-01T00:00:00.000Z'),
    }
    const corrections = [{ id: 'correction-2' }, { id: 'correction-1' }]
    mockConfigFindMany.mockResolvedValue([oldConfig, latestConfig] as never)
    mockBalanceFindUnique.mockResolvedValue(existingBalance as never)
    mockCorrectionFindMany.mockResolvedValue(corrections as never)

    const response = await GET(getRequest(), params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.config.id).toBe(latestConfig.id)
    expect(body.calculatedDays).toBe(26)
    expect(body.balance).toEqual(expect.objectContaining({
      id: existingBalance.id,
      totalDays: 26,
      usedDays: 5,
      pendingDays: 2,
      carriedOver: 3,
    }))
    expect(body.corrections).toEqual(corrections)
    expect(body.needsReview).toBe(false)
    expect(mockConfigFindMany).toHaveBeenCalledWith({
      where: {
        employeeId: employee.id,
        effectiveFrom: { lte: new Date('2026-12-31T23:59:59.999Z') },
      },
    })
    expect(mockCorrectionFindMany).toHaveBeenCalledWith({
      where: { employeeId: employee.id, leaveTypeId: vl.id, year: 2026 },
      orderBy: { createdAt: 'desc' },
    })
  })
})

describe('POST leave entitlement preview', () => {
  it('previews a 26 to 20 day change without performing writes', async () => {
    mockBalanceFindUnique.mockResolvedValue(existingBalance as never)

    const response = await POST(postRequest(), params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(expect.objectContaining({
      calculatedDays: 20,
      currentTotalDays: 26,
      deltaDays: -6,
      requiresCorrection: true,
      input: expect.objectContaining({
        mode: 'DAYS_20',
        customAnnualDays: null,
        employmentFraction: 1,
        year: 2026,
      }),
    }))
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(txConfigCreate).not.toHaveBeenCalled()
    expect(txBalanceUpsert).not.toHaveBeenCalled()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('does not require a correction when no balance exists', async () => {
    const response = await POST(postRequest(), params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(expect.objectContaining({
      calculatedDays: 20,
      currentTotalDays: 0,
      deltaDays: 20,
      requiresCorrection: false,
    }))
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe('POST leave entitlement apply', () => {
  it.each([
    ['missing', undefined],
    ['too short', ' x '],
  ])('returns 422 when a changed balance has a %s correction reason', async (_label, correctionReason) => {
    mockBalanceFindUnique.mockResolvedValue(existingBalance as never)

    const response = await POST(
      postRequest({ preview: false, correctionReason }),
      params()
    )

    expect(response.status).toBe(422)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('appends a config, updates only totalDays, and records exact correction snapshots', async () => {
    const appliedConfig = {
      id: 'config-new',
      employeeId: employee.id,
      mode: 'DAYS_20',
      customAnnualDays: null,
      employmentFraction: 1,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      note: 'Zmiana wymiaru',
      createdById: 'admin-1',
    }
    const appliedBalance = { ...existingBalance, totalDays: 20 }
    mockBalanceFindUnique.mockResolvedValue(existingBalance as never)
    txConfigCreate.mockResolvedValue(appliedConfig)
    txBalanceUpsert.mockResolvedValue(appliedBalance)
    txCorrectionCreate.mockResolvedValue({ id: 'correction-1' })

    const response = await POST(
      postRequest({
        preview: false,
        note: 'Zmiana wymiaru',
        correctionReason: '  Korekta limitu  ',
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toEqual(expect.objectContaining({
      calculatedDays: 20,
      currentTotalDays: 26,
      deltaDays: -6,
      requiresCorrection: true,
      config: expect.objectContaining({ id: appliedConfig.id }),
      balance: expect.objectContaining({
        id: existingBalance.id,
        totalDays: 20,
        usedDays: 5,
        pendingDays: 2,
        carriedOver: 3,
      }),
    }))
    expect(txConfigCreate).toHaveBeenCalledWith({
      data: {
        employeeId: employee.id,
        mode: 'DAYS_20',
        customAnnualDays: null,
        employmentFraction: 1,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        note: 'Zmiana wymiaru',
        createdById: 'admin-1',
      },
    })
    expect(txBalanceUpsert).toHaveBeenCalledWith({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: vl.id,
          year: 2026,
        },
      },
      create: {
        employeeId: employee.id,
        leaveTypeId: vl.id,
        year: 2026,
        totalDays: 20,
      },
      update: { totalDays: 20 },
    })
    expect(txCorrectionCreate).toHaveBeenCalledWith({
      data: {
        balanceId: existingBalance.id,
        employeeId: employee.id,
        leaveTypeId: vl.id,
        year: 2026,
        reason: 'Korekta limitu',
        actorId: 'admin-1',
        beforeJson: JSON.stringify({
          totalDays: 26,
          usedDays: 5,
          pendingDays: 2,
          carriedOver: 3,
        }),
        afterJson: JSON.stringify({
          totalDays: 20,
          usedDays: 5,
          pendingDays: 2,
          carriedOver: 3,
        }),
      },
    })
  })

  it('creates the initial config and balance without a correction reason', async () => {
    const appliedConfig = { id: 'config-new' }
    const appliedBalance = {
      ...existingBalance,
      id: 'balance-new',
      totalDays: 20,
      usedDays: 0,
      pendingDays: 0,
      carriedOver: 0,
    }
    txConfigCreate.mockResolvedValue(appliedConfig)
    txBalanceUpsert.mockResolvedValue(appliedBalance)

    const response = await POST(
      postRequest({ preview: false }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.requiresCorrection).toBe(false)
    expect(body.config).toEqual(appliedConfig)
    expect(body.balance).toEqual(appliedBalance)
    expect(txBalanceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: {
        employeeId: employee.id,
        leaveTypeId: vl.id,
        year: 2026,
        totalDays: 20,
      },
      update: { totalDays: 20 },
    }))
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('appends a config without a correction when totalDays is unchanged', async () => {
    const unchangedBalance = { ...existingBalance, totalDays: 20 }
    mockBalanceFindUnique.mockResolvedValue(unchangedBalance as never)
    txConfigCreate.mockResolvedValue({ id: 'config-new' })
    txBalanceUpsert.mockResolvedValue(unchangedBalance)

    const response = await POST(
      postRequest({ preview: false }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.requiresCorrection).toBe(false)
    expect(body.deltaDays).toBe(0)
    expect(txConfigCreate).toHaveBeenCalledOnce()
    expect(txBalanceUpsert).toHaveBeenCalledOnce()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('returns 409 for an existing employee/effectiveFrom config', async () => {
    mockConfigFindUnique.mockResolvedValue({ id: 'duplicate-config' } as never)

    const response = await POST(
      postRequest({ preview: false }),
      params()
    )

    expect(response.status).toBe(409)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('maps a transaction P2002 race to 409', async () => {
    mockTransaction.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    )

    const response = await POST(
      postRequest({ preview: false }),
      params()
    )

    expect(response.status).toBe(409)
  })
})
