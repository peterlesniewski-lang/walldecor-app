import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange } from '@/lib/hr/utils'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const employeeIdParam = searchParams.get('employeeId')
  const monthParam = searchParams.get('month') // "YYYY-MM"

  const role = session.user.role
  const isAdminOrManager = role === 'ADMIN' || role === 'MANAGER'

  // Auth: EMPLOYEE can only see their own data
  let employeeId: string | undefined
  if (!isAdminOrManager) {
    if (!session.user.employeeId) {
      return NextResponse.json({ error: 'No employee profile' }, { status: 403 })
    }
    employeeId = session.user.employeeId
  } else {
    if (!employeeIdParam) {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
    }
    employeeId = employeeIdParam
  }

  if (!monthParam) {
    return NextResponse.json({ error: 'month is required (YYYY-MM)' }, { status: 400 })
  }

  const [yearStr, monthStr] = monthParam.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  if (isNaN(year) || isNaN(month)) {
    return NextResponse.json({ error: 'Invalid month format' }, { status: 400 })
  }

  const { start, end } = getMonthRange(year, month)

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  const rawEntries = await prisma.timeEntry.findMany({
    where: {
      employeeId,
      date: { gte: start, lte: end },
    },
    include: {
      breaks: true,
      project: { select: { id: true, name: true } },
    },
    orderBy: { date: 'asc' },
  })

  const entries = rawEntries.map((e) => {
    const totalMinutes = e.totalMinutes ?? 0
    const breakMinutes = e.breakMinutes ?? 0
    const netMinutes = totalMinutes - breakMinutes
    return {
      date: e.date.toISOString().split('T')[0],
      clockIn: e.clockIn?.toISOString() ?? null,
      clockOut: e.clockOut?.toISOString() ?? null,
      totalMinutes,
      breakMinutes,
      netMinutes,
      overtimeMinutes: e.overtimeMinutes ?? 0,
      status: e.status,
      projectName: e.project?.name ?? null,
      notes: e.notes ?? null,
      breaks: e.breaks.map((b) => ({
        startTime: b.startTime.toISOString(),
        endTime: b.endTime?.toISOString() ?? null,
        type: b.type,
      })),
    }
  })

  const summary = {
    totalDays: entries.length,
    totalMinutes: entries.reduce((s, e) => s + e.totalMinutes, 0),
    breakMinutes: entries.reduce((s, e) => s + e.breakMinutes, 0),
    netMinutes: entries.reduce((s, e) => s + e.netMinutes, 0),
    overtimeMinutes: entries.reduce((s, e) => s + e.overtimeMinutes, 0),
  }

  return NextResponse.json({ employee, month: monthParam, entries, summary })
}
