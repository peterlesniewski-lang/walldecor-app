import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { leaveBalanceCorrectionSchema } from '@/lib/hr/schemas'
import { PATCH } from '@/app/api/hr/leave-balances/[id]/route'
import {
  GET as getLeaveBalances,
  POST as createLeaveBalance,
} from '@/app/api/hr/leave-balances/route'

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
    leaveType: {
      findUnique: vi.fn(),
    },
    leaveBalanceNew: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    leaveBalanceCorrection: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockEmployeeFindUnique = vi.mocked(prisma.employee.findUnique)
const mockEmployeeFindMany = vi.mocked(prisma.employee.findMany)
const mockLeaveTypeFindUnique = vi.mocked(prisma.leaveType.findUnique)
const mockBalanceFindUnique = vi.mocked(prisma.leaveBalanceNew.findUnique)
const mockBalanceFindMany = vi.mocked(prisma.leaveBalanceNew.findMany)
const mockBalanceCreate = vi.mocked(prisma.leaveBalanceNew.create)
const mockBalanceUpdate = vi.mocked(prisma.leaveBalanceNew.update)
const mockTransaction = vi.mocked(prisma.$transaction)

const txBalanceFindUnique = vi.fn()
const txBalanceUpdate = vi.fn()
const txCorrectionCreate = vi.fn()

const currentBalance = {
  id: 'balance-1',
  employeeId: 'employee-1',
  leaveTypeId: 'leave-type-vl',
  year: 2026,
  totalDays: 26,
  usedDays: 5,
  pendingDays: 2,
  carriedOver: 3,
}

const updatedBalance = {
  ...currentBalance,
  totalDays: 24,
  carriedOver: 4,
  leaveType: {
    id: 'leave-type-vl',
    code: 'VL',
    name: 'Urlop wypoczynkowy',
  },
  employee: {
    id: 'employee-1',
    firstName: 'Jan',
    lastName: 'Kowalski',
    email: 'jan@example.com',
  },
}

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' = 'ADMIN', employeeId: string | null = null) {
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

function params(id = currentBalance.id) {
  return { params: Promise.resolve({ id }) }
}

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest(
    `http://localhost/api/hr/leave-balances/${currentBalance.id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

function createRequest() {
  return new NextRequest('http://localhost/api/hr/leave-balances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      employeeId: currentBalance.employeeId,
      leaveTypeId: currentBalance.leaveTypeId,
      year: currentBalance.year,
      totalDays: currentBalance.totalDays,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(session())
  mockEmployeeFindUnique.mockResolvedValue({
    id: currentBalance.employeeId,
    divisionId: 'JAG',
    active: true,
  } as never)
  mockEmployeeFindMany.mockResolvedValue([])
  mockLeaveTypeFindUnique.mockResolvedValue({ id: currentBalance.leaveTypeId } as never)
  mockBalanceFindUnique.mockResolvedValue(currentBalance as never)
  mockBalanceFindMany.mockResolvedValue([])
  mockBalanceCreate.mockResolvedValue(updatedBalance as never)
  mockBalanceUpdate.mockResolvedValue(updatedBalance as never)
  txBalanceFindUnique.mockResolvedValue(currentBalance)
  txBalanceUpdate.mockResolvedValue(updatedBalance)
  txCorrectionCreate.mockResolvedValue({ id: 'correction-1' })
  mockTransaction.mockImplementation(
    async (callback) => callback({
      leaveBalanceNew: {
        findUnique: txBalanceFindUnique,
        update: txBalanceUpdate,
      },
      leaveBalanceCorrection: { create: txCorrectionCreate },
    } as never) as never
  )
})

describe('PATCH /api/hr/leave-balances/[id] access', () => {
  it('returns 401 before database access when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await PATCH(
      patchRequest({ totalDays: 24, reason: 'Manual correction' }),
      params()
    )

    expect(response.status).toBe(401)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockBalanceFindUnique).not.toHaveBeenCalled()
  })

  it.each(['MANAGER', 'EMPLOYEE'] as const)(
    'returns 403 before database access for %s',
    async (role) => {
      mockGetServerSession.mockResolvedValue(session(role, `${role.toLowerCase()}-employee`))

      const response = await PATCH(
        patchRequest({ totalDays: 24, reason: 'Manual correction' }),
        params()
      )

      expect(response.status).toBe(403)
      expect(mockTransaction).not.toHaveBeenCalled()
      expect(mockBalanceFindUnique).not.toHaveBeenCalled()
      expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
    }
  )
})

describe('PATCH /api/hr/leave-balances/[id] validation', () => {
  it.each([
    ['negative', -1],
    ['non-finite', Number.POSITIVE_INFINITY],
  ])('keeps rejecting %s balance values', (_label, value) => {
    const parsed = leaveBalanceCorrectionSchema.safeParse({
      totalDays: value,
      reason: 'Manual correction',
    })

    expect(parsed.success).toBe(false)
  })

  it.each([
    ['missing', undefined],
    ['too short after trimming', ' x '],
  ])('returns 400 for a %s reason', async (_label, reason) => {
    const body: Record<string, unknown> = { totalDays: 24 }
    if (reason !== undefined) body.reason = reason

    const response = await PATCH(patchRequest(body), params())

    expect(response.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 when no mutable balance field is supplied', async () => {
    const response = await PATCH(
      patchRequest({ reason: 'Manual correction' }),
      params()
    )

    expect(response.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed JSON', async () => {
    const request = new NextRequest(
      `http://localhost/api/hr/leave-balances/${currentBalance.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{"totalDays":24',
      }
    )

    const response = await PATCH(request, params())

    expect(response.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects pendingDays and never lets it reach update data', async () => {
    const response = await PATCH(
      patchRequest({
        totalDays: 24,
        pendingDays: 99,
        reason: 'Manual correction',
      }),
      params()
    )

    expect(response.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(mockBalanceUpdate).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/hr/leave-balances/[id] correction transaction', () => {
  it('returns 404 from a transaction-local lookup without writes', async () => {
    mockBalanceFindUnique.mockResolvedValue(null)
    txBalanceFindUnique.mockResolvedValue(null)

    const response = await PATCH(
      patchRequest({ totalDays: 24, reason: 'Manual correction' }),
      params('missing-balance')
    )

    expect(response.status).toBe(404)
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(txBalanceFindUnique).toHaveBeenCalledWith({
      where: { id: 'missing-balance' },
    })
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('updates supplied fields and appends exact transaction-local audit snapshots', async () => {
    const response = await PATCH(
      patchRequest({
        totalDays: 24,
        carriedOver: 4,
        reason: '  Manual balance correction  ',
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(updatedBalance)
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockBalanceFindUnique).not.toHaveBeenCalled()
    expect(mockBalanceUpdate).not.toHaveBeenCalled()
    expect(txBalanceFindUnique).toHaveBeenCalledOnce()
    expect(txBalanceFindUnique).toHaveBeenCalledWith({
      where: { id: currentBalance.id },
    })
    expect(txBalanceUpdate).toHaveBeenCalledOnce()
    expect(txBalanceUpdate).toHaveBeenCalledWith({
      where: { id: currentBalance.id },
      data: {
        totalDays: 24,
        carriedOver: 4,
      },
      include: {
        leaveType: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    })
    expect(txCorrectionCreate).toHaveBeenCalledOnce()
    expect(txCorrectionCreate).toHaveBeenCalledWith({
      data: {
        balanceId: currentBalance.id,
        employeeId: currentBalance.employeeId,
        leaveTypeId: currentBalance.leaveTypeId,
        year: currentBalance.year,
        reason: 'Manual balance correction',
        actorId: 'admin-user',
        beforeJson: JSON.stringify({
          totalDays: 26,
          usedDays: 5,
          pendingDays: 2,
          carriedOver: 3,
        }),
        afterJson: JSON.stringify({
          totalDays: 24,
          usedDays: 5,
          pendingDays: 2,
          carriedOver: 4,
        }),
      },
    })
    expect(txBalanceFindUnique.mock.invocationCallOrder[0])
      .toBeLessThan(txBalanceUpdate.mock.invocationCallOrder[0])
    expect(txBalanceUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(txCorrectionCreate.mock.invocationCallOrder[0])
  })

  it.each([
    [
      'totalDays below existing carriedOver',
      { totalDays: 2 },
    ],
    [
      'carriedOver above existing totalDays',
      { carriedOver: 27 },
    ],
    [
      'carriedOver above the proposed totalDays',
      { totalDays: 24, carriedOver: 25 },
    ],
  ])('returns 422 without writes when %s', async (_label, correction) => {
    const response = await PATCH(
      patchRequest({
        ...correction,
        reason: 'Invalid carryover correction',
      }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toBe('Carried over days cannot exceed total days')
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(txBalanceFindUnique).toHaveBeenCalledOnce()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('allows and audits historical overdraft after lowering totalDays', async () => {
    const overdraftBalance = {
      ...updatedBalance,
      totalDays: 6,
      carriedOver: currentBalance.carriedOver,
    }
    txBalanceUpdate.mockResolvedValueOnce(overdraftBalance)

    const response = await PATCH(
      patchRequest({
        totalDays: 6,
        reason: 'Lower entitlement after recorded leave',
      }),
      params()
    )

    expect(response.status).toBe(200)
    expect(currentBalance.usedDays + currentBalance.pendingDays)
      .toBeGreaterThan(overdraftBalance.totalDays)
    expect(txBalanceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { totalDays: 6 },
    }))
    expect(txCorrectionCreate).toHaveBeenCalledWith({
      data: {
        balanceId: currentBalance.id,
        employeeId: currentBalance.employeeId,
        leaveTypeId: currentBalance.leaveTypeId,
        year: currentBalance.year,
        reason: 'Lower entitlement after recorded leave',
        actorId: 'admin-user',
        beforeJson: JSON.stringify({
          totalDays: 26,
          usedDays: 5,
          pendingDays: 2,
          carriedOver: 3,
        }),
        afterJson: JSON.stringify({
          totalDays: 6,
          usedDays: 5,
          pendingDays: 2,
          carriedOver: 3,
        }),
      },
    })
  })

  it('returns 422 without writes when supplied values do not change the balance', async () => {
    const response = await PATCH(
      patchRequest({ usedDays: 5, reason: 'Confirm current usage' }),
      params()
    )

    expect(response.status).toBe(422)
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(txBalanceFindUnique).toHaveBeenCalledOnce()
    expect(txBalanceUpdate).not.toHaveBeenCalled()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('does not append an audit correction when the balance update fails', async () => {
    txBalanceUpdate.mockRejectedValueOnce(new Error('update failed'))

    await expect(PATCH(
      patchRequest({ totalDays: 24, reason: 'Manual correction' }),
      params()
    )).rejects.toThrow('update failed')

    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(txCorrectionCreate).not.toHaveBeenCalled()
  })

  it('does not return success when audit creation fails after the update', async () => {
    txCorrectionCreate.mockRejectedValueOnce(new Error('correction failed'))

    await expect(PATCH(
      patchRequest({ totalDays: 24, reason: 'Manual correction' }),
      params()
    )).rejects.toThrow('correction failed')

    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(txBalanceUpdate).toHaveBeenCalledOnce()
    expect(txCorrectionCreate).toHaveBeenCalledOnce()
  })
})

describe('/api/hr/leave-balances collection access', () => {
  it('returns 403 before database access when a manager creates a balance', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))

    const response = await createLeaveBalance(createRequest())

    expect(response.status).toBe(403)
    expect(mockEmployeeFindUnique).not.toHaveBeenCalled()
    expect(mockBalanceCreate).not.toHaveBeenCalled()
  })

  it('keeps the normal creation path available to admins', async () => {
    mockBalanceFindUnique.mockResolvedValue(null)

    const response = await createLeaveBalance(createRequest())

    expect(response.status).toBe(201)
    expect(mockBalanceCreate).toHaveBeenCalledWith({
      data: {
        employeeId: currentBalance.employeeId,
        leaveTypeId: currentBalance.leaveTypeId,
        year: currentBalance.year,
        totalDays: currentBalance.totalDays,
      },
      include: {
        leaveType: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    })
  })

  it('preserves manager GET scoping to the linked division', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
    mockEmployeeFindUnique.mockResolvedValue({
      id: 'manager-1',
      divisionId: 'JAG',
      active: true,
    } as never)
    mockEmployeeFindMany.mockResolvedValue([
      { id: currentBalance.employeeId },
    ] as never)

    const response = await getLeaveBalances(
      new NextRequest('http://localhost/api/hr/leave-balances?year=2026')
    )

    expect(response.status).toBe(200)
    expect(mockEmployeeFindMany).toHaveBeenCalledWith({
      where: { active: true, divisionId: 'JAG' },
      select: { id: true },
    })
    expect(mockBalanceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        employeeId: { in: [currentBalance.employeeId] },
        year: 2026,
      },
    }))
  })
})
