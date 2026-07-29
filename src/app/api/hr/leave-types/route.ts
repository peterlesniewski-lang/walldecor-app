import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  validateProtectedLeaveTypeUpdate,
  type ProtectedLeaveTypeUpdate,
} from '@/lib/hr/leave-type-catalog'
import { z } from 'zod'

const leaveTypeCreateSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20).toUpperCase(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3B82F6'),
  isPaid: z.boolean().default(true),
  requiresApproval: z.boolean().default(true),
  tracksBalance: z.boolean().default(true),
  maxDaysPerYear: z.number().int().min(1).optional(),
  parentId: z.string().nullable().optional(),
})

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

  const protectedUpdate: ProtectedLeaveTypeUpdate = {
    isPaid: parsed.data.isPaid,
    requiresApproval: parsed.data.requiresApproval,
    tracksBalance: parsed.data.tracksBalance,
    maxDaysPerYear: parsed.data.maxDaysPerYear ?? null,
  }
  if (parsed.data.code === 'VLD') {
    protectedUpdate.parentCode =
      parsed.data.parentId === undefined || parsed.data.parentId === canonicalVl?.id
        ? 'VL'
        : null
  }

  const protectedError = validateProtectedLeaveTypeUpdate(
    parsed.data.code,
    protectedUpdate
  )
  if (protectedError) {
    return NextResponse.json({ error: protectedError }, { status: 422 })
  }

  if (parsed.data.code !== 'VLD' && parsed.data.parentId) {
    const parent = await prisma.leaveType.findUnique({
      where: { id: parsed.data.parentId },
    })
    if (!parent) {
      return NextResponse.json({ error: 'Parent leave type not found' }, { status: 404 })
    }
  }

  const createData = parsed.data.code === 'VLD'
    ? { ...parsed.data, parentId: canonicalVl!.id }
    : parsed.data

  const leaveType = await prisma.leaveType.create({
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

  return NextResponse.json(leaveType, { status: 201 })
}
