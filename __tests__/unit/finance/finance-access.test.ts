import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getServerSession } from 'next-auth'
import {
  canViewConfidentialCosts,
  requireFinanceAdmin,
  requireFinanceReportAccess,
} from '@/lib/finance/finance-access'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

const mockGetServerSession = vi.mocked(getServerSession)

function sessionWithRole(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE') {
  return {
    user: { id: 'user-1', name: role, email: `${role.toLowerCase()}@test.pl`, role },
    expires: '',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireFinanceAdmin', () => {
  it('allows ADMIN users', async () => {
    const session = sessionWithRole('ADMIN')
    mockGetServerSession.mockResolvedValue(session)

    await expect(requireFinanceAdmin()).resolves.toEqual({ session })
  })

  it('blocks MANAGER users from operational finance', async () => {
    mockGetServerSession.mockResolvedValue(sessionWithRole('MANAGER'))

    const result = await requireFinanceAdmin()

    expect(result.error?.status).toBe(403)
  })
})

describe('requireFinanceReportAccess', () => {
  it('allows MANAGER users to view finance reports', async () => {
    const session = sessionWithRole('MANAGER')
    mockGetServerSession.mockResolvedValue(session)

    await expect(requireFinanceReportAccess()).resolves.toEqual({ session })
  })

  it('blocks unauthenticated users', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const result = await requireFinanceReportAccess()

    expect(result.error?.status).toBe(401)
  })
})

describe('canViewConfidentialCosts', () => {
  it('only allows ADMIN users to view confidential costs', () => {
    expect(canViewConfidentialCosts('ADMIN')).toBe(true)
    expect(canViewConfidentialCosts('MANAGER')).toBe(false)
    expect(canViewConfidentialCosts(undefined)).toBe(false)
  })
})
