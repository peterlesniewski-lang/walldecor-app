import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(
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
    return NextResponse.json({ error: 'Period is already closed or locked' }, { status: 409 })
  }

  const period = await prisma.billingPeriod.update({
    where: { id },
    data: {
      status: 'closed',
      closedAt: new Date(),
      closedById: session.user.id,
    },
  })

  return NextResponse.json(period)
}
