import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange } from '@/lib/hr/utils'
import { getPolishHolidays } from '@/lib/hr/constants'

const HOLIDAY_NAMES: Record<string, string> = {
  '01-01': 'Nowy Rok',
  '01-06': 'Trzech Króli',
  '05-01': 'Święto Pracy',
  '05-03': 'Konstytucja 3 Maja',
  '08-15': 'Wniebowzięcie NMP',
  '11-01': 'Wszystkich Świętych',
  '11-11': 'Święto Niepodległości',
  '12-25': 'Boże Narodzenie',
  '12-26': 'Drugi dzień BN',
}

function getHolidayName(dateStr: string): string {
  const mmdd = dateStr.slice(5)
  return HOLIDAY_NAMES[mmdd] ?? 'Święto'
}

function addEasterHolidays(year: number, holidays: string[]): Array<{ date: string; name: string }> {
  // Meeus/Jones/Butcher algorithm
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  const easter = new Date(year, month - 1, day)

  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const add = (d: Date, days: number) => {
    const r = new Date(d)
    r.setDate(r.getDate() + days)
    return r
  }

  const easterStr = fmt(easter)
  const easterMonStr = fmt(add(easter, 1))
  const corpusStr = fmt(add(easter, 60))

  const named: Array<{ date: string; name: string }> = []
  for (const h of holidays) {
    if (h === easterStr) named.push({ date: h, name: 'Wielkanoc' })
    else if (h === easterMonStr) named.push({ date: h, name: 'Poniedziałek Wielkanocny' })
    else if (h === corpusStr) named.push({ date: h, name: 'Boże Ciało' })
    else named.push({ date: h, name: getHolidayName(h) })
  }
  return named
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const monthParam = searchParams.get('month') // e.g. "2026-03"
  const divisionId = searchParams.get('divisionId')

  // Parse month
  const now = new Date()
  let year = now.getFullYear()
  let month = now.getMonth() + 1

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    year = parseInt(monthParam.slice(0, 4), 10)
    month = parseInt(monthParam.slice(5, 7), 10)
  }

  const { start, end } = getMonthRange(year, month)
  const daysInMonth = new Date(year, month, 0).getDate()

  // Build employee filter
  const employeeWhere: Record<string, unknown> = { active: true }
  if (divisionId) employeeWhere.divisionId = divisionId

  // Fetch active employees and their overlapping leave requests in one go
  const employees = await prisma.employee.findMany({
    where: employeeWhere,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      divisionId: true,
      leaveRequestsNew: {
        where: {
          status: { in: ['approved', 'pending'] },
          startDate: { lte: end },
          endDate: { gte: start },
        },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          days: true,
          status: true,
          isRemoteWork: true,
          isDelegation: true,
          note: true,
          approverId: true,
          leaveType: {
            select: { id: true, name: true, code: true, color: true },
          },
        },
      },
    },
  })

  // Polish public holidays for the month
  const polishHolidayStrings = getPolishHolidays(year)
  const namedHolidays = addEasterHolidays(year, polishHolidayStrings)
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthPrefix = `${year}-${pad(month)}-`
  const holidaysInMonth = namedHolidays.filter((h) => h.date.startsWith(monthPrefix))

  // Fetch custom holidays for this month
  const customHolidays = await prisma.customHoliday.findMany({
    where: {
      date: { gte: start, lte: end },
      ...(divisionId ? { OR: [{ divisionId }, { divisionId: null }] } : {}),
    },
    select: { date: true, name: true },
  })

  const allHolidays = [
    ...holidaysInMonth,
    ...customHolidays.map((ch) => ({
      date: `${ch.date.getFullYear()}-${pad(ch.date.getMonth() + 1)}-${pad(ch.date.getDate())}`,
      name: ch.name,
    })),
  ]

  // Serialize dates in leave requests
  const serializedEmployees = employees.map((emp) => ({
    id: emp.id,
    firstName: emp.firstName,
    lastName: emp.lastName,
    divisionId: emp.divisionId,
    leaves: emp.leaveRequestsNew.map((lr) => ({
      id: lr.id,
      startDate: lr.startDate.toISOString().slice(0, 10),
      endDate: lr.endDate.toISOString().slice(0, 10),
      days: lr.days,
      status: lr.status,
      isRemoteWork: lr.isRemoteWork,
      isDelegation: lr.isDelegation,
      leaveType: lr.leaveType,
    })),
  }))

  return NextResponse.json({
    employees: serializedEmployees,
    holidays: allHolidays,
    month: `${year}-${pad(month)}`,
    daysInMonth,
  })
}
