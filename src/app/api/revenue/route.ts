import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { RevenueEntrySchema, RevenueQuerySchema } from '@/lib/validations/revenue'

const CAN_EDIT = ['ADMIN', 'MANAGER']

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const parsed = RevenueQuerySchema.safeParse({
    year: searchParams.get('year'),
    costCenterId: searchParams.get('costCenterId'),
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const { year, costCenterId } = parsed.data
  const entries = await prisma.revenue.findMany({ where: { year, costCenterId } })
  return NextResponse.json(entries)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_EDIT.includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = RevenueEntrySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid data', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const entry = await prisma.revenue.upsert({
    where: {
      year_month_costCenterId_channel: {
        year: data.year,
        month: data.month,
        costCenterId: data.costCenterId,
        channel: data.channel,
      },
    },
    update: { amount: Math.round(data.amount * 100) / 100 },
    create: {
      year: data.year,
      month: data.month,
      costCenterId: data.costCenterId,
      channel: data.channel,
      amount: Math.round(data.amount * 100) / 100,
    },
  })

  return NextResponse.json(entry)
}
