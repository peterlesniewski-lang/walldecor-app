import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { timeEntryBulkCreateSchema } from '@/lib/hr/schemas'

// tzOffsetMinutes = (UTC - local) in minutes, e.g. -120 for UTC+2
// UTC = local + tzOffset  →  utcHours = localHours + tzOffsetMinutes/60
function parseTimeToDate(dateBase: Date, timeStr: string, tzOffsetMinutes = 0): Date {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const d = new Date(dateBase)
  d.setUTCHours(hours + tzOffsetMinutes / 60, minutes, 0, 0)
  return d
}

function isWeekend(d: Date): boolean {
  const dow = d.getDay()
  return dow === 0 || dow === 6
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = timeEntryBulkCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { employeeIds, startDate, endDate, clockIn: clockInStr, clockOut: clockOutStr, skipWeekends, projectId, tzOffsetMinutes } = parsed.data

  // Validate employees exist
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true },
  })
  if (employees.length !== employeeIds.length) {
    return NextResponse.json({ error: 'One or more employees not found' }, { status: 404 })
  }

  const created: string[] = []
  const skipped: string[] = []

  // Iterate each day in range
  const cur = new Date(startDate)
  cur.setHours(0, 0, 0, 0)
  const end = new Date(endDate)
  end.setHours(23, 59, 59, 999)

  while (cur <= end) {
    if (skipWeekends && isWeekend(cur)) {
      cur.setDate(cur.getDate() + 1)
      continue
    }

    const dayDate = new Date(cur)
    dayDate.setHours(0, 0, 0, 0)

    const clockInDt = parseTimeToDate(cur, clockInStr, tzOffsetMinutes)
    const clockOutDt = parseTimeToDate(cur, clockOutStr, tzOffsetMinutes)

    let totalMinutes = Math.round((clockOutDt.getTime() - clockInDt.getTime()) / 60000)
    if (totalMinutes < 0) totalMinutes = 0

    for (const employeeId of employeeIds) {
      // Check for existing entry (@@unique [employeeId, date])
      const existing = await prisma.timeEntry.findFirst({
        where: { employeeId, date: dayDate },
      })

      if (existing) {
        skipped.push(`${employeeId}:${dayDate.toISOString().slice(0, 10)}`)
        continue
      }

      try {
        const entry = await prisma.timeEntry.create({
          data: {
            employeeId,
            date: dayDate,
            clockIn: clockInDt,
            clockOut: clockOutDt,
            totalMinutes,
            source: 'bulk',
            projectId: projectId ?? null,
            status: 'pending',
          },
        })
        created.push(entry.id)
      } catch {
        // Unique constraint violation — skip
        skipped.push(`${employeeId}:${dayDate.toISOString().slice(0, 10)}`)
      }
    }

    cur.setDate(cur.getDate() + 1)
  }

  return NextResponse.json({ created: created.length, skipped: skipped.length }, { status: 201 })
}
