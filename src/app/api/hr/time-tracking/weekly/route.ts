import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getScopedEmployeeWhere, HR_NO_EMPLOYEE_ACCESS_ID } from '@/lib/hr/access'

/** Parses "YYYY-Www" (e.g. "2026-W13") into Monday of that ISO week */
function parseIsoWeek(week: string): Date | null {
  const match = week.match(/^(\d{4})-W(\d{2})$/)
  if (!match) return null
  const year = parseInt(match[1], 10)
  const weekNum = parseInt(match[2], 10)
  // ISO week 1 is the week containing the first Thursday
  // Jan 4 is always in week 1
  const jan4 = new Date(year, 0, 4)
  const jan4Dow = jan4.getDay() === 0 ? 7 : jan4.getDay()
  // Monday of week 1
  const week1Mon = new Date(jan4)
  week1Mon.setDate(jan4.getDate() - jan4Dow + 1)
  // Monday of target week
  const targetMon = new Date(week1Mon)
  targetMon.setDate(week1Mon.getDate() + (weekNum - 1) * 7)
  targetMon.setHours(0, 0, 0, 0)
  return targetMon
}

const pad = (n: number) => String(n).padStart(2, '0')
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const weekParam = searchParams.get('week')
  const divisionId = searchParams.get('divisionId') || undefined
  const departmentId = searchParams.get('departmentId') || undefined
  const role = session.user.role

  // Determine week range
  let weekStart: Date
  if (weekParam) {
    const parsed = parseIsoWeek(weekParam)
    if (!parsed) return NextResponse.json({ error: 'Invalid week format. Use YYYY-Www' }, { status: 400 })
    weekStart = parsed
  } else {
    // Default: current week
    const now = new Date()
    const dow = now.getDay() === 0 ? 7 : now.getDay()
    weekStart = new Date(now)
    weekStart.setDate(now.getDate() - dow + 1)
    weekStart.setHours(0, 0, 0, 0)
  }

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)

  // Build 7 days array
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    days.push(toDateStr(d))
  }

  const viewerEmployee =
    role === 'MANAGER' && session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null

  // Fetch active employees with role scope and optional filters.
  const employeeWhere: Record<string, unknown> = {
    active: true,
    ...getScopedEmployeeWhere(session, viewerEmployee),
  }

  if (employeeWhere.id === HR_NO_EMPLOYEE_ACCESS_ID) {
    const dailyTotals = Object.fromEntries(days.map((day) => [day, 0]))
    return NextResponse.json({
      weekStart: toDateStr(weekStart),
      weekEnd: toDateStr(weekEnd),
      days,
      employees: [],
      dailyTotals,
    })
  }

  if (divisionId) {
    if (role === 'MANAGER' && viewerEmployee?.divisionId !== divisionId) {
      const dailyTotals = Object.fromEntries(days.map((day) => [day, 0]))
      return NextResponse.json({
        weekStart: toDateStr(weekStart),
        weekEnd: toDateStr(weekEnd),
        days,
        employees: [],
        dailyTotals,
      })
    }
    employeeWhere.divisionId = divisionId
  }
  if (departmentId) employeeWhere.departmentId = departmentId

  const employees = await prisma.employee.findMany({
    where: employeeWhere,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    include: {
      division: true,
      department: true,
    },
  })

  const employeeIds = employees.map((e) => e.id)

  // Fetch time entries for the week
  const timeEntries = await prisma.timeEntry.findMany({
    where: {
      employeeId: { in: employeeIds },
      date: { gte: weekStart, lte: weekEnd },
    },
  })

  // Fetch leave requests for the week (approved)
  const leaveRequests = await prisma.leaveRequestNew.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: 'approved',
      startDate: { lte: weekEnd },
      endDate: { gte: weekStart },
    },
    include: { leaveType: true },
  })

  // Build entry map: employeeId -> date -> entry
  type DayEntry = {
    id?: string
    clockIn?: string
    clockOut?: string | null
    totalMinutes?: number | null
    status?: string
    leaveType?: string
    leaveColor?: string
  }

  const entryMap = new Map<string, Record<string, DayEntry>>()
  for (const emp of employees) {
    entryMap.set(emp.id, {})
  }

  for (const entry of timeEntries) {
    const dateStr = toDateStr(new Date(entry.date))
    const empEntries = entryMap.get(entry.employeeId)
    if (!empEntries) continue
    empEntries[dateStr] = {
      id: entry.id,
      clockIn: entry.clockIn.toISOString(),
      clockOut: entry.clockOut?.toISOString() ?? null,
      totalMinutes: entry.totalMinutes,
      status: entry.status,
    }
  }

  // Overlay leave requests
  for (const leave of leaveRequests) {
    const empEntries = entryMap.get(leave.employeeId)
    if (!empEntries) continue
    // Mark each day of the leave
    const cur = new Date(leave.startDate)
    cur.setHours(0, 0, 0, 0)
    const end = new Date(leave.endDate)
    end.setHours(23, 59, 59, 999)
    while (cur <= end) {
      const dateStr = toDateStr(cur)
      if (days.includes(dateStr)) {
        // Only add leave marker if no time entry already exists for that day
        if (!empEntries[dateStr]) {
          empEntries[dateStr] = {
            leaveType: leave.leaveType.name,
            leaveColor: leave.leaveType.color,
            status: 'leave',
          }
        } else {
          // Augment existing entry with leave info
          empEntries[dateStr].leaveType = leave.leaveType.name
          empEntries[dateStr].leaveColor = leave.leaveType.color
        }
      }
      cur.setDate(cur.getDate() + 1)
    }
  }

  // Compute daily totals
  const dailyTotals: Record<string, number> = {}
  for (const day of days) {
    let total = 0
    for (const emp of employees) {
      const entry = entryMap.get(emp.id)?.[day]
      if (entry?.totalMinutes) total += entry.totalMinutes
    }
    dailyTotals[day] = total
  }

  // Build response
  const result = {
    weekStart: toDateStr(weekStart),
    weekEnd: toDateStr(weekEnd),
    days,
    employees: employees.map((emp) => ({
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      divisionId: emp.divisionId,
      divisionName: emp.division?.name ?? null,
      avatarUrl: emp.avatarUrl,
      entries: entryMap.get(emp.id) ?? {},
    })),
    dailyTotals,
  }

  return NextResponse.json(result)
}
