import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPolishHolidays } from '@/lib/hr/constants'
import { ScheduleCalendar } from '@/components/hr/time-tracking/schedule-calendar'
import { getScopedEmployeeWhere, HR_NO_EMPLOYEE_ACCESS_ID } from '@/lib/hr/access'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SchedulePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  // EMPLOYEE role: redirect to time-tracking overview
  if (session.user.role === 'EMPLOYEE') {
    redirect('/hr/time-tracking')
  }

  const month = getCurrentMonth()
  const [yearStr, monthStr] = month.split('-')
  const year = parseInt(yearStr, 10)
  const monthNum = parseInt(monthStr, 10)

  const rangeStart = new Date(year, monthNum - 1, 1, 0, 0, 0, 0)
  const rangeEnd = new Date(year, monthNum, 0, 23, 59, 59, 999)
  const viewerEmployee =
    session.user.role === 'MANAGER' && session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
  const scopedEmployeeWhere: Record<string, unknown> = {
    active: true,
    ...getScopedEmployeeWhere(session, viewerEmployee),
  }
  const noEmployeeScope = scopedEmployeeWhere.id === HR_NO_EMPLOYEE_ACCESS_ID
  const managerDivisionId = session.user.role === 'MANAGER' ? viewerEmployee?.divisionId ?? null : null

  // Fetch all active employees with their schedules and leaves for current month
  const employees = await prisma.employee.findMany({
    where: noEmployeeScope ? { id: HR_NO_EMPLOYEE_ACCESS_ID } : scopedEmployeeWhere,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      divisionId: true,
      workSchedules: {
        where: { date: { gte: rangeStart, lte: rangeEnd } },
        select: {
          id: true,
          date: true,
          startTime: true,
          endTime: true,
          breakMinutes: true,
          type: true,
        },
      },
      leaveRequestsNew: {
        where: {
          status: 'approved',
          startDate: { lte: rangeEnd },
          endDate: { gte: rangeStart },
        },
        select: {
          startDate: true,
          endDate: true,
          leaveType: {
            select: { name: true, color: true, code: true },
          },
        },
      },
    },
  })

  // Fetch divisions for filter
  const divisions = await prisma.division.findMany({
    where: session.user.role === 'MANAGER' ? { id: managerDivisionId ?? '__hr_no_division_access__' } : {},
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  // Holidays for this month
  const polishHolidays = getPolishHolidays(year).filter(d => d.startsWith(month))
  const customHolidays = await prisma.customHoliday.findMany({
    where: {
      date: { gte: rangeStart, lte: rangeEnd },
      ...(managerDivisionId ? { OR: [{ divisionId: null }, { divisionId: managerDivisionId }] } : {}),
    },
    select: { date: true },
  })
  const holidays = [
    ...polishHolidays,
    ...customHolidays.map(h => localIso(new Date(h.date))),
  ]

  // Shape employee data
  const employeeRows = employees.map(emp => {
    const schedules: Record<string, {
      id: string; startTime: string; endTime: string; breakMinutes: number; type: 'regular' | 'overtime' | 'on-call'
    }> = {}
    for (const s of emp.workSchedules) {
      const key = localIso(new Date(s.date))
      schedules[key] = {
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        breakMinutes: s.breakMinutes,
        type: s.type as 'regular' | 'overtime' | 'on-call',
      }
    }

    const leaves: Record<string, { name: string; color: string; code: string }> = {}
    const lastDay = new Date(year, monthNum, 0).getDate()
    for (const lr of emp.leaveRequestsNew) {
      const cur = new Date(lr.startDate)
      cur.setHours(12, 0, 0, 0)
      const end = new Date(lr.endDate)
      end.setHours(12, 0, 0, 0)
      while (cur <= end) {
        const key = localIso(cur)
        if (key >= `${month}-01` && key <= `${month}-${pad(lastDay)}`) {
          leaves[key] = lr.leaveType
        }
        cur.setDate(cur.getDate() + 1)
      }
    }

    return {
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      divisionId: emp.divisionId,
      schedules,
      leaves,
    }
  })

  return (
    <div className="p-6 lg:p-8">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--wd-dark)' }}>
          Grafik czasu pracy
        </h1>
        <p className="text-sm mt-1" style={{ color: '#64748B' }}>
          Miesięczny widok grafiku · tworzenie i szablony harmonogramów
        </p>
      </div>

      <ScheduleCalendar
        userRole={session.user.role as 'ADMIN' | 'MANAGER' | 'EMPLOYEE'}
        divisions={divisions}
        initialMonth={month}
        employees={employeeRows}
        holidays={holidays}
      />
    </div>
  )
}
