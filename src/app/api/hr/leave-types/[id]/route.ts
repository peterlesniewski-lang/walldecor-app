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

const leaveTypeUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(20).toUpperCase().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  isPaid: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  tracksBalance: z.boolean().optional(),
  maxDaysPerYear: z.number().int().min(1).nullable().optional(),
  parentId: z.string().nullable().optional(),
}).strict()

type Params = { params: Promise<{ id: string }> }

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

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowy JSON' }, { status: 400 })
  }

  const existing = await prisma.leaveType.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (
    isCanonicalLeaveTypeCode(existing.code) &&
    typeof body === 'object' &&
    body !== null &&
    hasOwn(body, 'isActive')
  ) {
    return NextResponse.json(
      { error: `Typ ${existing.code}: typ kanoniczny nie może zostać dezaktywowany.` },
      { status: 422 }
    )
  }

  const parsed = leaveTypeUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  if (
    isCanonicalLeaveTypeCode(existing.code) &&
    parsed.data.code &&
    parsed.data.code !== existing.code
  ) {
    return NextResponse.json(
      { error: `Typ ${existing.code}: chroniony kod nie może zostać zmieniony.` },
      { status: 422 }
    )
  }

  if (
    !isCanonicalLeaveTypeCode(existing.code) &&
    parsed.data.code &&
    isCanonicalLeaveTypeCode(parsed.data.code)
  ) {
    return NextResponse.json(
      { error: `Kod ${parsed.data.code} jest zarezerwowany dla kanonicznego typu urlopu.` },
      { status: 422 }
    )
  }

  let canonicalVl: { id: string } | null = null
  if (existing.code === 'VLD') {
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
  if (existing.code === 'VLD' && hasOwn(parsed.data, 'parentId')) {
    protectedUpdate.parentCode =
      parsed.data.parentId === canonicalVl?.id ? 'VL' : null
  }
  if (existing.code === 'VL' && hasOwn(parsed.data, 'parentId')) {
    protectedUpdate.parentCode =
      parsed.data.parentId === null ? null : 'INNY'
  }

  const protectedError = validateProtectedLeaveTypeUpdate(
    existing.code,
    protectedUpdate
  )
  if (protectedError) {
    return NextResponse.json({ error: protectedError }, { status: 422 })
  }

  // Check code uniqueness if code is being changed
  if (parsed.data.code && parsed.data.code !== existing.code) {
    const codeConflict = await prisma.leaveType.findUnique({ where: { code: parsed.data.code } })
    if (codeConflict) {
      return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
    }
  }

  if (parsed.data.parentId === id) {
    return NextResponse.json(
      { error: 'Typ urlopu nie może być typem nadrzędnym dla samego siebie.' },
      { status: 422 }
    )
  }

  const canonicalBehavior = isCanonicalLeaveTypeCode(existing.code)
    ? getProtectedBehavior(existing.code)
    : {}
  const updateData = {
    ...parsed.data,
    ...canonicalBehavior,
    ...(existing.code === 'VL' ? { parentId: null } : {}),
  }

  try {
    const leaveType = await runSerializableTransactionWithRetry(() =>
      prisma.$transaction(async (tx) => {
        let transactionParentId = parsed.data.parentId

        if (existing.code === 'VLD') {
          const transactionVl = await tx.leaveType.findUnique({
            where: { code: 'VL' },
            select: { id: true, parentId: true },
          })
          if (!transactionVl || transactionVl.parentId !== null) {
            throw new LeaveTypeMutationError(
              503,
              'Konfiguracja VLD jest nieprawidłowa: kanoniczny typ VL musi istnieć i być typem głównym.'
            )
          }
          transactionParentId = transactionVl.id
        }

        if (transactionParentId) {
          const subtypeCount = await tx.leaveType.count({
            where: { parentId: id },
          })
          if (subtypeCount > 0) {
            throw new LeaveTypeMutationError(
              422,
              'Typ urlopu mający podtypy nie może zostać przeniesiony pod inny typ.'
            )
          }
        }

        if (existing.code !== 'VLD' && transactionParentId) {
          const parent = await tx.leaveType.findUnique({
            where: { id: transactionParentId },
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

        return tx.leaveType.update({
          where: { id },
          data: {
            ...updateData,
            ...(existing.code === 'VLD'
              ? { parentId: transactionParentId }
              : {}),
          },
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

    return NextResponse.json(leaveType)
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

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const existing = await prisma.leaveType.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (isCanonicalLeaveTypeCode(existing.code)) {
    return NextResponse.json(
      { error: `Typ ${existing.code}: typ kanoniczny nie może zostać dezaktywowany.` },
      { status: 422 }
    )
  }

  // Check for pending leave requests
  const pendingRequests = await prisma.leaveRequestNew.count({
    where: {
      leaveTypeId: id,
      status: 'pending',
    },
  })

  if (pendingRequests > 0) {
    return NextResponse.json(
      { error: 'Cannot deactivate: there are pending leave requests for this type' },
      { status: 409 }
    )
  }

  await prisma.leaveType.update({
    where: { id },
    data: { isActive: false },
  })

  return NextResponse.json({ success: true })
}
