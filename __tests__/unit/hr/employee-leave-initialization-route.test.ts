import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/hr/employees/route'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: {
      create: vi.fn(),
    },
    leaveType: {
      findMany: vi.fn(),
    },
    leaveBalanceNew: {
      createMany: vi.fn(),
    },
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockEmployeeCreate = vi.mocked(prisma.employee.create)
const mockLeaveTypeFindMany = vi.mocked(prisma.leaveType.findMany)
const mockBalanceCreateMany = vi.mocked(prisma.leaveBalanceNew.createMany)

const createdEmployee = {
  id: 'employee-new',
  firstName: 'Anna',
  lastName: 'Nowak',
  email: 'anna.nowak@test.pl',
}

function session() {
  return {
    user: {
      id: 'admin-user',
      name: 'Admin',
      email: 'admin@test.pl',
      role: 'ADMIN' as const,
      employeeId: null,
    },
    expires: '',
  }
}

function request() {
  return new NextRequest('http://localhost/api/hr/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: createdEmployee.firstName,
      lastName: createdEmployee.lastName,
      email: createdEmployee.email,
      employmentType: 'UoP',
      startDate: '2026-07-01',
      costCenterId: 'JAG',
      position: 'Sprzedawca',
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(session())
  mockEmployeeCreate.mockResolvedValue(createdEmployee as never)
})

describe('POST /api/hr/employees leave initialization', () => {
  it('creates an employee without querying leave types or blanket balances', async () => {
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toEqual(createdEmployee)
    expect(mockEmployeeCreate).toHaveBeenCalledOnce()
    expect(mockLeaveTypeFindMany).not.toHaveBeenCalled()
    expect(mockBalanceCreateMany).not.toHaveBeenCalled()
  })
})
