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
      timeEntries: {
        where: { date: { gte: start, lte: end } },
        select: { overtimeMinutes: true },
      },
      overtimeRequests: {
        where: { date: { gte: start, lte: end } },
        select: { status: true, resolution: true, minutes: true },
      },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })

  const result = employees.map((emp) => {
    const totalOvertimeMinutes = emp.timeEntries.reduce((s, e) => s + (e.overtimeMinutes ?? 0), 0)
    const approvedRequests = emp.overtimeRequests.filter((r) => r.status === 'approved').length
    const pendingRequests = emp.overtimeRequests.filter((r) => r.status === 'pending').length
    const timeOffMinutes = emp.overtimeRequests
      .filter((r) => r.status === 'approved' && r.resolution === 'time_off')
      .reduce((s, r) => s + r.minutes, 0)
    const paymentMinutes = emp.overtimeRequests
      .filter((r) => r.status === 'approved' && r.resolution === 'payment')
      .reduce((s, r) => s + r.minutes, 0)

    return {
      employee: { id: emp.id, firstName: emp.firstName, lastName: emp.lastName },
      totalOvertimeMinutes,
      approvedRequests,
      pendingRequests,
      timeOffMinutes,
      paymentMinutes,
    }
  })

  return NextResponse.json(result)
}
