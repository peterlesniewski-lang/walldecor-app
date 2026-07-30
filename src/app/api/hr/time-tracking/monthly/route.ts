import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { currentMonthParam, parseMonthParam } from '@/lib/hr/time-tracking/month'
import { loadTimeTrackingRange } from '@/lib/hr/time-tracking/range-loader'
import { getMonthRange } from '@/lib/hr/utils'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month') ?? currentMonthParam()
  const parsedMonth = parseMonthParam(month)
  if (!parsedMonth) {
    return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM' }, { status: 400 })
  }

  const divisionId = searchParams.get('divisionId') || undefined
  const departmentId = searchParams.get('departmentId') || undefined
  const employeeId = searchParams.get('employeeId') || undefined
  const { start, end } = getMonthRange(parsedMonth.year, parsedMonth.month)

  const data = await loadTimeTrackingRange({
    session,
    start,
    end,
    divisionId,
    departmentId,
    employeeId,
  })

  return NextResponse.json({
    month,
    monthStart: data.startDate,
    monthEnd: data.endDate,
    days: data.days,
    employees: data.employees,
    dailyTotals: data.dailyTotals,
    holidays: data.holidays,
    saturdayWorkable: data.saturdayWorkable,
    standardClockIn: data.standardClockIn,
    standardClockOut: data.standardClockOut,
  })
}
