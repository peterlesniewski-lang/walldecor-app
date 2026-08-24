import { NextRequest, NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import type { PrismaClient } from '@/generated/prisma'
import { timeEntryBulkCreateSchema } from '@/lib/hr/schemas'
import { getScopedEmployeeWhere, HR_NO_EMPLOYEE_ACCESS_ID } from '@/lib/hr/access'
import {
  ApprovedLeaveBlocksTimeEntryError,
  createTimeEntryRespectingApprovedLeave,
  TimeEntryAlreadyExistsError,
  TimeEntryConcurrentWriteError,
} from '@/lib/hr/time-tracking/create-entry'

export interface BulkTimeEntryHandlerDependencies {
  prisma: PrismaClient
  getSession: () => Promise<Session | null>
}

async function handleBulkTimeEntries(
  req: NextRequest,
  { prisma: db, getSession }: BulkTimeEntryHandlerDependencies
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = timeEntryBulkCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { employeeIds, startDate, endDate, clockInUtc, clockOutUtc, skipWeekends, projectId } = parsed.data
  const role = session.user.role

  // Extract UTC hours/minutes from browser-computed ISO strings.
  // Browser constructed these via new Date('YYYY-MM-DDThh:mm') (local) → .toISOString() (UTC).
  // Using getUTCHours/getUTCMinutes ensures server timezone never affects the result.
  const refIn = new Date(clockInUtc)
  const refOut = new Date(clockOutUtc)
  const inUtcH = refIn.getUTCHours()
  const inUtcM = refIn.getUTCMinutes()
  const outUtcH = refOut.getUTCHours()
  const outUtcM = refOut.getUTCMinutes()

  const totalMinutesPerDay = (outUtcH * 60 + outUtcM) - (inUtcH * 60 + inUtcM)
  if (totalMinutesPerDay <= 0) {
    return NextResponse.json({ error: 'clockOut must be after clockIn' }, { status: 400 })
  }

  const viewerEmployee =
    role === 'MANAGER' && session.user.employeeId
      ? await db.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
  const scopedWhere = getScopedEmployeeWhere(session, viewerEmployee)

  if (scopedWhere.id === HR_NO_EMPLOYEE_ACCESS_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Validate employees exist and are inside the caller's HR scope.
  const employees = await db.employee.findMany({
    where: { ...scopedWhere, id: { in: employeeIds } },
    select: { id: true },
  })
  if (employees.length !== employeeIds.length) {
    return NextResponse.json(
      { error: role === 'MANAGER' ? 'Forbidden' : 'One or more employees not found' },
      { status: role === 'MANAGER' ? 403 : 404 }
    )
  }

  const created: string[] = []
  const skipped: string[] = []

  // Parse dates using Date.UTC to avoid any server timezone influence
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const cur = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))

  while (cur <= end) {
    const dow = cur.getUTCDay()  // 0=Sun, 6=Sat — use UTC to avoid DST shifts
    if (skipWeekends && (dow === 0 || dow === 6)) {
      cur.setUTCDate(cur.getUTCDate() + 1)
      continue
    }

    // UTC midnight for the day — used as the `date` field
    const dayDate = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate()))
    // Apply the same UTC time to this specific day
    const clockInDt = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate(), inUtcH, inUtcM))
    const clockOutDt = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate(), outUtcH, outUtcM))

    for (const employeeId of employeeIds) {
      try {
        const entry = await createTimeEntryRespectingApprovedLeave(db, {
          employeeId,
          date: dayDate,
          data: {
            clockIn: clockInDt,
            clockOut: clockOutDt,
            totalMinutes: totalMinutesPerDay,
            source: 'bulk',
            projectId: projectId ?? null,
            status: 'pending',
          },
        })
        created.push(entry.id)
      } catch (error) {
        if (
          error instanceof TimeEntryAlreadyExistsError ||
          error instanceof ApprovedLeaveBlocksTimeEntryError ||
          error instanceof TimeEntryConcurrentWriteError
        ) {
          skipped.push(`${employeeId}:${dayDate.toISOString().slice(0, 10)}`)
          continue
        }
        throw error
      }
    }

    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  return NextResponse.json({ created: created.length, skipped: skipped.length }, { status: 201 })
}

export function createBulkTimeEntryHandler(
  dependencies: BulkTimeEntryHandlerDependencies
) {
  return (req: NextRequest) => handleBulkTimeEntries(req, dependencies)
}
