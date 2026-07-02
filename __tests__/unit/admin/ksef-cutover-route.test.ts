import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '@/app/api/admin/finance/ksef-cutover/route'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    actualEntry: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    costAuditLog: {
      create: vi.fn(),
    },
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockCount = vi.mocked(prisma.actualEntry.count)
const mockDeleteMany = vi.mocked(prisma.actualEntry.deleteMany)
const mockAuditCreate = vi.mocked(prisma.costAuditLog.create)

const removableWhere = {
  OR: [
    { year: { gt: 2026 } },
    { year: 2026, month: { gte: 4 } },
  ],
}

const preservedWhere = {
  OR: [
    { year: { lt: 2026 } },
    { year: 2026, month: { lt: 4 } },
  ],
}

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE') {
  return {
    user: { id: `${role.toLowerCase()}-1`, name: role, email: `${role.toLowerCase()}@test.pl`, role },
    expires: '',
  }
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/finance/ksef-cutover', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/api/admin/finance/ksef-cutover', () => {
  it('previews historical and removable ActualEntry counts for the KSeF cutover', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockCount.mockResolvedValueOnce(18).mockResolvedValueOnce(42)

    const response = await GET(new NextRequest('http://localhost/api/admin/finance/ksef-cutover'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockCount).toHaveBeenNthCalledWith(1, { where: preservedWhere })
    expect(mockCount).toHaveBeenNthCalledWith(2, { where: removableWhere })
    expect(body).toEqual({
      cutoff: { year: 2026, month: 4 },
      preservedActualEntriesBeforeCutover: 18,
      removableActualEntriesFromCutover: 42,
      confirmation: 'DELETE_ACTUALS_FROM_2026_04',
    })
  })

  it('blocks non-admin users from deleting post-cutover manual actuals', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER'))

    const response = await POST(postRequest({ confirm: 'DELETE_ACTUALS_FROM_2026_04' }))

    expect(response.status).toBe(403)
    expect(mockDeleteMany).not.toHaveBeenCalled()
  })

  it('requires an explicit confirmation phrase before deleting post-cutover manual actuals', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const response = await POST(postRequest({ confirm: 'yes' }))

    expect(response.status).toBe(400)
    expect(mockDeleteMany).not.toHaveBeenCalled()
  })

  it('deletes only ActualEntry rows from April 2026 onward and writes an audit log', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockDeleteMany.mockResolvedValue({ count: 42 })

    const response = await POST(postRequest({ confirm: 'DELETE_ACTUALS_FROM_2026_04' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: removableWhere })
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'actual_entry.ksef_cutover.delete',
        actorId: 'admin-1',
        beforeJson: JSON.stringify({ where: removableWhere }),
        afterJson: JSON.stringify({ deletedCount: 42 }),
      }),
    })
    expect(body).toEqual({ deletedCount: 42 })
  })
})
