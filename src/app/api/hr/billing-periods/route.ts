import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const createSchema = z.object({
  name: z.string().min(1).max(100),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).refine(d => d.endDate > d.startDate, {
  message: 'endDate must be after startDate',
  path: ['endDate'],
})

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const periods = await prisma.billingPeriod.findMany({
    orderBy: { startDate: 'desc' },
  })

  return NextResponse.json(periods)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { name, startDate, endDate } = parsed.data

  // Check for overlapping periods
  const overlapping = await prisma.billingPeriod.findFirst({
    where: {
      OR: [
        { startDate: { lte: endDate }, endDate: { gte: startDate } },
      ],
    },
  })

  if (overlapping) {
    return NextResponse.json(
      { error: 'Period overlaps with an existing billing period' },
      { status: 409 }
    )
  }

  const period = await prisma.billingPeriod.create({
    data: { name, startDate, endDate, status: 'open' },
  })

  return NextResponse.json(period, { status: 201 })
}
