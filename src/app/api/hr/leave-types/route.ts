import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  PROTECTED_LEAVE_TYPE_RULES,
  isCanonicalLeaveTypeCode,
  validateProtectedLeaveTypeUpdate,
  type CanonicalLeaveTypeCode,
  type ProtectedLeaveTypeUpdate,
} from '@/lib/hr/leave-type-catalog'
import {
  runSerializableTransactionWithRetry,
  SerializableTransactionConflictError,
} from '@/lib/hr/serializable-transaction'
import { z } from 'zod'

const leaveTypeCreateSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20).toUpperCase(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  isPaid: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  tracksBalance: z.boolean().optional(),
  maxDaysPerYear: z.number().int().min(1).nullable().optional(),
  parentId: z.string().nullable().optional(),
}).strict()

class LeaveTypeMutationError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function hasOwn(value: object, field: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, field)
}

function getProtectedBehavior(code: CanonicalLeaveTypeCode) {
  const rules: ProtectedLeaveTypeUpdate = PROTECTED_LEAVE_TYPE_RULES[code]

  return {
    ...(rules.isPaid !== undefined ? { isPaid: rules.isPaid } : {}),
    ...(rules.requiresApproval !== undefined
      ? { requiresApproval: rules.requiresApproval }
      : {}),
    ...(rules.tracksBalance !== undefined
      ? { tracksBalance: rules.tracksBalance }
      : {}),
    ...(hasOwn(rules, 'maxDaysPerYear')
      ? { maxDaysPerYear: rules.maxDaysPerYear }
      : {}),
  }
}

function isCodeUniqueConstraintError(error: unknown) {
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== 'P2002' ||
    !('meta' in error) ||
    typeof error.meta !== 'object' ||
    error.meta === null ||
    !('target' in error.meta)
  ) {
    return false
  }

  const target = error.meta.target
  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === 'code'
  }

  return typeof target === 'string' && /(?:^|_)code(?:_|$)/i.test(target)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const activeOnly = searchParams.get('activeOnly') === 'true'

  const where = activeOnly ? { isActive: true } : {}

  const leaveTypes = await prisma.leaveType.findMany({
    where,
    include: {
      subtypes: {
        where: activeOnly ? { isActive: true } : {},
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: {
              leaveBalancesNew: true,
              leaveRequestsNew: true,
            },
          },
        },
      },
      _count: {
        select: {
          leaveBalancesNew: true,
          leaveRequestsNew: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(leaveTypes)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowy JSON' }, { status: 400 })
  }

  const parsed = leaveTypeCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  // Check code uniqueness
  const existing = await prisma.leaveType.findUnique({ where: { code: parsed.data.code } })
  if (existing) {
    return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
  }

  let canonicalVl: { id: string } | null = null
  if (parsed.data.code === 'VLD') {
    canonicalVl = await prisma.leaveType.findUnique({
      where: { code: 'VL' },
      select: { id: true },
    })
    if (!canonicalVl) {
      return NextResponse.json(
        { error: 'Typ VLD wymaga kanonicznego typu nadrzędnego VL, którego brakuje.' },
        { status: 503 }
      )
    }
  }

  const protectedUpdate: ProtectedLeaveTypeUpdate = {}
  if (hasOwn(parsed.data, 'isPaid')) {
    protectedUpdate.isPaid = parsed.data.isPaid
  }
  if (hasOwn(parsed.data, 'requiresApproval')) {
    protectedUpdate.requiresApproval = parsed.data.requiresApproval
  }
  if (hasOwn(parsed.data, 'tracksBalance')) {
    protectedUpdate.tracksBalance = parsed.data.tracksBalance
  }
  if (hasOwn(parsed.data, 'maxDaysPerYear')) {
    protectedUpdate.maxDaysPerYear = parsed.data.maxDaysPerYear
  }
  if (parsed.data.code === 'VLD' && hasOwn(parsed.data, 'parentId')) {
    protectedUpdate.parentCode =
      parsed.data.parentId === canonicalVl?.id ? 'VL' : null
  }

  const protectedError = validateProtectedLeaveTypeUpdate(
    parsed.data.code,
    protectedUpdate
  )
  if (protectedError) {
    return NextResponse.json({ error: protectedError }, { status: 422 })
  }

  const canonicalBehavior = isCanonicalLeaveTypeCode(parsed.data.code)
    ? getProtectedBehavior(parsed.data.code)
    : {}
  const parentId = parsed.data.code === 'VLD'
    ? canonicalVl!.id
    : parsed.data.parentId ?? null
  const createData = {
    name: parsed.data.name,
    code: parsed.data.code,
    color: parsed.data.color ?? '#3B82F6',
    isPaid: parsed.data.isPaid ?? true,
    requiresApproval: parsed.data.requiresApproval ?? true,
    tracksBalance: parsed.data.tracksBalance ?? true,
    maxDaysPerYear: parsed.data.maxDaysPerYear ?? null,
    parentId,
    ...canonicalBehavior,
  }

  try {
    const leaveType = await runSerializableTransactionWithRetry(() =>
      prisma.$transaction(async (tx) => {
        if (parsed.data.code !== 'VLD' && parentId) {
          const parent = await tx.leaveType.findUnique({
            where: { id: parentId },
            select: { id: true, parentId: true },
          })
          if (!parent) {
            throw new LeaveTypeMutationError(404, 'Parent leave type not found')
          }
          if (parent.parentId !== null) {
            throw new LeaveTypeMutationError(
              422,
              'Hierarchia typów urlopu może mieć tylko jeden poziom; wybierz typ główny.'
            )
          }
        }

        return tx.leaveType.create({
          data: createData,
          include: {
            subtypes: true,
            _count: {
              select: {
                leaveBalancesNew: true,
                leaveRequestsNew: true,
              },
            },
          },
        })
      }, { isolationLevel: 'Serializable' })
    )

    return NextResponse.json(leaveType, { status: 201 })
  } catch (error) {
    if (error instanceof LeaveTypeMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof SerializableTransactionConflictError) {
      return NextResponse.json(
        { error: 'Nie udało się zapisać typu urlopu z powodu konfliktu danych.' },
        { status: 409 }
      )
    }
    if (isCodeUniqueConstraintError(error)) {
      return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
    }
    throw error
  }
}
