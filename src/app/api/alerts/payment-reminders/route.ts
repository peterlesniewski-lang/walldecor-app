import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { paymentReminderSchema } from '@/lib/validations/alerts'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const reminders = await prisma.paymentReminder.findMany({
    include: {
      costCenter: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(reminders)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = paymentReminderSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { name, amount, dayOfMonth, costCenterId, alertDaysInAdvance, active } =
    parsed.data

  const reminder = await prisma.paymentReminder.create({
    data: {
      name,
      amount,
      dayOfMonth,
      costCenterId,
      alertDaysInAdvance: alertDaysInAdvance ?? 3,
      active: active ?? true,
    },
    include: {
      costCenter: true,
    },
  })

  return NextResponse.json(reminder, { status: 201 })
}
