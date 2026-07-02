import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange } from '@/lib/hr/utils'
import { getScopedEmployeeWhere, HR_NO_EMPLOYEE_ACCESS_ID } from '@/lib/hr/access'

function scheduleMinutes(startTime: string, endTime: string, breakMinutes: number): number {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const total = (eh * 60 + em) - (sh * 60 + sm)
  return Math.max(0, total - breakMinutes)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const monthParam = searchParams.get('month')
  const divisionIdParam = searchParams.get('divisionId')

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

  const viewerEmployee =
    role === 'MANAGER' && session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
  const employeeWhere: Record<string, unknown> = {
    ...getScopedEmployeeWhere(session, viewerEmployee),
    active: true,
  }

  if (employeeWhere.id === HR_NO_EMPLOYEE_ACCESS_ID) return NextResponse.json([])
  if (divisionIdParam && role === 'ADMIN') employeeWhere.divisionId = divisionIdParam
  if (divisionIdParam && role === 'MANAGER' && viewerEmployee?.divisionId !== divisionIdParam) {
    return NextResponse.json([])
  }

  const employees = await prisma.employee.findMany({
    where: employeeWhere,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      workSchedules: {
        where: { date: { gte: start, lte: end } },
        select: { startTime: true, endTime: true, breakMinutes: true },
      },
      timeEntries: {
        where: { date: { gte: start, lte: end } },
        select: { totalMinutes: true, breakMinutes: true },
      },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })

  const result = employees.map((emp) => {
    const plannedMinutes = emp.workSchedules.reduce(
      (s, ws) => s + scheduleMinutes(ws.startTime, ws.endTime, ws.breakMinutes),
      0
    )
    const actualMinutes = emp.timeEntries.reduce(
      (s, e) => s + (e.totalMinutes ?? 0) - (e.breakMinutes ?? 0),
      0
    )
    const diffMinutes = actualMinutes - plannedMinutes
    const percentage = plannedMinutes > 0 ? Math.round((actualMinutes / plannedMinutes) * 100) : 0

    return {
      employee: { id: emp.id, firstName: emp.firstName, lastName: emp.lastName },
      plannedMinutes,
      actualMinutes,
      diffMinutes,
      percentage,
    }
  })

  return NextResponse.json(result)
}
