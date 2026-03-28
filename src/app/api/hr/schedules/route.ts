import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { workScheduleCreateSchema } from '@/lib/hr/schemas'
import { getPolishHolidays } from '@/lib/hr/constants'

// ─── GET /api/hr/schedules?month=2026-03&employeeId=&divisionId= ────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month') // "2026-03"
  const employeeId = searchParams.get('employeeId')
  const divisionId = searchParams.get('divisionId')

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM' }, { status: 400 })
  }

  const [yearStr, monthStr] = month.split('-')
  const year = parseInt(yearStr, 10)
  const monthNum = parseInt(monthStr, 10)

  const rangeStart = new Date(year, monthNum - 1, 1, 0, 0, 0, 0)
  const rangeEnd = new Date(year, monthNum, 0, 23, 59, 59, 999)

  // Build employee filter
  const employeeWhere: Record<string, unknown> = { active: true }
  if (employeeId) employeeWhere.id = employeeId
  if (divisionId) employeeWhere.divisionId = divisionId

  const employees = await prisma.employee.findMany({
    where: employeeWhere,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      divisionId: true,
      workSchedules: {
        where: {
          date: { gte: rangeStart, lte: rangeEnd },
        },
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
            select: {
              name: true,
              color: true,
              code: true,
            },
          },
        },
      },
    },
  })

  const pad = (n: number) => String(n).padStart(2, '0')
  const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  // Build holiday list for this month
  const polishHolidays = getPolishHolidays(year)
  const customHolidays = await prisma.customHoliday.findMany({
    where: {
      OR: [{ divisionId: null }, ...(divisionId ? [{ divisionId }] : [])],
      date: { gte: rangeStart, lte: rangeEnd },
    },
    select: { date: true, name: true },
  })

  const customHolidayDates = customHolidays.map(h => localIso(new Date(h.date)))
  const holidays = [
    ...polishHolidays.filter(d => d.startsWith(month)),
    ...customHolidayDates,
  ]

  // Build response
  const result = employees.map(emp => {
    const schedules: Record<string, {
      id: string
      startTime: string
      endTime: string
      breakMinutes: number
      type: string
    }> = {}

    for (const s of emp.workSchedules) {
      const key = localIso(new Date(s.date))
      schedules[key] = {
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        breakMinutes: s.breakMinutes,
        type: s.type,
      }
    }

    // Expand leave requests into per-day map
    const leaves: Record<string, { name: string; color: string; code: string }> = {}
    for (const lr of emp.leaveRequestsNew) {
      const cur = new Date(lr.startDate)
      cur.setHours(12, 0, 0, 0)
      const end = new Date(lr.endDate)
      end.setHours(12, 0, 0, 0)
      while (cur <= end) {
        const key = localIso(cur)
        if (key >= `${month}-01` && key <= `${month}-${pad(new Date(year, monthNum, 0).getDate())}`) {
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

  return NextResponse.json({ employees: result, holidays })
}

// ─── POST /api/hr/schedules — upsert single schedule entry ─────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = workScheduleCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { employeeId, date, startTime, endTime, breakMinutes, type } = parsed.data

  const day = new Date(date)
  day.setHours(0, 0, 0, 0)

  const schedule = await prisma.workSchedule.upsert({
    where: { employeeId_date: { employeeId, date: day } },
    update: { startTime, endTime, breakMinutes, type },
    create: { employeeId, date: day, startTime, endTime, breakMinutes, type },
  })

  return NextResponse.json(schedule, { status: 200 })
}

// ─── DELETE /api/hr/schedules?id= — delete single schedule entry ────────────

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await prisma.workSchedule.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
