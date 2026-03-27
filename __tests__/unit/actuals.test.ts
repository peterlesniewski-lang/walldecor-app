import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/actuals/route'
import { ActualEntrySchema } from '@/lib/validations/actuals'

// Mock next-auth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    actualEntry: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRequest(
  method: string,
  body?: unknown,
  searchParams?: Record<string, string>
) {
  const url = new URL('http://localhost/api/actuals')
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      url.searchParams.set(k, v)
    }
  }
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  })
}

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockGetServerSession = vi.mocked(getServerSession)
const mockUpsert = vi.mocked(prisma.actualEntry.upsert)
const mockFindMany = vi.mocked(prisma.actualEntry.findMany)

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// POST /api/actuals
// ---------------------------------------------------------------------------

describe('POST /api/actuals', () => {
  it('should save actual entry as ADMIN and return 200', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: '1', name: 'Admin', email: 'admin@test.com', role: 'ADMIN' },
      expires: '',
    })
    mockUpsert.mockResolvedValue({
      id: 'entry1',
      year: 2026,
      month: 3,
      amount: 1500,
      costCenterId: 'JAG',
      subCategoryId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
    })

    const req = makeRequest('POST', {
      year: 2026,
      month: 3,
      costCenterId: 'JAG',
      subCategoryId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      amount: 1500,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledOnce()
  })

  it('should save actual entry as MANAGER and return 200', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: '2', name: 'Manager', email: 'mgr@test.com', role: 'MANAGER' },
      expires: '',
    })
    mockUpsert.mockResolvedValue({
      id: 'entry2',
      year: 2026,
      month: 3,
      amount: 800,
      costCenterId: 'JAG',
      subCategoryId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
    })

    const req = makeRequest('POST', {
      year: 2026,
      month: 3,
      costCenterId: 'JAG',
      subCategoryId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      amount: 800,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledOnce()
  })

  it('should return 403 for EMPLOYEE role', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: '3', name: 'Employee', email: 'emp@test.com', role: 'EMPLOYEE' },
      expires: '',
    })

    const req = makeRequest('POST', {
      year: 2026,
      month: 3,
      costCenterId: 'JAG',
      subCategoryId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      amount: 1000,
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('should return 400 for negative amount', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: '1', name: 'Admin', email: 'admin@test.com', role: 'ADMIN' },
      expires: '',
    })

    const req = makeRequest('POST', {
      year: 2026,
      month: 3,
      costCenterId: 'JAG',
      subCategoryId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      amount: -1,
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// GET /api/actuals
// ---------------------------------------------------------------------------

describe('GET /api/actuals', () => {
  it('should return 401 without session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const req = makeRequest('GET', undefined, { year: '2026', costCenterId: 'JAG' })
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ActualEntrySchema — direct unit tests
// ---------------------------------------------------------------------------

describe('ActualEntrySchema', () => {
  it('should accept valid actual entry', () => {
    const result = ActualEntrySchema.safeParse({
      year: 2026,
      month: 3,
      costCenterId: 'JAG',
      subCategoryId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      amount: 500,
    })
    expect(result.success).toBe(true)
  })

  it('should reject negative amount', () => {
    const result = ActualEntrySchema.safeParse({
      year: 2026,
      month: 3,
      costCenterId: 'JAG',
      subCategoryId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      amount: -50,
    })
    expect(result.success).toBe(false)
  })

  it('should accept amount=0 as valid', () => {
    const result = ActualEntrySchema.safeParse({
      year: 2026,
      month: 3,
      costCenterId: 'JAG',
      subCategoryId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      amount: 0,
    })
    expect(result.success).toBe(true)
  })
})
