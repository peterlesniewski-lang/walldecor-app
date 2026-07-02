import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET as getAttendanceReport } from '@/app/api/hr/reports/attendance/route'

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
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockFindUnique = vi.mocked(prisma.employee.findUnique)
const mockFindMany = vi.mocked(prisma.employee.findMany)

function request(url = 'http://localhost/api/hr/reports/attendance?month=2026-07') {
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HR report access scoping', () => {
  it('scopes manager attendance reports to the linked manager division', async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: 'manager-user',
        name: 'Manager',
        email: 'manager@test.pl',
        role: 'MANAGER',
        employeeId: 'manager-1',
      },
      expires: '',
    })
    mockFindUnique.mockResolvedValue({ id: 'manager-1', divisionId: 'JAG', active: true })
    mockFindMany.mockResolvedValue([])

    const response = await getAttendanceReport(request())

    expect(response.status).toBe(200)
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, divisionId: 'JAG' },
    }))
  })

  it('does not expose all attendance data to managers without a linked employee profile', async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: 'manager-user',
        name: 'Manager',
        email: 'manager@test.pl',
        role: 'MANAGER',
        employeeId: null,
      },
      expires: '',
    })

    const response = await getAttendanceReport(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ month: '2026-07', employees: [] })
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})
