import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const leaveTypeCreateSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20).toUpperCase(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3B82F6'),
  isPaid: z.boolean().default(true),
  requiresApproval: z.boolean().default(true),
  maxDaysPerYear: z.number().int().min(1).optional(),
  parentId: z.string().optional(),
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

  const parsed = leaveTypeCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  // Check code uniqueness
  const existing = await prisma.leaveType.findUnique({ where: { code: parsed.data.code } })
  if (existing) {
    return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
  }

  // Validate parentId if provided
  if (parsed.data.parentId) {
    const parent = await prisma.leaveType.findUnique({ where: { id: parsed.data.parentId } })
    if (!parent) {
      return NextResponse.json({ error: 'Parent leave type not found' }, { status: 404 })
    }
  }

  const leaveType = await prisma.leaveType.create({
    data: parsed.data,
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
