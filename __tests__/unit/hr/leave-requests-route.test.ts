import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '@/app/api/hr/leave-requests/route'

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
    leaveBalanceNew: {
      findUnique: vi.fn(),
    },
    leaveRequestNew: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockFindMany = vi.mocked(prisma.leaveRequestNew.findMany)
const mockEmployeeFindUnique = vi.mocked(prisma.employee.findUnique)
const mockLeaveTypeFindUnique = vi.mocked(prisma.leaveType.findUnique)
const mockBalanceFindUnique = vi.mocked(prisma.leaveBalanceNew.findUnique)
const mockRequestFindFirst = vi.mocked(prisma.leaveRequestNew.findFirst)
const mockTransaction = vi.mocked(prisma.$transaction)

function request(
  url = 'http://localhost/api/hr/leave-requests',
  init?: ConstructorParameters<typeof NextRequest>[1]
) {
  return new NextRequest(url, init)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/hr/leave-requests', () => {
  it('returns an empty array for an employee account without linked employee profile', async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: 'user-1',
        name: 'Pracownik',
        email: 'pracownik@test.pl',
        role: 'EMPLOYEE',
        employeeId: null,
      },
      expires: '',
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/hr/leave-requests', () => {
  it('creates sick leave without requiring a leave balance', async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: 'admin-1',
        name: 'Administrator',
        email: 'admin@test.pl',
        role: 'ADMIN',
        employeeId: null,
      },
      expires: '',
    })
    mockEmployeeFindUnique.mockResolvedValue({
      id: 'employee-1',
    } as never)
    mockLeaveTypeFindUnique.mockResolvedValue({
      id: 'leave-type-sl',
      code: 'SL',
      tracksBalance: false,
    } as never)
    mockRequestFindFirst.mockResolvedValue(null)
    mockTransaction.mockImplementation(async (callback) => callback({
      leaveRequestNew: {
        create: vi.fn().mockResolvedValue({
          id: 'request-1',
          employeeId: 'employee-1',
          leaveTypeId: 'leave-type-sl',
          status: 'pending',
        }),
      },
      leaveBalanceNew: {
        update: vi.fn(),
      },
    } as never) as never)

    const response = await POST(request(undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: 'employee-1',
        leaveTypeId: 'leave-type-sl',
        startDate: '2026-07-29',
        endDate: '2026-07-29',
        isOnDemand: false,
        isRemoteWork: false,
        isDelegation: false,
        notifySubstitute: false,
      }),
    }))

    expect(response.status).toBe(201)
    expect(mockBalanceFindUnique).not.toHaveBeenCalled()
  })
})
