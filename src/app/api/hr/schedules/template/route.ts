import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getPolishHolidays } from '@/lib/hr/constants'
import { getScopedEmployeeWhere, HR_NO_EMPLOYEE_ACCESS_ID } from '@/lib/hr/access'

// ─── Schema ───────────────────────────────────────────────────────────────────

const dayScheduleSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breakMinutes: z.number().int().min(0).default(30),
})

const templateApplySchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  template: z.object({
    monday: dayScheduleSchema.optional(),
    tuesday: dayScheduleSchema.optional(),
    wednesday: dayScheduleSchema.optional(),
    thursday: dayScheduleSchema.optional(),
    friday: dayScheduleSchema.optional(),
    saturday: dayScheduleSchema.optional(),
    sunday: dayScheduleSchema.optional(),
  }),
  skipHolidays: z.boolean().default(true),
})

// ─── Day index → template key mapping (0=Sun … 6=Sat) ──────────────────────

const DOW_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

// ─── POST /api/hr/schedules/template ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = templateApplySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { employeeIds, startDate, endDate, template, skipHolidays } = parsed.data
  let managerDivisionId: string | null = null
  if (session.user.role === 'MANAGER') {
    const viewerEmployee = session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
    const scopedWhere = getScopedEmployeeWhere(session, viewerEmployee)
    if (scopedWhere.id === HR_NO_EMPLOYEE_ACCESS_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    managerDivisionId = viewerEmployee?.divisionId ?? null

    const scopedEmployees = await prisma.employee.findMany({
      where: { ...scopedWhere, id: { in: employeeIds } },
      select: { id: true },
    })
    if (scopedEmployees.length !== employeeIds.length) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const start = new Date(startDate + 'T12:00:00')
  const end = new Date(endDate + 'T12:00:00')

  if (end < start) {
    return NextResponse.json({ error: 'endDate must be >= startDate' }, { status: 400 })
  }

  // Build holiday set
  const startYear = start.getFullYear()
  const endYear = end.getFullYear()
  const holidaySet = new Set<string>()
  for (let y = startYear; y <= endYear; y++) {
    for (const h of getPolishHolidays(y)) holidaySet.add(h)
  }

  // Also fetch custom holidays in range
  const rangeStart = new Date(startDate + 'T00:00:00')
  const rangeEnd = new Date(endDate + 'T23:59:59')
  const customHolidays = await prisma.customHoliday.findMany({
    where: {
      date: { gte: rangeStart, lte: rangeEnd },
      ...(managerDivisionId ? { OR: [{ divisionId: null }, { divisionId: managerDivisionId }] } : {}),
    },
    select: { date: true },
  })
  const pad = (n: number) => String(n).padStart(2, '0')
  const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  for (const ch of customHolidays) {
    holidaySet.add(localIso(new Date(ch.date)))
  }

  // Generate upsert operations
  type UpsertOp = {
    where: { employeeId_date: { employeeId: string; date: Date } }
    update: { startTime: string; endTime: string; breakMinutes: number; type: string }
    create: { employeeId: string; date: Date; startTime: string; endTime: string; breakMinutes: number; type: string }
  }

  const ops: UpsertOp[] = []
  const cur = new Date(start)

  while (cur <= end) {
    const iso = localIso(cur)

    if (!skipHolidays || !holidaySet.has(iso)) {
      const dow = cur.getDay()
      const dayKey = DOW_KEYS[dow]
      const dayTemplate = template[dayKey]

      if (dayTemplate) {
        const dayDate = new Date(cur)
        dayDate.setHours(0, 0, 0, 0)

        for (const empId of employeeIds) {
          ops.push({
            where: { employeeId_date: { employeeId: empId, date: dayDate } },
            update: {
              startTime: dayTemplate.startTime,
              endTime: dayTemplate.endTime,
              breakMinutes: dayTemplate.breakMinutes,
              type: 'regular',
            },
            create: {
              employeeId: empId,
              date: dayDate,
              startTime: dayTemplate.startTime,
              endTime: dayTemplate.endTime,
              breakMinutes: dayTemplate.breakMinutes,
              type: 'regular',
            },
          })
        }
      }
    }

    cur.setDate(cur.getDate() + 1)
  }

  // Execute in a transaction
  const results = await prisma.$transaction(
    ops.map(op => prisma.workSchedule.upsert(op))
  )

  return NextResponse.json({ created: results.length, ok: true })
}
