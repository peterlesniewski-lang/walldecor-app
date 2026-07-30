import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/hr/leave-balances/carryover/route'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockTransaction = vi.mocked(prisma.$transaction)

const txLeaveTypeFindUnique = vi.fn()
const txSourceFindMany = vi.fn()
const txBalanceFindUnique = vi.fn()
const txBalanceCreate = vi.fn()
const txBalanceUpdate = vi.fn()
const txCorrectionCreate = vi.fn()

const tx = {
  leaveType: {
    findUnique: txLeaveTypeFindUnique,
  },
  leaveBalanceNew: {
    findMany: txSourceFindMany,
    findUnique: txBalanceFindUnique,
    create: txBalanceCreate,
    update: txBalanceUpdate,
  },
  leaveBalanceCorrection: {
    create: txCorrectionCreate,
  },
}

const canonicalVl = {
  id: 'leave-type-vl',
  code: 'VL',
  parentId: null,
  isActive: true,
  isPaid: true,
  requiresApproval: true,
  tracksBalance: true,
}

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' = 'ADMIN') {
  return {
    user: {
      id: `${role.toLowerCase()}-user`,
      name: role,
      email: `${role.toLowerCase()}@test.pl`,
      role,
      employeeId: role === 'ADMIN' ? null : `${role.toLowerCase()}-employee`,
    },
    expires: '',
  }
}

function entitlementConfig(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: 'config-1',
    mode: 'DAYS_20',
    customAnnualDays: null,
    employmentFraction: 1,
    effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function sourceBalance(
  balanceOverrides: Record<string, unknown> = {},
  employeeOverrides: Record<string, unknown> = {}
) {
  return {
    id: 'source-balance-1',
    employeeId: 'employee-1',
    leaveTypeId: canonicalVl.id,
    year: 2025,
    totalDays: 26,
    usedDays: 10,
    pendingDays: 2,
    carriedOver: 0,
    employee: {
      id: 'employee-1',
      firstName: 'Anna',
      lastName: 'Nowak',
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      active: true,
      leaveEntitlementConfigs: [entitlementConfig()],
      ...employeeOverrides,
    },
    ...balanceOverrides,
  }
}

function request(
  body: Record<string, unknown> = {
    fromYear: 2025,
    toYear: 2026,
    reason: 'Annual vacation carryover',
  }
) {
  return new NextRequest(
    'http://localhost/api/hr/leave-balances/carryover',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

function malformedRequest() {
  return new NextRequest(
    'http://localhost/api/hr/leave-balances/carryover',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"fromYear":2025',
    }
  )
}

function prismaError(code: string, message: string, target?: string[]) {
  return Object.assign(new Error(message), {
    code,
    ...(target ? { meta: { target } } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(session())
  txLeaveTypeFindUnique.mockResolvedValue(canonicalVl)
  txSourceFindMany.mockResolvedValue([])
  txBalanceFindUnique.mockResolvedValue(null)
  txBalanceCreate.mockImplementation(async ({ data }) => ({
    id: `target-${data.employeeId}`,
    usedDays: 0,
    pendingDays: 0,
    ...data,
  }))
  txBalanceUpdate.mockImplementation(async ({ data }) => ({
    id: 'target-balance-1',
    employeeId: 'employee-1',
    leaveTypeId: canonicalVl.id,
    year: 2026,
    usedDays: 0,
    pendingDays: 0,
    ...data,
  }))
  txCorrectionCreate.mockResolvedValue({ id: 'correction-1' })
  mockTransaction.mockImplementation(
    async (callback) => callback(tx as never) as never
  )
})

describe('POST /api/hr/leave-balances/carryover access and validation', () => {
  it('returns 401 before opening a transaction when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns 403 before opening a transaction for a manager', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER'))

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed JSON before opening a transaction', async () => {
    const response = await POST(malformedRequest())

    expect(response.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it.each([
    ['missing reason', { fromYear: 2025, toYear: 2026 }],
    ['short trimmed reason', { fromYear: 2025, toYear: 2026, reason: ' x ' }],
    [
      'reason longer than 1000 characters',
      { fromYear: 2025, toYear: 2026, reason: 'x'.repeat(1001) },
    ],
    [
      'fromYear below range',
      { fromYear: 1999, toYear: 2026, reason: 'Annual carryover' },
    ],
    [
      'toYear above range',
      { fromYear: 2025, toYear: 2101, reason: 'Annual carryover' },
    ],
    [
      'non-integer year',
      { fromYear: 2025.5, toYear: 2026, reason: 'Annual carryover' },
    ],
    [
      'non-increasing years',
      { fromYear: 2026, toYear: 2026, reason: 'Annual carryover' },
    ],
    [
      'negative carryover cap',
      {
        fromYear: 2025,
        toYear: 2026,
        reason: 'Annual carryover',
        maxCarryoverDays: -1,
      },
    ],
  ])('returns 400 for %s', async (_label, body) => {
    const response = await POST(request(body))

    expect(response.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/hr/leave-balances/carryover canonical VL invariants', () => {
  it.each([
    ['missing', null],
    ['wrong code', { ...canonicalVl, code: 'BROKEN' }],
    ['nested', { ...canonicalVl, parentId: 'parent-type' }],
    ['inactive', { ...canonicalVl, isActive: false }],
    ['unpaid', { ...canonicalVl, isPaid: false }],
    ['without approval', { ...canonicalVl, requiresApproval: false }],
    ['not balance tracking', { ...canonicalVl, tracksBalance: false }],
  ])('returns 503 and rolls back for a %s VL type', async (_label, vlType) => {
    txLeaveTypeFindUnique.mockResolvedValue(vlType)

    const response = await POST(request())

    expect(response.status).toBe(503)
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(txLeaveTypeFindUnique).toHaveBeenCalledWith({
      where: { code: 'VL' },
      select: {
        id: true,
        code: true,
        parentId: true,
        isActive: true,
        isPaid: true,
        requiresApproval: true,
        tracksBalance: true,
      },
    })
    expect(txSourceFindMany).not.toHaveBeenCalled()
    expect(txBalanceCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('does not require maxDaysPerYear on canonical VL', async () => {
    txLeaveTypeFindUnique.mockResolvedValue({
      ...canonicalVl,
      maxDaysPerYear: 0,
    })

    const response = await POST(request())

    expect(response.status).toBe(200)
  })
})

describe('POST /api/hr/leave-balances/carryover transaction scope', () => {
  it('reads canonical VL, active source balances, and configs inside one transaction', async () => {
    const response = await POST(request({
      fromYear: 2025,
      toYear: 2026,
      reason: 'Annual carryover',
      leaveTypeId: 'leave-type-sl',
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      needsReview: [],
    })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' }
    )
    expect(txSourceFindMany).toHaveBeenCalledWith({
      where: {
        year: 2025,
        leaveTypeId: canonicalVl.id,
        employee: { active: true },
      },
      select: {
        id: true,
        employeeId: true,
        leaveTypeId: true,
        year: true,
        totalDays: true,
        usedDays: true,
        pendingDays: true,
        carriedOver: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            startDate: true,
            active: true,
            leaveEntitlementConfigs: {
              where: {
                effectiveFrom: {
                  lte: new Date('2026-12-31T23:59:59.999Z'),
                },
              },
              select: {
                id: true,
                mode: true,
                customAnnualDays: true,
                employmentFraction: true,
                effectiveFrom: true,
              },
            },
          },
        },
      },
      orderBy: { employeeId: 'asc' },
    })
  })

  it('processes only active canonical VL rows returned by the source query', async () => {
    txSourceFindMany.mockResolvedValue([
      sourceBalance(),
      sourceBalance(
        {
          id: 'source-sl',
          employeeId: 'employee-sl',
          leaveTypeId: 'leave-type-sl',
        },
        { id: 'employee-sl' }
      ),
      sourceBalance(
        { id: 'source-inactive', employeeId: 'employee-inactive' },
        { id: 'employee-inactive', active: false }
      ),
    ])

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.processed).toBe(1)
    expect(body.created).toBe(1)
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(txBalanceCreate).toHaveBeenCalledOnce()
  })

  it('returns empty zero counters when there are no source rows', async () => {
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      needsReview: [],
    })
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
  })
})

describe('POST /api/hr/leave-balances/carryover entitlement validation', () => {
  it('reports a missing effective config for review without target access', async () => {
    txSourceFindMany.mockResolvedValue([
      sourceBalance({}, { leaveEntitlementConfigs: [] }),
    ])

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      processed: 1,
      created: 0,
      updated: 0,
      skipped: 1,
      needsReview: [
        {
          employeeId: 'employee-1',
          employeeName: 'Anna Nowak',
        },
      ],
    })
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
  })

  it.each([
    [
      'unknown mode with a plausible custom value',
      { mode: 'BROKEN', customAnnualDays: 17 },
    ],
    ['zero fraction', { employmentFraction: 0 }],
    ['fraction above one', { employmentFraction: 1.1 }],
    ['CUSTOM without custom days', { mode: 'CUSTOM', customAnnualDays: null }],
    ['CUSTOM with zero days', { mode: 'CUSTOM', customAnnualDays: 0 }],
    ['CUSTOM with fractional days', { mode: 'CUSTOM', customAnnualDays: 17.5 }],
    ['CUSTOM above the supported range', { mode: 'CUSTOM', customAnnualDays: 366 }],
    ['invalid effective date', { effectiveFrom: new Date('invalid') }],
  ])('skips and flags %s', async (_label, configOverrides) => {
    txSourceFindMany.mockResolvedValue([
      sourceBalance({}, {
        leaveEntitlementConfigs: [
          entitlementConfig(configOverrides),
        ],
      }),
    ])

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      processed: 1,
      created: 0,
      updated: 0,
      skipped: 1,
      needsReview: [
        {
          employeeId: 'employee-1',
          employeeName: 'Anna Nowak',
        },
      ],
    })
    expect(txBalanceFindUnique).not.toHaveBeenCalled()
    expect(txBalanceCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('uses the latest valid config effective by year end with fraction and start-date proration', async () => {
    txSourceFindMany.mockResolvedValue([
      sourceBalance(
        {
          totalDays: 10,
          usedDays: 4,
          pendingDays: 1,
        },
        {
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          leaveEntitlementConfigs: [
            entitlementConfig({
              id: 'config-old',
              mode: 'DAYS_20',
              effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            }),
            entitlementConfig({
              id: 'config-latest',
              mode: 'DAYS_26',
              employmentFraction: 0.5,
              effectiveFrom: new Date('2026-12-15T00:00:00.000Z'),
            }),
          ],
        }
      ),
    ])

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(txBalanceCreate).toHaveBeenCalledWith({
      data: {
        employeeId: 'employee-1',
        leaveTypeId: canonicalVl.id,
        year: 2026,
        totalDays: 12,
        carriedOver: 5,
      },
    })
  })
})

describe('POST /api/hr/leave-balances/carryover calculations', () => {
  it('subtracts pending days, clamps negative remaining, and applies the optional cap', async () => {
    txSourceFindMany.mockResolvedValue([
      sourceBalance({
        id: 'source-positive',
        totalDays: 10,
        usedDays: 3,
        pendingDays: 2,
      }),
      sourceBalance(
        {
          id: 'source-negative',
          employeeId: 'employee-2',
          totalDays: 3,
          usedDays: 2,
          pendingDays: 4,
        },
        {
          id: 'employee-2',
          firstName: 'Jan',
          lastName: 'Kowalski',
        }
      ),
    ])

    const response = await POST(request({
      fromYear: 2025,
      toYear: 2026,
      reason: '  Annual carryover with cap  ',
      maxCarryoverDays: 4,
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      processed: 2,
      created: 2,
      updated: 0,
      skipped: 0,
    })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(txBalanceCreate).toHaveBeenNthCalledWith(1, {
      data: {
        employeeId: 'employee-1',
        leaveTypeId: canonicalVl.id,
        year: 2026,
        totalDays: 24,
        carriedOver: 4,
      },
    })
    expect(txBalanceCreate).toHaveBeenNthCalledWith(2, {
      data: {
        employeeId: 'employee-2',
        leaveTypeId: canonicalVl.id,
        year: 2026,
        totalDays: 20,
        carriedOver: 0,
      },
    })
  })

  it('creates the annual base target when carryover is zero', async () => {
    txSourceFindMany.mockResolvedValue([
      sourceBalance({
        totalDays: 5,
        usedDays: 5,
        pendingDays: 0,
      }),
    ])

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.created).toBe(1)
    expect(body.skipped).toBe(0)
    expect(txBalanceCreate).toHaveBeenCalledWith({
      data: {
        employeeId: 'employee-1',
        leaveTypeId: canonicalVl.id,
        year: 2026,
        totalDays: 20,
        carriedOver: 0,
      },
    })
  })
})

describe('POST /api/hr/leave-balances/carryover target snapshots and idempotence', () => {
  it('updates exact totals, preserves usage, and appends transaction-local audit snapshots', async () => {
    const targetBefore = {
      id: 'target-balance-1',
      employeeId: 'employee-1',
      leaveTypeId: canonicalVl.id,
      year: 2026,
      totalDays: 25,
      usedDays: 7,
      pendingDays: 3,
      carriedOver: 5,
    }
    const targetAfter = {
      ...targetBefore,
      totalDays: 28,
      carriedOver: 8,
    }
    txSourceFindMany.mockResolvedValue([
      sourceBalance({
        totalDays: 15,
        usedDays: 5,
        pendingDays: 2,
      }),
    ])
    txBalanceFindUnique.mockResolvedValue(targetBefore)
    txBalanceUpdate.mockResolvedValue(targetAfter)

    const response = await POST(request({
      fromYear: 2025,
      toYear: 2026,
      reason: '  Recalculate annual rollover  ',
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      processed: 1,
      created: 0,
      updated: 1,
      skipped: 0,
    })
    expect(txBalanceFindUnique).toHaveBeenCalledWith({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: 'employee-1',
          leaveTypeId: canonicalVl.id,
          year: 2026,
        },
      },
    })
    expect(txBalanceUpdate).toHaveBeenCalledWith({
      where: { id: targetBefore.id },
      data: {
        totalDays: 28,
        carriedOver: 8,
      },
    })
    expect(txCorrectionCreate).toHaveBeenCalledWith({
      data: {
        balanceId: targetBefore.id,
        employeeId: 'employee-1',
        leaveTypeId: canonicalVl.id,
        year: 2026,
        reason: 'Recalculate annual rollover',
        actorId: 'admin-user',
        beforeJson: JSON.stringify({
          totalDays: 25,
          usedDays: 7,
          pendingDays: 3,
          carriedOver: 5,
        }),
        afterJson: JSON.stringify({
          totalDays: 28,
          usedDays: 7,
          pendingDays: 3,
          carriedOver: 8,
        }),
      },
    })
    expect(txBalanceUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(txCorrectionCreate.mock.invocationCallOrder[0])
  })

  it('skips an exact target on rerun without update or audit', async () => {
    txSourceFindMany.mockResolvedValue([
      sourceBalance({
        totalDays: 15,
        usedDays: 5,
        pendingDays: 2,
      }),
    ])
    txBalanceFindUnique.mockResolvedValue({
      id: 'target-balance-1',
      employeeId: 'employee-1',
      leaveTypeId: canonicalVl.id,
      year: 2026,
      totalDays: 28,
      usedDays: 7,
      pendingDays: 3,
      carriedOver: 8,
    })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      processed: 1,
      created: 0,
      updated: 0,
      skipped: 1,
    })
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('sets carriedOver exactly instead of adding it on rerun', async () => {
    txSourceFindMany.mockResolvedValue([
      sourceBalance({
        totalDays: 15,
        usedDays: 5,
        pendingDays: 2,
      }),
    ])
    txBalanceFindUnique.mockResolvedValue({
      id: 'target-balance-1',
      employeeId: 'employee-1',
      leaveTypeId: canonicalVl.id,
      year: 2026,
      totalDays: 25,
      usedDays: 0,
      pendingDays: 0,
      carriedOver: 5,
    })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(txBalanceUpdate).toHaveBeenCalledWith({
      where: { id: 'target-balance-1' },
      data: {
        totalDays: 28,
        carriedOver: 8,
      },
    })
  })
})

describe('POST /api/hr/leave-balances/carryover batch rollback and retry', () => {
  it('returns 409 when the second employee fails inside the single batch transaction', async () => {
    txSourceFindMany.mockResolvedValue([
      sourceBalance(),
      sourceBalance(
        {
          id: 'source-2',
          employeeId: 'employee-2',
        },
        {
          id: 'employee-2',
          firstName: 'Jan',
          lastName: 'Kowalski',
        }
      ),
    ])
    txBalanceCreate
      .mockResolvedValueOnce({ id: 'target-employee-1' })
      .mockRejectedValueOnce(new Error('second employee failed'))

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('CARRYOVER_CONFLICT')
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(txBalanceCreate).toHaveBeenCalledTimes(2)
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('repeats the whole source read on retry without duplicating result counters', async () => {
    txSourceFindMany.mockResolvedValue([sourceBalance()])
    let attempt = 0
    mockTransaction.mockImplementation(async (callback) => {
      const callbackResult = await callback(tx as never)
      attempt++
      if (attempt === 1) {
        throw prismaError('P2034', 'write conflict')
      }
      return callbackResult as never
    })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      processed: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      needsReview: [],
    })
    expect(mockTransaction).toHaveBeenCalledTimes(2)
    expect(txLeaveTypeFindUnique).toHaveBeenCalledTimes(2)
    expect(txSourceFindMany).toHaveBeenCalledTimes(2)
    expect(txBalanceCreate).toHaveBeenCalledTimes(2)
  })

  it('maps Serializable retry exhaustion to 409', async () => {
    mockTransaction.mockRejectedValue(
      prismaError('P2034', 'write conflict') as never
    )

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(mockTransaction).toHaveBeenCalledTimes(3)
  })

  it('maps a target create P2002 race to 409', async () => {
    txSourceFindMany.mockResolvedValue([sourceBalance()])
    txBalanceCreate.mockRejectedValue(
      prismaError(
        'P2002',
        'Unique constraint failed',
        ['employeeId', 'leaveTypeId', 'year']
      )
    )

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(txBalanceCreate).toHaveBeenCalledOnce()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('returns 409 and does not append an audit when a target update fails', async () => {
    txSourceFindMany.mockResolvedValue([sourceBalance()])
    txBalanceFindUnique.mockResolvedValue({
      id: 'target-balance-1',
      employeeId: 'employee-1',
      leaveTypeId: canonicalVl.id,
      year: 2026,
      totalDays: 21,
      usedDays: 0,
      pendingDays: 0,
      carriedOver: 1,
    })
    txBalanceUpdate.mockRejectedValue(new Error('update failed'))

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })
})
