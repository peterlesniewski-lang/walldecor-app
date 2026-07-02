import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET, PATCH } from '@/app/api/admin/content-visibility/route'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    article: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    checklistTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    checklistRun: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    contentVisibilityGrant: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockFindUser = vi.mocked(prisma.user.findUnique)
const mockFindArticle = vi.mocked(prisma.article.findFirst)
const mockUpsertGrant = vi.mocked(prisma.contentVisibilityGrant.upsert)
const mockDeleteGrant = vi.mocked(prisma.contentVisibilityGrant.deleteMany)

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE') {
  return {
    user: { id: `${role.toLowerCase()}-1`, name: role, email: `${role.toLowerCase()}@test.pl`, role },
    expires: '',
  }
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/content-visibility', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindUser.mockResolvedValue({ id: 'user-1', isActive: true, role: 'EMPLOYEE' })
  mockFindArticle.mockResolvedValue({ id: 'procedure-1' })
  mockUpsertGrant.mockResolvedValue({
    id: 'grant-1',
    resourceType: 'procedure',
    resourceId: 'procedure-1',
    userId: 'user-1',
    grantedById: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

describe('/api/admin/content-visibility', () => {
  it('blocks non-admin users from changing grants', async () => {
    mockGetServerSession.mockResolvedValue(session('MANAGER'))

    const response = await PATCH(patchRequest({
      resourceType: 'procedure',
      resourceId: 'procedure-1',
      userId: 'user-1',
      visible: true,
    }))

    expect(response.status).toBe(403)
    expect(mockUpsertGrant).not.toHaveBeenCalled()
  })

  it('rejects unsupported resource types', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const response = await GET(new NextRequest('http://localhost/api/admin/content-visibility?resourceType=document'))

    expect(response.status).toBe(400)
  })

  it('grants procedure visibility for an active user', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const response = await PATCH(patchRequest({
      resourceType: 'procedure',
      resourceId: 'procedure-1',
      userId: 'user-1',
      visible: true,
    }))

    expect(response.status).toBe(200)
    expect(mockUpsertGrant).toHaveBeenCalledWith({
      where: {
        resourceType_resourceId_userId: {
          resourceType: 'procedure',
          resourceId: 'procedure-1',
          userId: 'user-1',
        },
      },
      update: { grantedById: 'admin-1' },
      create: {
        resourceType: 'procedure',
        resourceId: 'procedure-1',
        userId: 'user-1',
        grantedById: 'admin-1',
      },
    })
  })

  it('does not create no-op grants for managers', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))
    mockFindUser.mockResolvedValue({ id: 'manager-1', isActive: true, role: 'MANAGER' })

    const response = await PATCH(patchRequest({
      resourceType: 'procedure',
      resourceId: 'procedure-1',
      userId: 'manager-1',
      visible: true,
    }))

    expect(response.status).toBe(400)
    expect(mockUpsertGrant).not.toHaveBeenCalled()
  })

  it('revokes procedure visibility', async () => {
    mockGetServerSession.mockResolvedValue(session('ADMIN'))

    const response = await PATCH(patchRequest({
      resourceType: 'procedure',
      resourceId: 'procedure-1',
      userId: 'user-1',
      visible: false,
    }))

    expect(response.status).toBe(200)
    expect(mockDeleteGrant).toHaveBeenCalledWith({
      where: { resourceType: 'procedure', resourceId: 'procedure-1', userId: 'user-1' },
    })
  })
})
