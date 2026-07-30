import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getWarsawBusinessDate,
  getWarsawBusinessDateQueryRange,
  toWarsawBusinessDateUtcMidnight,
} from '@/lib/hr/business-date'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const employee = await prisma.employee.findFirst({
    where: { userId: session.user.id },
  })
  if (!employee) {
    return NextResponse.json({ error: 'No employee record for this user' }, { status: 404 })
  }

  // Check for open entry
  const openEntry = await prisma.timeEntry.findFirst({
    where: { employeeId: employee.id, clockOut: null },
  })
  if (openEntry) {
    return NextResponse.json({ error: 'Already clocked in' }, { status: 409 })
  }

  const body = await req.json().catch(() => ({})) as { projectId?: string; notes?: string }

  const now = new Date()
  const businessDate = getWarsawBusinessDate(now)
  const today = toWarsawBusinessDateUtcMidnight(now)

  const existingCandidates = await prisma.timeEntry.findMany({
    where: {
      employeeId: employee.id,
      date: getWarsawBusinessDateQueryRange(now),
    },
    select: { id: true, date: true },
  })
  if (existingCandidates.some((entry) =>
    getWarsawBusinessDate(entry.date).isoDate === businessDate.isoDate
  )) {
    return NextResponse.json({ error: 'Entry already exists for today' }, { status: 409 })
  }

  const entry = await prisma.timeEntry.create({
    data: {
      employeeId: employee.id,
      date: today,
      clockIn: now,
      source: 'clock',
      projectId: body.projectId ?? null,
      notes: body.notes ?? null,
    },
    include: {
      breaks: true,
    },
  })

  return NextResponse.json({ entry }, { status: 201 })
}
