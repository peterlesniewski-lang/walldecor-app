import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const existing = await prisma.billingPeriod.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'open') {
    return NextResponse.json({ error: 'Only open periods can be edited' }, { status: 409 })
  }

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data

  // Validate date range if both provided
  const startDate = data.startDate ?? existing.startDate
  const endDate = data.endDate ?? existing.endDate
  if (endDate <= startDate) {
    return NextResponse.json({ error: 'endDate must be after startDate' }, { status: 400 })
  }

  const period = await prisma.billingPeriod.update({
    where: { id },
    data,
  })

  return NextResponse.json(period)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const existing = await prisma.billingPeriod.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'open') {
    return NextResponse.json({ error: 'Only open periods can be deleted' }, { status: 409 })
  }

  await prisma.billingPeriod.delete({ where: { id } })

  return NextResponse.json({ success: true })
}
