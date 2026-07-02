import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET } from '@/app/api/hr/leave-requests/route'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leaveRequestNew: {
      findMany: vi.fn(),
    },
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockFindMany = vi.mocked(prisma.leaveRequestNew.findMany)

function request(url = 'http://localhost/api/hr/leave-requests') {
  return new NextRequest(url)
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
