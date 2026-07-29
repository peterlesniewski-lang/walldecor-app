import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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

  const parsed = leaveTypeUpdateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const existing = await prisma.leaveType.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Check code uniqueness if code is being changed
  if (parsed.data.code && parsed.data.code !== existing.code) {
    const codeConflict = await prisma.leaveType.findUnique({ where: { code: parsed.data.code } })
    if (codeConflict) {
      return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
    }
  }

  const leaveType = await prisma.leaveType.update({
    where: { id },
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
