import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/hr/leave-types/route'
import { PATCH } from '@/app/api/hr/leave-types/[id]/route'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leaveType: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    leaveRequestNew: {
      count: vi.fn(),
    },
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockFindUnique = vi.mocked(prisma.leaveType.findUnique)
const mockCreate = vi.mocked(prisma.leaveType.create)
const mockUpdate = vi.mocked(prisma.leaveType.update)

const adminSession = {
  user: {
    id: 'admin-1',
    role: 'ADMIN',
  },
  expires: '',
}

const managerSession = {
  user: {
    id: 'manager-1',
    role: 'MANAGER',
  },
  expires: '',
}

type LeaveTypeCode = 'VL' | 'VLD' | 'SL' | 'UB' | 'CUSTOM' | 'PARENT'

function leaveType(
  code: LeaveTypeCode,
  overrides: Record<string, unknown> = {}
) {
  const ids: Record<LeaveTypeCode, string> = {
    VL: 'leave-type-vl',
    VLD: 'leave-type-vld',
    SL: 'leave-type-sl',
    UB: 'leave-type-ub',
    CUSTOM: 'leave-type-custom',
    PARENT: 'leave-type-parent',
  }

  return {
    id: ids[code],
    name: code,
    code,
    color: '#123456',
    isPaid: code !== 'UB',
    requiresApproval: code !== 'SL',
    tracksBalance: !['SL', 'UB'].includes(code),
    maxDaysPerYear: code === 'VLD' ? 4 : null,
    isActive: true,
    parentId: code === 'VLD' ? ids.VL : null,
    ...overrides,
  }
}

function request(
  method: 'POST' | 'PATCH',
  body: Record<string, unknown> | string
) {
  return new NextRequest('http://localhost/api/hr/leave-types', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function params(id = 'leave-type-custom') {
  return { params: Promise.resolve({ id }) }
}

function arrangeExisting(existing: ReturnType<typeof leaveType>) {
  mockFindUnique.mockImplementation((async ({
    where,
  }: {
    where: { id?: string; code?: string }
  }) => {
    if (where.id === existing.id) return existing
    if (where.code === 'VL') return leaveType('VL')
    if (where.id === 'leave-type-parent') return leaveType('PARENT')
    return null
  }) as never)
  mockUpdate.mockResolvedValue(existing as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(adminSession as never)
  mockFindUnique.mockResolvedValue(null)
  mockCreate.mockResolvedValue(leaveType('CUSTOM') as never)
  mockUpdate.mockResolvedValue(leaveType('CUSTOM') as never)
})

describe('PATCH /api/hr/leave-types/:id', () => {
  it('rejects a manager before reading or updating a leave type', async () => {
    mockGetServerSession.mockResolvedValue(managerSession as never)

    const response = await PATCH(
      request('PATCH', { name: 'Nowa nazwa' }),
      params()
    )

    expect(response.status).toBe(403)
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed JSON', async () => {
    const response = await PATCH(request('PATCH', '{"name":'), params())

    expect(response.status).toBe(400)
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['isPaid', true, /UB.*płatn/i],
    ['requiresApproval', false, /UB.*akcept/i],
    ['tracksBalance', true, /UB.*sald/i],
    ['maxDaysPerYear', 1, /UB.*limit/i],
  ])('protects UB field %s', async (field, value, message) => {
    arrangeExisting(leaveType('UB'))

    const response = await PATCH(
      request('PATCH', { [field]: value }),
      params('leave-type-ub')
    )
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toMatch(message)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('prevents SL from tracking a balance', async () => {
    arrangeExisting(leaveType('SL'))

    const response = await PATCH(
      request('PATCH', { tracksBalance: true }),
      params('leave-type-sl')
    )
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toMatch(/SL.*sald/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['requiresApproval', false, /VLD.*akcept/i],
    ['tracksBalance', false, /VLD.*sald/i],
    ['maxDaysPerYear', 3, /VLD.*limit.*4/i],
    ['parentId', 'leave-type-parent', /VLD.*VL/i],
    ['parentId', null, /VLD.*VL/i],
    ['code', 'OTHER', /VLD.*kod/i],
  ])('protects VLD field %s', async (field, value, message) => {
    arrangeExisting(leaveType('VLD'))

    const response = await PATCH(
      request('PATCH', { [field]: value }),
      params('leave-type-vld')
    )
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toMatch(message)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('repairs the canonical VL parent during an unrelated VLD edit', async () => {
    arrangeExisting(leaveType('VLD', { parentId: 'legacy-parent' }))

    const response = await PATCH(
      request('PATCH', { name: 'Urlop na żądanie - nowa nazwa' }),
      params('leave-type-vld')
    )

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'leave-type-vld' },
      data: {
        name: 'Urlop na żądanie - nowa nazwa',
        parentId: 'leave-type-vl',
      },
    }))
  })

  it('returns 503 when canonical VL is missing for VLD', async () => {
    const vld = leaveType('VLD')
    mockFindUnique.mockImplementation((async ({
      where,
    }: {
      where: { id?: string; code?: string }
    }) => {
      if (where.id === vld.id) return vld
      return null
    }) as never)

    const response = await PATCH(
      request('PATCH', { name: 'Nowa nazwa' }),
      params('leave-type-vld')
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toMatch(/VLD.*VL/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('resolves canonical VL before evaluating a VLD code rename', async () => {
    const vld = leaveType('VLD')
    mockFindUnique.mockImplementation((async ({
      where,
    }: {
      where: { id?: string; code?: string }
    }) => {
      if (where.id === vld.id) return vld
      return null
    }) as never)

    const response = await PATCH(
      request('PATCH', { code: 'OTHER' }),
      params('leave-type-vld')
    )

    expect(response.status).toBe(503)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('allows a custom type to change balance tracking and use an existing parent', async () => {
    arrangeExisting(leaveType('CUSTOM'))

    const response = await PATCH(
      request('PATCH', {
        tracksBalance: false,
        parentId: 'leave-type-parent',
      }),
      params()
    )

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tracksBalance: false,
        parentId: 'leave-type-parent',
      }),
    }))
  })

  it('rejects a custom type as its own parent', async () => {
    arrangeExisting(leaveType('CUSTOM'))

    const response = await PATCH(
      request('PATCH', { parentId: 'leave-type-custom' }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toMatch(/nadrzędnym.*samego siebie/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/hr/leave-types', () => {
  it('returns 400 for malformed JSON', async () => {
    const response = await POST(request('POST', '{"name":'))

    expect(response.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['SL', { tracksBalance: true }, /SL.*sald/i],
    ['UB', { isPaid: true, requiresApproval: true, tracksBalance: false }, /UB.*płatn/i],
    ['VLD', {
      isPaid: true,
      requiresApproval: true,
      tracksBalance: true,
      maxDaysPerYear: 3,
    }, /VLD.*limit.*4/i],
  ])('rejects contradictory protected %s creation', async (code, fields, message) => {
    if (code === 'VLD') {
      mockFindUnique.mockImplementation((async ({
        where,
      }: {
        where: { id?: string; code?: string }
      }) => {
        if (where.code === 'VL') return leaveType('VL')
        return null
      }) as never)
    }

    const response = await POST(request('POST', {
      name: code,
      code,
      color: '#123456',
      ...fields,
    }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toMatch(message)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('resolves canonical VL when creating a valid VLD type', async () => {
    mockFindUnique.mockImplementation((async ({
      where,
    }: {
      where: { id?: string; code?: string }
    }) => {
      if (where.code === 'VL') return leaveType('VL')
      return null
    }) as never)
    mockCreate.mockResolvedValue(leaveType('VLD') as never)

    const response = await POST(request('POST', {
      name: 'Urlop na żądanie',
      code: 'VLD',
      color: '#8B5CF6',
      isPaid: true,
      requiresApproval: true,
      tracksBalance: true,
      maxDaysPerYear: 4,
    }))

    expect(response.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        code: 'VLD',
        parentId: 'leave-type-vl',
      }),
    }))
  })
})
