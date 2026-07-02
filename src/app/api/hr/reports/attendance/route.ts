import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange } from '@/lib/hr/utils'
import { getScopedEmployeeWhere, HR_NO_EMPLOYEE_ACCESS_ID } from '@/lib/hr/access'

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

  if (employeeWhere.id === HR_NO_EMPLOYEE_ACCESS_ID) {
    return NextResponse.json({ month: monthParam, employees: [] })
  }
  if (divisionIdParam && role === 'ADMIN') employeeWhere.divisionId = divisionIdParam
  if (divisionIdParam && role === 'MANAGER' && viewerEmployee?.divisionId !== divisionIdParam) {
    return NextResponse.json({ month: monthParam, employees: [] })
  }

  const employees = await prisma.employee.findMany({
    where: employeeWhere,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      division: { select: { name: true } },
      timeEntries: {
        where: { date: { gte: start, lte: end } },
        select: {
          totalMinutes: true,
          breakMinutes: true,
          overtimeMinutes: true,
        },
      },
      leaveRequestsNew: {
        where: {
          status: 'approved',
          startDate: { lte: end },
          endDate: { gte: start },
        },
        select: { days: true },
      },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })

  const result = employees.map((emp) => {
    const presentDays = emp.timeEntries.length
    const totalMinutes = emp.timeEntries.reduce((s, e) => s + (e.totalMinutes ?? 0), 0)
    const breakMinutes = emp.timeEntries.reduce((s, e) => s + (e.breakMinutes ?? 0), 0)
    const netMinutes = totalMinutes - breakMinutes
    const overtimeMinutes = emp.timeEntries.reduce((s, e) => s + (e.overtimeMinutes ?? 0), 0)
    const absenceDays = emp.leaveRequestsNew.reduce((s, lr) => s + lr.days, 0)

    return {
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      divisionName: emp.division?.name ?? null,
      presentDays,
      totalMinutes,
      netMinutes,
      overtimeMinutes,
      absenceDays,
    }
  })

  return NextResponse.json({ month: monthParam, employees: result })
}
