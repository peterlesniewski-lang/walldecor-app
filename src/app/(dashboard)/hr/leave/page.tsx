import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange } from '@/lib/hr/utils'
import { getPolishHolidays } from '@/lib/hr/constants'
import { AbsenceCalendar } from '@/components/hr/leave/absence-calendar'

function pad(n: number) {
  return String(n).padStart(2, '0')
}

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

function getEasterDate(year: number): Date {
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
  return new Date(year, month - 1, day)
}

function addDays(date: Date, days: number): Date {
  const r = new Date(date)
  r.setDate(r.getDate() + days)
  return r
}

function buildNamedHolidays(year: number): Array<{ date: string; name: string }> {
  const holidays = getPolishHolidays(year)
  const easter = getEasterDate(year)
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const easterStr = fmt(easter)
  const easterMonStr = fmt(addDays(easter, 1))
  const corpusStr = fmt(addDays(easter, 60))

  return holidays.map((h) => {
    if (h === easterStr) return { date: h, name: 'Wielkanoc' }
    if (h === easterMonStr) return { date: h, name: 'Poniedziałek Wielkanocny' }
    if (h === corpusStr) return { date: h, name: 'Boże Ciało' }
    return { date: h, name: HOLIDAY_NAMES[h.slice(5)] ?? 'Święto' }
  })
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LeavePage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const params = await searchParams
  const monthParam = typeof params.month === 'string' ? params.month : null

  const now = new Date()
  let year = now.getFullYear()
  let month = now.getMonth() + 1

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    year = parseInt(monthParam.slice(0, 4), 10)
    month = parseInt(monthParam.slice(5, 7), 10)
  }

  const currentMonth = `${year}-${pad(month)}`
  const { start, end } = getMonthRange(year, month)
  const daysInMonth = new Date(year, month, 0).getDate()

  // Fetch employees with their leaves for the month
  const employees = await prisma.employee.findMany({
    where: { active: true },
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
          leaveType: {
            select: { id: true, name: true, code: true, color: true },
          },
        },
      },
    },
  })

  // Build holidays list for the month
  const monthPrefix = `${year}-${pad(month)}-`
  const namedHolidays = buildNamedHolidays(year)
  const holidaysInMonth = namedHolidays.filter((h) => h.date.startsWith(monthPrefix))

  const customHolidays = await prisma.customHoliday.findMany({
    where: { date: { gte: start, lte: end } },
    select: { date: true, name: true },
  })

  const allHolidays = [
    ...holidaysInMonth,
    ...customHolidays.map((ch) => ({
      date: `${ch.date.getFullYear()}-${pad(ch.date.getMonth() + 1)}-${pad(ch.date.getDate())}`,
      name: ch.name,
    })),
  ]

  // Serialize employees
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
      status: lr.status as 'approved' | 'pending',
      isRemoteWork: lr.isRemoteWork,
      isDelegation: lr.isDelegation,
      leaveType: lr.leaveType,
    })),
  }))

  // Summary for today
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const dayStart = new Date(today)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(today)
  dayEnd.setHours(23, 59, 59, 999)
  const nextWeekStart = new Date(dayStart)
  nextWeekStart.setDate(nextWeekStart.getDate() + 1)
  const nextWeekEnd = new Date(dayStart)
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 7)
  nextWeekEnd.setHours(23, 59, 59, 999)

  const totalEmployees = await prisma.employee.count({ where: { active: true } })
  const approvedToday = await prisma.leaveRequestNew.findMany({
    where: {
      status: 'approved',
      startDate: { lte: dayEnd },
      endDate: { gte: dayStart },
    },
    select: { isRemoteWork: true },
  })
  const remote = approvedToday.filter((l) => l.isRemoteWork).length
  const absent = approvedToday.filter((l) => !l.isRemoteWork).length
  const present = Math.max(0, totalEmployees - absent)
  const plannedNext = await prisma.leaveRequestNew.count({
    where: {
      status: 'approved',
      startDate: { gte: nextWeekStart, lte: nextWeekEnd },
    },
  })

  const initialSummary = {
    present,
    remote,
    absent,
    plannedNext,
    total: totalEmployees,
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--wd-dark)' }}>
          Urlopy
        </h1>
        <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
          Kalendarz nieobecności — widok miesięczny
        </p>
      </div>

      <AbsenceCalendar
        initialData={{
          employees: serializedEmployees,
          holidays: allHolidays,
          month: currentMonth,
          daysInMonth,
        }}
        initialMonth={currentMonth}
        initialSummary={initialSummary}
      />
    </div>
  )
}
