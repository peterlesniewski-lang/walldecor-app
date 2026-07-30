import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getWarsawBusinessDate } from '@/lib/hr/business-date'
import { parseMonthParam } from '@/lib/hr/time-tracking/month'
import { loadTimeTrackingRange } from '@/lib/hr/time-tracking/range-loader'

function getPlainCalendarMonthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(0)
  start.setFullYear(year, month - 1, 1)
  start.setHours(0, 0, 0, 0)

  const end = new Date(0)
  end.setFullYear(year, month, 0)
  end.setHours(23, 59, 59, 999)

  return { start, end }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month') ?? getWarsawBusinessDate().isoDate.slice(0, 7)
  const parsedMonth = parseMonthParam(month)
  if (!parsedMonth) {
    return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM' }, { status: 400 })
  }
  if (parsedMonth.year < 100) {
    return NextResponse.json({ error: 'Month year must be 0100 or later' }, { status: 400 })
  }

  const divisionId = searchParams.get('divisionId') || undefined
  const departmentId = searchParams.get('departmentId') || undefined
  const employeeId = searchParams.get('employeeId') || undefined
  const { start, end } = getPlainCalendarMonthRange(parsedMonth.year, parsedMonth.month)

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
