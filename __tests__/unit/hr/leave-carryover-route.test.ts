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
    leaveType: {
      findUnique: vi.fn(),
    },
    leaveBalanceNew: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockLeaveTypeFindUnique = vi.mocked(prisma.leaveType.findUnique)
const mockSourceFindMany = vi.mocked(prisma.leaveBalanceNew.findMany)
const mockTransaction = vi.mocked(prisma.$transaction)

const txBalanceFindUnique = vi.fn()
const txBalanceCreate = vi.fn()
const txBalanceUpdate = vi.fn()
const txCorrectionCreate = vi.fn()

const canonicalVl = {
  id: 'leave-type-vl',
  code: 'VL',
  parentId: null,
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
  mockLeaveTypeFindUnique.mockResolvedValue(canonicalVl as never)
  mockSourceFindMany.mockResolvedValue([])
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
    async (callback) => callback({
      leaveBalanceNew: {
        findUnique: txBalanceFindUnique,
        create: txBalanceCreate,
        update: txBalanceUpdate,
      },
      leaveBalanceCorrection: {
        create: txCorrectionCreate,
      },
    } as never) as never
  )
})

describe('POST /api/hr/leave-balances/carryover access and validation', () => {
  it('returns 401 before database access when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(mockLeaveTypeFindUnique).not.toHaveBeenCalled()
    expect(mockSourceFindMany).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns 403 before database access for a manager', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER'))

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(mockLeaveTypeFindUnique).not.toHaveBeenCalled()
    expect(mockSourceFindMany).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed JSON before database access', async () => {
    const response = await POST(malformedRequest())

    expect(response.status).toBe(400)
    expect(mockLeaveTypeFindUnique).not.toHaveBeenCalled()
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
    expect(mockLeaveTypeFindUnique).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/hr/leave-balances/carryover canonical VL scope', () => {
  it.each([
    ['missing', null],
    ['nested', { ...canonicalVl, parentId: 'parent-type' }],
    ['not balance tracking', { ...canonicalVl, tracksBalance: false }],
  ])('returns 503 without mutations for a %s VL type', async (_label, vlType) => {
    mockLeaveTypeFindUnique.mockResolvedValue(vlType as never)

    const response = await POST(request())

    expect(response.status).toBe(503)
    expect(mockSourceFindMany).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('queries only active source VL balances and ignores leaveTypeId input', async () => {
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
    expect(mockSourceFindMany).toHaveBeenCalledWith({
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
    })
  })

  it('processes only active canonical VL rows returned by the source query', async () => {
    mockSourceFindMany.mockResolvedValue([
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
    ] as never)

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.processed).toBe(1)
    expect(body.created).toBe(1)
    expect(mockTransaction).toHaveBeenCalledOnce()
  })
})

describe('POST /api/hr/leave-balances/carryover entitlement and calculations', () => {
  it('reports a missing effective config for review without writes', async () => {
    mockSourceFindMany.mockResolvedValue([
      sourceBalance({}, { leaveEntitlementConfigs: [] }),
    ] as never)

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
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(txBalanceCreate).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('uses the latest config effective by year end with fraction and start-date proration', async () => {
    mockSourceFindMany.mockResolvedValue([
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
    ] as never)

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

  it('subtracts pending days, clamps negative remaining, and applies the optional cap', async () => {
    mockSourceFindMany.mockResolvedValue([
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
    ] as never)

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
    mockSourceFindMany.mockResolvedValue([
      sourceBalance({
        totalDays: 5,
        usedDays: 5,
        pendingDays: 0,
      }),
    ] as never)

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

describe('POST /api/hr/leave-balances/carryover target transactions', () => {
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
    mockSourceFindMany.mockResolvedValue([
      sourceBalance({
        totalDays: 15,
        usedDays: 5,
        pendingDays: 2,
      }),
    ] as never)
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
    mockSourceFindMany.mockResolvedValue([
      sourceBalance({
        totalDays: 15,
        usedDays: 5,
        pendingDays: 2,
      }),
    ] as never)
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
    mockSourceFindMany.mockResolvedValue([
      sourceBalance({
        totalDays: 15,
        usedDays: 5,
        pendingDays: 2,
      }),
    ] as never)
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

  it('maps serializable retry exhaustion to 409 without an audit', async () => {
    mockSourceFindMany.mockResolvedValue([sourceBalance()] as never)
    mockTransaction.mockRejectedValue(
      prismaError('P2034', 'write conflict') as never
    )

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(mockTransaction).toHaveBeenCalledTimes(3)
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('maps a target create P2002 race to 409 without an audit', async () => {
    mockSourceFindMany.mockResolvedValue([sourceBalance()] as never)
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

  it('does not append an audit when the target update fails', async () => {
    mockSourceFindMany.mockResolvedValue([sourceBalance()] as never)
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

    await expect(POST(request())).rejects.toThrow('update failed')

    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })
})
