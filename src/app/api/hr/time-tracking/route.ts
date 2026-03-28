import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { timeEntryCreateSchema } from '@/lib/hr/schemas'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = timeEntryCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { employeeId, date, clockIn, clockOut, projectId, taskName, source, notes } = parsed.data

  // Check for existing entry on this date
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)

  const existing = await prisma.timeEntry.findFirst({
    where: { employeeId, date: dayStart },
  })
  if (existing) {
    return NextResponse.json({ error: 'Entry already exists for this employee on this date' }, { status: 409 })
  }

  let totalMinutes: number | null = null
  if (clockOut) {
    totalMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)
    if (totalMinutes < 0) totalMinutes = null
  }

  const entry = await prisma.timeEntry.create({
    data: {
      employeeId,
      date: dayStart,
      clockIn,
      clockOut: clockOut ?? null,
      totalMinutes,
      projectId: projectId ?? null,
      taskName: taskName ?? null,
      source: source ?? 'manual',
      notes: notes ?? null,
      status: 'pending',
    },
    include: {
      breaks: true,
    },
  })

  return NextResponse.json(entry, { status: 201 })
}
