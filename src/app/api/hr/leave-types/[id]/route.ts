import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  PROTECTED_LEAVE_TYPE_RULES,
  validateProtectedLeaveTypeUpdate,
  type ProtectedLeaveTypeUpdate,
} from '@/lib/hr/leave-type-catalog'
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
  isActive: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string }> }

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

  const parsed = leaveTypeUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const existing = await prisma.leaveType.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

  const isProtected = Object.prototype.hasOwnProperty.call(
    PROTECTED_LEAVE_TYPE_RULES,
    existing.code
  )
  if (isProtected && parsed.data.code && parsed.data.code !== existing.code) {
    return NextResponse.json(
      { error: `Typ ${existing.code}: chroniony kod nie może zostać zmieniony.` },
      { status: 422 }
    )
  }

  const protectedUpdate: ProtectedLeaveTypeUpdate = {}
  if (parsed.data.isPaid !== undefined) {
    protectedUpdate.isPaid = parsed.data.isPaid
  }
  if (parsed.data.requiresApproval !== undefined) {
    protectedUpdate.requiresApproval = parsed.data.requiresApproval
  }
  if (parsed.data.tracksBalance !== undefined) {
    protectedUpdate.tracksBalance = parsed.data.tracksBalance
  }
  if (Object.prototype.hasOwnProperty.call(parsed.data, 'maxDaysPerYear')) {
    protectedUpdate.maxDaysPerYear = parsed.data.maxDaysPerYear
  }
  if (
    existing.code === 'VLD' &&
    Object.prototype.hasOwnProperty.call(parsed.data, 'parentId')
  ) {
    protectedUpdate.parentCode =
      parsed.data.parentId === canonicalVl?.id ? 'VL' : null
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

  if (existing.code !== 'VLD' && parsed.data.parentId) {
    const parent = await prisma.leaveType.findUnique({
      where: { id: parsed.data.parentId },
    })
    if (!parent) {
      return NextResponse.json({ error: 'Parent leave type not found' }, { status: 404 })
    }
  }

  const updateData = existing.code === 'VLD'
    ? { ...parsed.data, parentId: canonicalVl!.id }
    : parsed.data

  const leaveType = await prisma.leaveType.update({
    where: { id },
    data: updateData,
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

  return NextResponse.json(leaveType)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const existing = await prisma.leaveType.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
