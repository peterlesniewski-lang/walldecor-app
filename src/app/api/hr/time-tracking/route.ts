import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { timeEntryCreateSchema } from '@/lib/hr/schemas'
import { canViewEmployeeRecord } from '@/lib/hr/access'
import {
  getWarsawBusinessDate,
  getWarsawBusinessDateQueryRange,
  toWarsawBusinessDateUtcMidnight,
} from '@/lib/hr/business-date'

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
  const role = session.user.role

  if (role === 'MANAGER') {
    const [viewerEmployee, targetEmployee] = await Promise.all([
      session.user.employeeId
        ? prisma.employee.findUnique({
            where: { id: session.user.employeeId },
            select: { id: true, divisionId: true, active: true },
          })
        : Promise.resolve(null),
      prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, divisionId: true, active: true },
      }),
    ])

    if (!targetEmployee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (!canViewEmployeeRecord(session, targetEmployee, viewerEmployee)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const businessDate = getWarsawBusinessDate(date)
  const canonicalDate = toWarsawBusinessDateUtcMidnight(date)
  const existingCandidates = await prisma.timeEntry.findMany({
    where: {
      employeeId,
      date: getWarsawBusinessDateQueryRange(date),
    },
    select: { id: true, date: true },
  })
  if (existingCandidates.some((entry) =>
    getWarsawBusinessDate(entry.date).isoDate === businessDate.isoDate
  )) {
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
      date: canonicalDate,
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
