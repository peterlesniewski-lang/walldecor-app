import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/hr/leave-types/route'
import {
  DELETE,
  PATCH,
} from '@/app/api/hr/leave-types/[id]/route'

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
    $transaction: vi.fn(),
  },
}))

const mockGetServerSession = vi.mocked(getServerSession)
const mockFindUnique = vi.mocked(prisma.leaveType.findUnique)
const mockCreate = vi.mocked(prisma.leaveType.create)
const mockUpdate = vi.mocked(prisma.leaveType.update)
const mockPendingCount = vi.mocked(prisma.leaveRequestNew.count)
const mockTransaction = vi.mocked(prisma.$transaction)

const txFindUnique = vi.fn()
const txCount = vi.fn()
const txCreate = vi.fn()
const txUpdate = vi.fn()
const tx = {
  leaveType: {
    findUnique: txFindUnique,
    count: txCount,
    create: txCreate,
    update: txUpdate,
  },
}

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
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown> | string
) {
  return new NextRequest('http://localhost/api/hr/leave-types', {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
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
  txFindUnique.mockImplementation(async ({
    where,
  }: {
    where: { id?: string; code?: string }
  }) => {
    if (where.id === 'leave-type-parent') return leaveType('PARENT')
    if (where.code === 'VL') return leaveType('VL')
    return null
  })
  txUpdate.mockResolvedValue(existing)
}

function expectNoMutation() {
  expect(mockCreate).not.toHaveBeenCalled()
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(txCreate).not.toHaveBeenCalled()
  expect(txUpdate).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(adminSession as never)
  mockFindUnique.mockResolvedValue(null)
  mockCreate.mockResolvedValue(leaveType('CUSTOM') as never)
  mockUpdate.mockResolvedValue(leaveType('CUSTOM') as never)
  mockPendingCount.mockResolvedValue(0)
  txFindUnique.mockResolvedValue(null)
  txCount.mockResolvedValue(0)
  txCreate.mockResolvedValue(leaveType('CUSTOM'))
  txUpdate.mockResolvedValue(leaveType('CUSTOM'))
  mockTransaction.mockImplementation(
    async (callback) => callback(tx as never) as never
  )
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
    expectNoMutation()
  })

  it('returns 400 for malformed JSON', async () => {
    const response = await PATCH(request('PATCH', '{"name":'), params())

    expect(response.status).toBe(400)
    expect(mockFindUnique).not.toHaveBeenCalled()
    expectNoMutation()
  })

  it.each([
    ['isPaid', false, /VL.*płatn/i],
    ['requiresApproval', false, /VL.*akcept/i],
    ['tracksBalance', false, /VL.*sald/i],
  ])('protects VL field %s', async (field, value, message) => {
    arrangeExisting(leaveType('VL'))

    const response = await PATCH(
      request('PATCH', { [field]: value }),
      params('leave-type-vl')
    )
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toMatch(message)
    expectNoMutation()
  })

  it('rejects moving VL under another type before hierarchy lookup or update', async () => {
    arrangeExisting(leaveType('VL'))

    const response = await PATCH(
      request('PATCH', { parentId: 'leave-type-parent' }),
      params('leave-type-vl')
    )
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toMatch(/VL.*nadrzędn/i)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(txFindUnique).not.toHaveBeenCalled()
    expectNoMutation()
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
    expectNoMutation()
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
    expectNoMutation()
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
    expectNoMutation()
  })

  it.each([
    ['VL', {
      isPaid: true,
      requiresApproval: true,
      tracksBalance: true,
      parentId: null,
    }],
    ['UB', {
      isPaid: false,
      requiresApproval: true,
      tracksBalance: false,
      maxDaysPerYear: null,
    }],
    ['SL', {
      tracksBalance: false,
    }],
  ])('repairs canonical %s behavior during an unrelated edit', async (code, behavior) => {
    const canonical = leaveType(code as LeaveTypeCode, {
      isPaid: false,
      requiresApproval: false,
      tracksBalance: true,
      maxDaysPerYear: 12,
    })
    arrangeExisting(canonical)

    const response = await PATCH(
      request('PATCH', { name: 'Nowa nazwa' }),
      params(canonical.id)
    )

    expect(response.status).toBe(200)
    expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: canonical.id },
      data: expect.objectContaining({
        name: 'Nowa nazwa',
        ...behavior,
      }),
    }))
    if (code === 'VL') {
      expect(txUpdate.mock.calls[0][0].data).not.toHaveProperty('maxDaysPerYear')
    }
  })

  it('repairs all protected VLD behavior and canonical parent during an unrelated edit', async () => {
    arrangeExisting(leaveType('VLD', {
      requiresApproval: false,
      tracksBalance: false,
      maxDaysPerYear: 2,
      parentId: 'legacy-parent',
    }))

    const response = await PATCH(
      request('PATCH', { name: 'Urlop na żądanie - nowa nazwa' }),
      params('leave-type-vld')
    )

    expect(response.status).toBe(200)
    expect(txFindUnique).toHaveBeenCalledWith({
      where: { code: 'VL' },
      select: { id: true, parentId: true },
    })
    expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'leave-type-vld' },
      data: expect.objectContaining({
        name: 'Urlop na żądanie - nowa nazwa',
        requiresApproval: true,
        tracksBalance: true,
        maxDaysPerYear: 4,
        parentId: 'leave-type-vl',
      }),
    }))
  })

  it('returns 503 without repairing VLD when transaction-local VL is non-root', async () => {
    arrangeExisting(leaveType('VLD'))
    txFindUnique.mockImplementation(async ({
      where,
    }: {
      where: { id?: string; code?: string }
    }) => {
      if (where.code === 'VL') {
        return leaveType('VL', { parentId: 'leave-type-custom' })
      }
      return null
    })

    const response = await PATCH(
      request('PATCH', { name: 'Nowa nazwa' }),
      params('leave-type-vld')
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toMatch(/VLD.*VL.*główn|konfigur/i)
    expect(txFindUnique).toHaveBeenCalledWith({
      where: { code: 'VL' },
      select: { id: true, parentId: true },
    })
    expectNoMutation()
  })

  it('returns 503 without repairing VLD when VL disappears inside the transaction', async () => {
    arrangeExisting(leaveType('VLD'))
    txFindUnique.mockResolvedValue(null)

    const response = await PATCH(
      request('PATCH', { name: 'Nowa nazwa' }),
      params('leave-type-vld')
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toMatch(/VLD.*VL.*główn|konfigur/i)
    expect(mockTransaction).toHaveBeenCalled()
    expect(txFindUnique).toHaveBeenCalledWith({
      where: { code: 'VL' },
      select: { id: true, parentId: true },
    })
    expectNoMutation()
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
    expectNoMutation()
  })

  it('rejects a VLD code rename before resolving canonical VL', async () => {
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
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toMatch(/VLD.*kod/i)
    expect(mockFindUnique).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { code: 'VL' },
    }))
    expectNoMutation()
  })

  it.each(['VL', 'VLD', 'SL', 'UB'])(
    'rejects renaming a custom row into canonical code %s',
    async (code) => {
      arrangeExisting(leaveType('CUSTOM'))

      const response = await PATCH(
        request('PATCH', { code }),
        params()
      )
      const body = await response.json()

      expect(response.status).toBe(422)
      expect(body.error).toMatch(new RegExp(code))
      expectNoMutation()
    }
  )

  it.each(['VL', 'VLD', 'SL', 'UB'])(
    'rejects PATCH deactivation of canonical %s',
    async (code) => {
      const canonical = leaveType(code as LeaveTypeCode)
      arrangeExisting(canonical)

      const response = await PATCH(
        request('PATCH', { isActive: false }),
        params(canonical.id)
      )

      expect(response.status).toBe(422)
      expectNoMutation()
    }
  )

  it('rejects isActive in custom PATCH and requires DELETE', async () => {
    arrangeExisting(leaveType('CUSTOM'))

    const response = await PATCH(
      request('PATCH', { isActive: false }),
      params()
    )

    expect(response.status).toBe(400)
    expectNoMutation()
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
    expect(mockTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' }
    )
    expect(txCount).toHaveBeenCalledWith({
      where: { parentId: 'leave-type-custom' },
    })
    expect(txFindUnique).toHaveBeenCalledWith({
      where: { id: 'leave-type-parent' },
      select: { id: true, parentId: true },
    })
    expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({
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
    expectNoMutation()
  })

  it('rejects a non-root custom parent inside the transaction', async () => {
    arrangeExisting(leaveType('CUSTOM'))
    txFindUnique.mockResolvedValue(
      leaveType('PARENT', { parentId: 'leave-type-vl' })
    )

    const response = await PATCH(
      request('PATCH', { parentId: 'leave-type-parent' }),
      params()
    )
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toMatch(/jeden poziom|główn/i)
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it.each(['CUSTOM', 'SL'] as const)(
    'rejects moving %s with subtypes under another root inside the transaction',
    async (code) => {
      const existing = leaveType(code)
      arrangeExisting(existing)
      txCount.mockResolvedValue(1)

      const response = await PATCH(
        request('PATCH', { parentId: 'leave-type-parent' }),
        params(existing.id)
      )
      const body = await response.json()

      expect(response.status).toBe(422)
      expect(body.error).toMatch(/podtyp|dzieci|jeden poziom/i)
      expect(txCount).toHaveBeenCalledWith({
        where: { parentId: existing.id },
      })
      expect(txFindUnique).not.toHaveBeenCalled()
      expectNoMutation()
    }
  )

  it('maps exhausted serializable retries to 409', async () => {
    arrangeExisting(leaveType('CUSTOM'))
    mockTransaction.mockRejectedValue(
      Object.assign(new Error('Write conflict'), { code: 'P2034' })
    )

    const response = await PATCH(
      request('PATCH', { name: 'Nowa nazwa' }),
      params()
    )

    expect(response.status).toBe(409)
    expect(mockTransaction).toHaveBeenCalledTimes(3)
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('maps a code-targeted update P2002 race to 409', async () => {
    arrangeExisting(leaveType('CUSTOM'))
    txUpdate.mockRejectedValue(Object.assign(new Error('Unique constraint'), {
      code: 'P2002',
      meta: { modelName: 'LeaveType', target: ['code'] },
    }))

    const response = await PATCH(
      request('PATCH', { code: 'NEW' }),
      params()
    )

    expect(response.status).toBe(409)
    expect(txUpdate).toHaveBeenCalledOnce()
  })
})

describe('DELETE /api/hr/leave-types/:id', () => {
  it.each(['VL', 'VLD', 'SL', 'UB'])(
    'rejects deactivation of canonical %s without checking pending requests',
    async (code) => {
      const canonical = leaveType(code as LeaveTypeCode)
      arrangeExisting(canonical)

      const response = await DELETE(
        request('DELETE'),
        params(canonical.id)
      )

      expect(response.status).toBe(422)
      expect(mockPendingCount).not.toHaveBeenCalled()
      expectNoMutation()
    }
  )
})

describe('POST /api/hr/leave-types', () => {
  it('returns 400 for malformed JSON', async () => {
    const response = await POST(request('POST', '{"name":'))

    expect(response.status).toBe(400)
    expectNoMutation()
  })

  it.each([
    ['VL', { isPaid: false }, /VL.*płatn/i],
    ['VL', { parentId: 'leave-type-parent' }, /VL.*nadrzędn/i],
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
    expectNoMutation()
  })

  it.each([
    ['VL', {
      isPaid: true,
      requiresApproval: true,
      tracksBalance: true,
    }],
    ['SL', {
      tracksBalance: false,
    }],
    ['UB', {
      isPaid: false,
      requiresApproval: true,
      tracksBalance: false,
      maxDaysPerYear: null,
    }],
  ])('applies canonical defaults when creating %s with omitted behavior', async (code, expected) => {
    txCreate.mockResolvedValue(leaveType(code as LeaveTypeCode))

    const response = await POST(request('POST', {
      name: code,
      code,
    }))

    expect(response.status).toBe(201)
    expect(txCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining(expected),
    }))
  })

  it('returns 503 without creating VLD when transaction-local VL is non-root', async () => {
    mockFindUnique.mockImplementation((async ({
      where,
    }: {
      where: { id?: string; code?: string }
    }) => {
      if (where.code === 'VL') return leaveType('VL')
      return null
    }) as never)
    txFindUnique.mockResolvedValue(
      leaveType('VL', { parentId: 'leave-type-custom' })
    )

    const response = await POST(request('POST', {
      name: 'Urlop na żądanie',
      code: 'VLD',
    }))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toMatch(/VLD.*VL.*główn|konfigur/i)
    expect(txFindUnique).toHaveBeenCalledWith({
      where: { code: 'VL' },
      select: { id: true, parentId: true },
    })
    expectNoMutation()
  })

  it('returns 503 without creating VLD when VL disappears inside the transaction', async () => {
    mockFindUnique.mockImplementation((async ({
      where,
    }: {
      where: { id?: string; code?: string }
    }) => {
      if (where.code === 'VL') return leaveType('VL')
      return null
    }) as never)
    txFindUnique.mockResolvedValue(null)

    const response = await POST(request('POST', {
      name: 'Urlop na żądanie',
      code: 'VLD',
    }))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toMatch(/VLD.*VL.*główn|konfigur/i)
    expect(mockTransaction).toHaveBeenCalled()
    expect(txFindUnique).toHaveBeenCalledWith({
      where: { code: 'VL' },
      select: { id: true, parentId: true },
    })
    expectNoMutation()
  })

  it('resolves canonical VL and defaults when creating VLD with omitted behavior', async () => {
    mockFindUnique.mockImplementation((async ({
      where,
    }: {
      where: { id?: string; code?: string }
    }) => {
      if (where.code === 'VL') return leaveType('VL')
      return null
    }) as never)
    txFindUnique.mockResolvedValue(leaveType('VL'))
    txCreate.mockResolvedValue(leaveType('VLD'))

    const response = await POST(request('POST', {
      name: 'Urlop na żądanie',
      code: 'VLD',
    }))

    expect(response.status).toBe(201)
    expect(txFindUnique).toHaveBeenCalledWith({
      where: { code: 'VL' },
      select: { id: true, parentId: true },
    })
    expect(txCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        code: 'VLD',
        requiresApproval: true,
        tracksBalance: true,
        maxDaysPerYear: 4,
        parentId: 'leave-type-vl',
      }),
    }))
  })

  it('re-reads a custom parent and creates inside a Serializable transaction', async () => {
    txFindUnique.mockResolvedValue(leaveType('PARENT'))

    const response = await POST(request('POST', {
      name: 'Custom',
      code: 'CUSTOM',
      parentId: 'leave-type-parent',
    }))

    expect(response.status).toBe(201)
    expect(mockTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' }
    )
    expect(txFindUnique).toHaveBeenCalledWith({
      where: { id: 'leave-type-parent' },
      select: { id: true, parentId: true },
    })
    expect(txCreate).toHaveBeenCalledOnce()
  })

  it('maps a code-targeted create P2002 race to 409', async () => {
    txCreate.mockRejectedValue(Object.assign(new Error('Unique constraint'), {
      code: 'P2002',
      meta: { modelName: 'LeaveType', target: ['code'] },
    }))

    const response = await POST(request('POST', {
      name: 'Custom',
      code: 'CUSTOM',
    }))

    expect(response.status).toBe(409)
    expect(txCreate).toHaveBeenCalledOnce()
  })

  it('preserves a non-code P2002 create error', async () => {
    const error = Object.assign(new Error('Different unique constraint'), {
      code: 'P2002',
      meta: { modelName: 'LeaveType', target: ['name'] },
    })
    txCreate.mockRejectedValue(error)

    await expect(POST(request('POST', {
      name: 'Custom',
      code: 'CUSTOM',
    }))).rejects.toBe(error)
  })
})
