import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
      findFirst: vi.fn(),
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
const mockConfigFindFirst = vi.mocked(prisma.leaveEntitlementConfig.findFirst)
const mockBalanceFindUnique = vi.mocked(prisma.leaveBalanceNew.findUnique)
const mockCorrectionFindMany = vi.mocked(prisma.leaveBalanceCorrection.findMany)
const mockTransaction = vi.mocked(prisma.$transaction)

const txConfigCreate = vi.fn()
const txConfigFindUnique = vi.fn()
const txConfigFindFirst = vi.fn()
const txConfigUpdate = vi.fn()
const txBalanceFindUnique = vi.fn()
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

const existingConfig = {
  id: 'config-1',
  employeeId: employee.id,
  mode: 'DAYS_26',
  customAnnualDays: null,
  employmentFraction: 1,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  note: null,
  createdById: 'admin-1',
  createdAt: new Date('2026-01-01T08:00:00.000Z'),
  updatedAt: new Date('2026-07-01T10:00:00.000Z'),
}

const existingConfigVersion = 'config-1:2026-07-01T10:00:00.000Z'

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

function getRequestWithoutYear() {
  return new NextRequest(
    `http://localhost/api/hr/employees/${employee.id}/leave-entitlement`
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
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'))
  mockGetServerSession.mockResolvedValue(session())
  mockEmployeeFindUnique.mockResolvedValue(employee as never)
  mockLeaveTypeFindUnique.mockResolvedValue(vl as never)
  mockConfigFindMany.mockResolvedValue([])
  mockConfigFindUnique.mockResolvedValue(null)
  mockConfigFindFirst.mockResolvedValue(null)
  mockBalanceFindUnique.mockResolvedValue(null)
  mockCorrectionFindMany.mockResolvedValue([])
  txBalanceFindUnique.mockResolvedValue(null)
  txConfigFindUnique.mockResolvedValue(null)
  txConfigFindFirst.mockResolvedValue(null)
  mockTransaction.mockImplementation(
    async (callback) => callback({
      leaveEntitlementConfig: {
        findUnique: txConfigFindUnique,
        findFirst: txConfigFindFirst,
        create: txConfigCreate,
        update: txConfigUpdate,
      },
      leaveBalanceNew: {
        findUnique: txBalanceFindUnique,
        upsert: txBalanceUpsert,
      },
      leaveBalanceCorrection: { create: txCorrectionCreate },
    } as never) as never
  )
})

afterEach(() => {
  vi.useRealTimers()
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

  it('rejects a future effectiveFrom in the current Warsaw business year', async () => {
    const response = await POST(
      postRequest({ effectiveFrom: '2026-07-31' }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid input')
    expect(JSON.stringify(body.details)).toContain('2026-07-30')
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null],
    ['numeric', 1767225600000],
    ['timestamp', '2026-01-01T00:00:00.000Z'],
    ['nonexistent rollover date', '2026-02-30'],
  ])('rejects a %s effectiveFrom value', async (_label, effectiveFrom) => {
    const response = await POST(postRequest({ effectiveFrom }), params())

    expect(response.status).toBe(400)
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
  })

  it('normalizes effectiveFrom to UTC midnight for duplicate lookup', async () => {
    const response = await POST(
      postRequest({ effectiveFrom: '2026-02-03' }),
      params()
    )

    expect(response.status).toBe(200)
    expect(mockConfigFindUnique).toHaveBeenCalledWith({
      where: {
        employeeId_effectiveFrom: {
          employeeId: employee.id,
          effectiveFrom: new Date('2026-02-03T00:00:00.000Z'),
        },
      },
    })
  })

  it('requires all preview concurrency tokens when applying', async () => {
    const response = await POST(postRequest({ preview: false }), params())

    expect(response.status).toBe(400)
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects a correction reason longer than the schema maximum as invalid input', async () => {
    mockBalanceFindUnique.mockResolvedValue(existingBalance as never)

    const response = await POST(
      postRequest({
        preview: false,
        expectedCurrentTotalDays: 26,
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
  it('uses the Warsaw business year when the query parameter is absent', async () => {
    vi.setSystemTime(new Date('2026-12-31T23:30:00.000Z'))

    const response = await GET(getRequestWithoutYear(), params())

    expect(response.status).toBe(200)
    expect(mockConfigFindMany).toHaveBeenCalledWith({
      where: {
        employeeId: employee.id,
        effectiveFrom: { lte: new Date('2027-01-01T23:59:59.999Z') },
      },
    })
    expect(mockBalanceFindUnique).toHaveBeenCalledWith({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: vl.id,
          year: 2027,
        },
      },
    })
  })

  it('uses year end when selecting a historical year', async () => {
    const response = await GET(getRequest(2025), params())

    expect(response.status).toBe(200)
    expect(mockConfigFindMany).toHaveBeenCalledWith({
      where: {
        employeeId: employee.id,
        effectiveFrom: { lte: new Date('2025-12-31T23:59:59.999Z') },
      },
    })
  })

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
        effectiveFrom: { lte: new Date('2026-07-30T23:59:59.999Z') },
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
      targetTotalDays: 23,
      currentTotalDays: 26,
      expectedCurrentTotalDays: 26,
      expectedCurrentCarriedOver: 3,
      expectedConfigVersion: null,
      deltaDays: -3,
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
      targetTotalDays: 20,
      currentTotalDays: 0,
      expectedCurrentTotalDays: null,
      expectedCurrentCarriedOver: null,
      expectedConfigVersion: null,
      deltaDays: 20,
      requiresCorrection: false,
    }))
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns the exact-date config version and allows previewing an update', async () => {
    mockConfigFindUnique.mockResolvedValue(existingConfig as never)
    mockConfigFindFirst.mockResolvedValue(existingConfig as never)
    mockBalanceFindUnique.mockResolvedValue(existingBalance as never)

    const response = await POST(postRequest(), params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.expectedConfigVersion).toBe(existingConfigVersion)
    expect(body.targetTotalDays).toBe(23)
  })

  it('rejects creating a config older than the currently active config', async () => {
    mockConfigFindFirst.mockResolvedValue({
      ...existingConfig,
      effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
    } as never)

    const response = await POST(
      postRequest({ effectiveFrom: '2026-06-01' }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('CONFIG_DATE_CONFLICT')
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe('POST leave entitlement apply', () => {
  it.each([
    ['missing', undefined],
    ['too short', ' x '],
  ])('returns 422 when a changed balance has a %s correction reason', async (_label, correctionReason) => {
    mockBalanceFindUnique.mockResolvedValue(existingBalance as never)
    txBalanceFindUnique.mockResolvedValue(existingBalance)

    const response = await POST(
      postRequest({
        preview: false,
        expectedCurrentTotalDays: 26,
        expectedCurrentCarriedOver: 3,
        expectedConfigVersion: null,
        correctionReason,
      }),
      params()
    )

    expect(response.status).toBe(422)
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(txBalanceFindUnique).toHaveBeenCalledOnce()
    expect(mockBalanceFindUnique).not.toHaveBeenCalled()
    expect(txConfigCreate).not.toHaveBeenCalled()
    expect(txBalanceUpsert).not.toHaveBeenCalled()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
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
    const staleBalance = {
      ...existingBalance,
      usedDays: 1,
      pendingDays: 1,
      carriedOver: 1,
    }
    const transactionBalance = {
      ...existingBalance,
      usedDays: 7,
      pendingDays: 4,
      carriedOver: 5,
    }
    const appliedBalance = { ...transactionBalance, totalDays: 25 }
    mockBalanceFindUnique.mockResolvedValue(staleBalance as never)
    txBalanceFindUnique.mockResolvedValue(transactionBalance)
    txConfigCreate.mockResolvedValue(appliedConfig)
    txBalanceUpsert.mockResolvedValue(appliedBalance)
    txCorrectionCreate.mockResolvedValue({ id: 'correction-1' })

    const response = await POST(
      postRequest({
        preview: false,
        expectedCurrentTotalDays: 26,
        expectedCurrentCarriedOver: 5,
        expectedConfigVersion: null,
        note: 'Zmiana wymiaru',
        correctionReason: '  Korekta limitu  ',
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toEqual(expect.objectContaining({
      calculatedDays: 20,
      targetTotalDays: 25,
      currentTotalDays: 26,
      expectedCurrentTotalDays: 26,
      expectedCurrentCarriedOver: 5,
      expectedConfigVersion: null,
      deltaDays: -1,
      requiresCorrection: true,
      config: expect.objectContaining({ id: appliedConfig.id }),
      balance: expect.objectContaining({
        id: existingBalance.id,
        totalDays: 25,
        usedDays: 7,
        pendingDays: 4,
        carriedOver: 5,
      }),
    }))
    expect(mockBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceFindUnique).toHaveBeenCalledWith({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: vl.id,
          year: 2026,
        },
      },
    })
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
        totalDays: 25,
      },
      update: { totalDays: 25 },
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
          usedDays: 7,
          pendingDays: 4,
          carriedOver: 5,
        }),
        afterJson: JSON.stringify({
          totalDays: 25,
          usedDays: 7,
          pendingDays: 4,
          carriedOver: 5,
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
      postRequest({
        preview: false,
        expectedCurrentTotalDays: null,
        expectedCurrentCarriedOver: null,
        expectedConfigVersion: null,
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.requiresCorrection).toBe(false)
    expect(body.expectedCurrentTotalDays).toBeNull()
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

  it('allows transaction-local usage changes when totalDays is unchanged', async () => {
    const staleBalance = { ...existingBalance, usedDays: 1, pendingDays: 0 }
    const unchangedBalance = {
      ...existingBalance,
      totalDays: 30,
      usedDays: 9,
      pendingDays: 3,
      carriedOver: 4,
    }
    mockBalanceFindUnique.mockResolvedValue(staleBalance as never)
    txBalanceFindUnique.mockResolvedValue(unchangedBalance)
    txConfigCreate.mockResolvedValue({ id: 'config-new' })
    txBalanceUpsert.mockResolvedValue(unchangedBalance)

    const response = await POST(
      postRequest({
        mode: 'DAYS_26',
        preview: false,
        expectedCurrentTotalDays: 30,
        expectedCurrentCarriedOver: 4,
        expectedConfigVersion: null,
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.requiresCorrection).toBe(false)
    expect(body.deltaDays).toBe(0)
    expect(body.balance).toEqual(expect.objectContaining({
      totalDays: 30,
      usedDays: 9,
      pendingDays: 3,
      carriedOver: 4,
    }))
    expect(mockBalanceFindUnique).not.toHaveBeenCalled()
    expect(txConfigCreate).toHaveBeenCalledOnce()
    expect(txBalanceUpsert).toHaveBeenCalledOnce()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it.each([
    [
      'presence changed',
      null,
      null,
      existingBalance,
    ],
    [
      'total changed',
      26,
      3,
      { ...existingBalance, totalDays: 24 },
    ],
    [
      'carried over changed',
      26,
      3,
      { ...existingBalance, carriedOver: 4 },
    ],
  ])('returns a balance-specific 409 before writes when preview %s', async (
    _label,
    expectedTotal,
    expectedCarriedOver,
    transactionBalance
  ) => {
    mockBalanceFindUnique.mockResolvedValue(existingBalance as never)
    txBalanceFindUnique.mockResolvedValue(transactionBalance)

    const response = await POST(
      postRequest({
        preview: false,
        expectedCurrentTotalDays: expectedTotal,
        expectedCurrentCarriedOver: expectedCarriedOver,
        expectedConfigVersion: null,
        correctionReason: 'Korekta limitu',
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('BALANCE_PREVIEW_CONFLICT')
    expect(body.error).toContain('balance')
    expect(mockBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceFindUnique).toHaveBeenCalledOnce()
    expect(txConfigCreate).not.toHaveBeenCalled()
    expect(txBalanceUpsert).not.toHaveBeenCalled()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('updates an exact-date config after checking its preview version', async () => {
    const updatedConfig = {
      ...existingConfig,
      mode: 'DAYS_20',
      updatedAt: new Date('2026-07-30T12:00:00.000Z'),
    }
    const updatedBalance = { ...existingBalance, totalDays: 23 }
    txConfigFindUnique.mockResolvedValue(existingConfig)
    txConfigFindFirst.mockResolvedValue(existingConfig)
    txBalanceFindUnique.mockResolvedValue(existingBalance)
    txConfigUpdate.mockResolvedValue(updatedConfig)
    txBalanceUpsert.mockResolvedValue(updatedBalance)
    txCorrectionCreate.mockResolvedValue({ id: 'correction-1' })

    const response = await POST(
      postRequest({
        preview: false,
        expectedCurrentTotalDays: 26,
        expectedCurrentCarriedOver: 3,
        expectedConfigVersion: existingConfigVersion,
        correctionReason: 'Zmiana podstawy urlopu',
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.targetTotalDays).toBe(23)
    expect(body.expectedConfigVersion).toBe(existingConfigVersion)
    expect(txConfigUpdate).toHaveBeenCalledWith({
      where: { id: existingConfig.id },
      data: {
        mode: 'DAYS_20',
        customAnnualDays: null,
        employmentFraction: 1,
        note: null,
      },
    })
    expect(txConfigCreate).not.toHaveBeenCalled()
  })

  it('returns a config-specific 409 when the exact-date version changed', async () => {
    txConfigFindUnique.mockResolvedValue({
      ...existingConfig,
      updatedAt: new Date('2026-07-30T11:00:00.000Z'),
    })
    txConfigFindFirst.mockResolvedValue(existingConfig)
    txBalanceFindUnique.mockResolvedValue(existingBalance)

    const response = await POST(
      postRequest({
        preview: false,
        expectedCurrentTotalDays: 26,
        expectedCurrentCarriedOver: 3,
        expectedConfigVersion: existingConfigVersion,
        correctionReason: 'Zmiana podstawy urlopu',
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('CONFIG_VERSION_CONFLICT')
    expect(body.error).toContain('config')
    expect(txConfigUpdate).not.toHaveBeenCalled()
    expect(txConfigCreate).not.toHaveBeenCalled()
    expect(txBalanceUpsert).not.toHaveBeenCalled()
  })

  it('rejects creating a config older than the active config inside the transaction', async () => {
    txConfigFindFirst.mockResolvedValue({
      ...existingConfig,
      effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
    })

    const response = await POST(
      postRequest({
        effectiveFrom: '2026-06-01',
        preview: false,
        expectedCurrentTotalDays: null,
        expectedCurrentCarriedOver: null,
        expectedConfigVersion: null,
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('CONFIG_DATE_CONFLICT')
    expect(txConfigCreate).not.toHaveBeenCalled()
    expect(txBalanceUpsert).not.toHaveBeenCalled()
  })

  it('maps an exact-date transaction P2002 race to a config-specific 409', async () => {
    mockTransaction.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['employeeId', 'effectiveFrom'] },
      })
    )

    const response = await POST(
      postRequest({
        preview: false,
        expectedCurrentTotalDays: null,
        expectedCurrentCarriedOver: null,
        expectedConfigVersion: null,
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('CONFIG_VERSION_CONFLICT')
  })

  it('does not mislabel an unrelated P2002 as an entitlement date conflict', async () => {
    const unrelatedError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['email'] },
    })
    mockTransaction.mockRejectedValue(unrelatedError)

    await expect(POST(
      postRequest({
        preview: false,
        expectedCurrentTotalDays: null,
        expectedCurrentCarriedOver: null,
        expectedConfigVersion: null,
      }),
      params()
    )).rejects.toBe(unrelatedError)
  })
})
