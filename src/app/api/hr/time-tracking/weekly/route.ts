import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadTimeTrackingRange } from '@/lib/hr/time-tracking/range-loader'

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

  const data = await loadTimeTrackingRange({
    session,
    start: weekStart,
    end: weekEnd,
    divisionId,
    departmentId,
  })

  return NextResponse.json({
    weekStart: data.startDate,
    weekEnd: data.endDate,
    days: data.days,
    employees: data.employees,
    dailyTotals: data.dailyTotals,
  })
}
