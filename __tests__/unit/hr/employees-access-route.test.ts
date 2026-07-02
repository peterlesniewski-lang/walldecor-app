import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET as getEmployee } from '@/app/api/hr/employees/[id]/route'
import { GET as listEmployees } from '@/app/api/hr/employees/route'

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
      count: vi.fn(),
    },
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockFindUnique = vi.mocked(prisma.employee.findUnique)
const mockFindMany = vi.mocked(prisma.employee.findMany)
const mockCount = vi.mocked(prisma.employee.count)

function request() {
  return new NextRequest('http://localhost/api/hr/employees/employee-1')
}

function listRequest(url = 'http://localhost/api/hr/employees') {
  return new NextRequest(url)
}

function params(id = 'employee-1') {
  return { params: Promise.resolve({ id }) }
}

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

function employee(overrides: Record<string, unknown> = {}) {
  return {
    id: 'employee-1',
    firstName: 'Jan',
    lastName: 'Kowalski',
    email: 'jan@test.pl',
    divisionId: 'JAG',
    active: true,
    contracts: [{ id: 'contract-1', salary: 10000 }],
    additionalContracts: [{ id: 'additional-1', amount: 1500 }],
    salaryHistory: [{ id: 'salary-1', amount: 9000 }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/hr/employees/[id] access control', () => {
  it('removes confidential HR relations for managers', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
    mockFindUnique
      .mockResolvedValueOnce({ id: 'manager-1', divisionId: 'JAG' })
      .mockResolvedValueOnce(employee())

    const response = await getEmployee(request(), params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.id).toBe('employee-1')
    expect(body.contracts).toBeUndefined()
    expect(body.additionalContracts).toBeUndefined()
    expect(body.salaryHistory).toBeUndefined()
  })

  it('blocks employees from reading another employee profile', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'employee-2'))
    mockFindUnique.mockResolvedValueOnce(employee({ id: 'employee-1' }))

    const response = await getEmployee(request(), params('employee-1'))

    expect(response.status).toBe(403)
  })

  it('allows admins to read confidential HR relations', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockFindUnique.mockResolvedValueOnce(employee())

    const response = await getEmployee(request(), params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.contracts).toEqual([{ id: 'contract-1', salary: 10000 }])
    expect(body.additionalContracts).toEqual([{ id: 'additional-1', amount: 1500 }])
    expect(body.salaryHistory).toEqual([{ id: 'salary-1', amount: 9000 }])
  })
})

describe('GET /api/hr/employees list scoping', () => {
  it('scopes employees to their own linked record', async () => {
    mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))
    mockFindMany.mockResolvedValue([employee()])
    mockCount.mockResolvedValue(1)

    const response = await listEmployees(listRequest())

    expect(response.status).toBe(200)
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'employee-1' },
    }))
    expect(mockCount).toHaveBeenCalledWith({ where: { id: 'employee-1' } })
  })

  it('scopes managers to their own division', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
    mockFindUnique.mockResolvedValueOnce({ id: 'manager-1', divisionId: 'JAG', active: true })
    mockFindMany.mockResolvedValue([employee()])
    mockCount.mockResolvedValue(1)

    const response = await listEmployees(listRequest())

    expect(response.status).toBe(200)
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, divisionId: 'JAG' },
    }))
  })

  it('does not expose all employees to managers without a linked employee profile', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER'))

    const response = await listEmployees(listRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ employees: [], total: 0, page: 1, limit: 20 })
    expect(mockFindMany).not.toHaveBeenCalled()
    expect(mockCount).not.toHaveBeenCalled()
  })
})
