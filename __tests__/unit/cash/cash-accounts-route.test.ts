import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET } from '@/app/api/cash/accounts/route'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cashAccount: {
      findMany: vi.fn(),
    },
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockFindMany = vi.mocked(prisma.cashAccount.findMany)

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE') {
  return {
    user: { id: `${role.toLowerCase()}-1`, name: role, email: `${role.toLowerCase()}@test.pl`, role },
    expires: '',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/cash/accounts', () => {
  it('blocks managers from reading cash balances', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER'))

    const response = await GET()

    expect(response.status).toBe(403)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('allows admins to read cash balances', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockFindMany.mockResolvedValue([
      {
        id: 'cash-1',
        name: 'Kasa',
        currency: 'PLN',
        type: 'cash',
        balance: 1000,
        order: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(1)
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
  })
})
