import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/finance/cost-tags/route'

vi.mock('@/lib/finance/finance-access', () => ({
  requireFinanceAdmin: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    costTagGroup: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    costTag: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}))

const mockRequireFinanceAdmin = vi.mocked(requireFinanceAdmin)
const mockFindGroup = vi.mocked(prisma.costTagGroup.findUnique)
const mockFindManyTags = vi.mocked(prisma.costTag.findMany)
const mockCreateTag = vi.mocked(prisma.costTag.create)

function request(body: unknown) {
  return new NextRequest('http://localhost/api/finance/cost-tags', {
    method: 'POST',
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

describe('POST /api/finance/cost-tags', () => {
  it('creates an active custom tag in an open group with a unique slug', async () => {
    mockFindGroup.mockResolvedValue({
      id: 'group-role',
      name: 'Typ wydatku',
      slug: 'role',
      order: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    mockFindManyTags.mockResolvedValue([{ slug: 'uslugi-prawne' }])
    mockCreateTag.mockResolvedValue({
      id: 'tag-legal',
      groupId: 'group-role',
      name: 'Usługi prawne',
      slug: 'uslugi-prawne-2',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await POST(request({ groupSlug: 'role', name: 'Usługi prawne' }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.tag).toMatchObject({ id: 'tag-legal', name: 'Usługi prawne', slug: 'uslugi-prawne-2' })
    expect(mockCreateTag).toHaveBeenCalledWith({
      data: {
        groupId: 'group-role',
        name: 'Usługi prawne',
        slug: 'uslugi-prawne-2',
        active: true,
      },
      select: { id: true, name: true, slug: true },
    })
  })

  it('rejects creating tags in closed groups', async () => {
    const response = await POST(request({ groupSlug: 'behavior', name: 'Sezonowy' }))

    expect(response.status).toBe(400)
    expect(mockCreateTag).not.toHaveBeenCalled()
  })
})
