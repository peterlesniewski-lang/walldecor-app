import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/finance/area-tags/route'
import { PATCH } from '@/app/api/finance/area-tags/[id]/route'

vi.mock('@/lib/finance/finance-access', () => ({
  requireFinanceAdmin: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    costTagGroup: {
      findUnique: vi.fn(),
    },
    costTag: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

const mockRequireFinanceAdmin = vi.mocked(requireFinanceAdmin)
const mockFindAreaGroup = vi.mocked(prisma.costTagGroup.findUnique)
const mockFindManyTags = vi.mocked(prisma.costTag.findMany)
const mockCreateTag = vi.mocked(prisma.costTag.create)
const mockFindAreaTag = vi.mocked(prisma.costTag.findFirst)
const mockUpdateTag = vi.mocked(prisma.costTag.update)

function request(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/finance/area-tags', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireFinanceAdmin.mockResolvedValue({
    session: {
      user: { id: 'admin-1', name: 'Admin', email: 'admin@test.pl', role: 'ADMIN' },
      expires: '',
    },
  })
})

describe('POST /api/finance/area-tags', () => {
  it('creates an active CostTag in the area group with a unique generated slug', async () => {
    mockFindAreaGroup.mockResolvedValue({
      id: 'group-area',
      name: 'Obszar',
      slug: 'area',
      order: 20,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    mockFindManyTags.mockResolvedValue([{ slug: 'zaluzje-i-rolety' }])
    mockCreateTag.mockResolvedValue({
      id: 'tag-1',
      groupId: 'group-area',
      name: 'Żaluzje i rolety',
      slug: 'zaluzje-i-rolety-2',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await POST(request('POST', { name: 'Żaluzje i rolety' }))

    expect(response.status).toBe(201)
    expect(mockCreateTag).toHaveBeenCalledWith({
      data: {
        groupId: 'group-area',
        name: 'Żaluzje i rolety',
        slug: 'zaluzje-i-rolety-2',
        active: true,
      },
    })
  })

  it('blocks non-admin users', async () => {
    mockRequireFinanceAdmin.mockResolvedValue({
      error: Response.json({ error: 'Forbidden' }, { status: 403 }),
    })

    const response = await POST(request('POST', { name: 'Tkaniny' }))

    expect(response.status).toBe(403)
    expect(mockCreateTag).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/finance/area-tags/[id]', () => {
  it('updates only area tags and supports soft-delete through active=false', async () => {
    mockFindAreaTag.mockResolvedValue({
      id: 'tag-1',
      groupId: 'group-area',
      name: 'Tkaniny',
      slug: 'tkaniny',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    mockUpdateTag.mockResolvedValue({
      id: 'tag-1',
      groupId: 'group-area',
      name: 'Tkaniny dekoracyjne',
      slug: 'tkaniny',
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await PATCH(
      request('PATCH', { name: 'Tkaniny dekoracyjne', active: false }),
      { params: Promise.resolve({ id: 'tag-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockFindAreaTag).toHaveBeenCalledWith({
      where: { id: 'tag-1', group: { slug: 'area' } },
    })
    expect(mockUpdateTag).toHaveBeenCalledWith({
      where: { id: 'tag-1' },
      data: { name: 'Tkaniny dekoracyjne', active: false },
    })
  })
})
