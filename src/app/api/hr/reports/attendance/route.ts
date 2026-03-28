import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange } from '@/lib/hr/utils'

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

  const employeeWhere: Record<string, unknown> = { active: true }
  if (divisionIdParam) employeeWhere.divisionId = divisionIdParam

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
