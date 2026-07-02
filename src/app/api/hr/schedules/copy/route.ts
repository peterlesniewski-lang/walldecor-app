import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getScopedEmployeeWhere, HR_NO_EMPLOYEE_ACCESS_ID } from '@/lib/hr/access'

// ─── Schema ───────────────────────────────────────────────────────────────────

const copyScheduleSchema = z.object({
  fromEmployeeId: z.string().min(1),
  toEmployeeIds: z.array(z.string().min(1)).min(1),
  fromMonth: z.string().regex(/^\d{4}-\d{2}$/),
  toMonth: z.string().regex(/^\d{4}-\d{2}$/),
})

// ─── POST /api/hr/schedules/copy ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = copyScheduleSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { fromEmployeeId, toEmployeeIds, fromMonth, toMonth } = parsed.data
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

    const requestedEmployeeIds = [...new Set([fromEmployeeId, ...toEmployeeIds])]
    const scopedEmployees = await prisma.employee.findMany({
      where: { ...scopedWhere, id: { in: requestedEmployeeIds } },
      select: { id: true },
    })
    if (scopedEmployees.length !== requestedEmployeeIds.length) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Parse source month range
  const [fromYear, fromMonthNum] = fromMonth.split('-').map(Number)
  const fromStart = new Date(fromYear, fromMonthNum - 1, 1, 0, 0, 0, 0)
  const fromEnd = new Date(fromYear, fromMonthNum, 0, 23, 59, 59, 999)

  // Fetch source schedules
  const sourceSchedules = await prisma.workSchedule.findMany({
    where: {
      employeeId: fromEmployeeId,
      date: { gte: fromStart, lte: fromEnd },
    },
    select: {
      date: true,
      startTime: true,
      endTime: true,
      breakMinutes: true,
      type: true,
    },
  })

  if (sourceSchedules.length === 0) {
    return NextResponse.json({ error: 'No schedules found for source employee/month', created: 0 })
  }

  // Parse target month
  const [toYear, toMonthNum] = toMonth.split('-').map(Number)
  const fromMonthDays = new Date(fromYear, fromMonthNum, 0).getDate()
  const toMonthDays = new Date(toYear, toMonthNum, 0).getDate()

  // Map source dates to target dates (same day-of-month, clamped to target month)
  const pad = (n: number) => String(n).padStart(2, '0')
  const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  type UpsertOp = {
    where: { employeeId_date: { employeeId: string; date: Date } }
    update: { startTime: string; endTime: string; breakMinutes: number; type: string }
    create: { employeeId: string; date: Date; startTime: string; endTime: string; breakMinutes: number; type: string }
  }

  const ops: UpsertOp[] = []

  for (const src of sourceSchedules) {
    const srcDate = new Date(src.date)
    srcDate.setHours(12, 0, 0, 0)
    const srcDay = srcDate.getDate()

    // Clamp: if source month has more days than target (e.g. Jan 31 → Feb = skip)
    if (srcDay > toMonthDays) continue
    // Also skip days that don't exist in the shorter months
    if (srcDay > Math.min(fromMonthDays, toMonthDays)) continue

    const targetDay = new Date(toYear, toMonthNum - 1, srcDay, 0, 0, 0, 0)

    for (const empId of toEmployeeIds) {
      ops.push({
        where: { employeeId_date: { employeeId: empId, date: targetDay } },
        update: {
          startTime: src.startTime,
          endTime: src.endTime,
          breakMinutes: src.breakMinutes,
          type: src.type,
        },
        create: {
          employeeId: empId,
          date: targetDay,
          startTime: src.startTime,
          endTime: src.endTime,
          breakMinutes: src.breakMinutes,
          type: src.type,
        },
      })
    }
  }

  const results = await prisma.$transaction(
    ops.map(op => prisma.workSchedule.upsert(op))
  )

  return NextResponse.json({ created: results.length, ok: true })
}
