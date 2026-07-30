import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { PrismaClient } from '@/generated/prisma'
import { timeEntryCreateSchema } from '@/lib/hr/schemas'
import { canViewEmployeeRecord } from '@/lib/hr/access'
import {
  ApprovedLeaveBlocksTimeEntryError,
  createTimeEntryRespectingApprovedLeave,
  TimeEntryAlreadyExistsError,
  TimeEntryConcurrentWriteError,
} from '@/lib/hr/time-tracking/create-entry'

export interface ManualTimeEntryHandlerDependencies {
  prisma: PrismaClient
  getSession: () => Promise<Session | null>
}

async function handleManualTimeEntry(
  req: NextRequest,
  { prisma: db, getSession }: ManualTimeEntryHandlerDependencies
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = timeEntryCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { employeeId, date, clockIn, clockOut, projectId, taskName, source, notes } = parsed.data
  const role = session.user.role

  if (role === 'MANAGER') {
    const [viewerEmployee, targetEmployee] = await Promise.all([
      session.user.employeeId
        ? db.employee.findUnique({
            where: { id: session.user.employeeId },
            select: { id: true, divisionId: true, active: true },
          })
        : Promise.resolve(null),
      db.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, divisionId: true, active: true },
      }),
    ])

    if (!targetEmployee) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!canViewEmployeeRecord(session, targetEmployee, viewerEmployee)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let totalMinutes: number | null = null
  if (clockOut) {
    totalMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)
    if (totalMinutes < 0) totalMinutes = null
  }

  let entry
  try {
    entry = await createTimeEntryRespectingApprovedLeave(db, {
      employeeId,
      date,
      data: {
        clockIn,
        clockOut: clockOut ?? null,
        totalMinutes,
        projectId: projectId ?? null,
        taskName: taskName ?? null,
        source: source ?? 'manual',
        notes: notes ?? null,
        status: 'pending',
      },
    })
  } catch (error) {
    if (error instanceof TimeEntryAlreadyExistsError) {
      return NextResponse.json(
        { error: 'Entry already exists for this employee on this date' },
        { status: 409 }
      )
    }
    if (error instanceof ApprovedLeaveBlocksTimeEntryError) {
      return NextResponse.json(
        { error: 'Zatwierdzony urlop blokuje utworzenie wpisu dla tego dnia' },
        { status: 409 }
      )
    }
    if (error instanceof TimeEntryConcurrentWriteError) {
      return NextResponse.json(
        { error: 'Wpis nie został zapisany z powodu równoczesnej zmiany. Spróbuj ponownie.' },
        { status: 409 }
      )
    }
    throw error
  }

  return NextResponse.json(entry, { status: 201 })
}

export function createManualTimeEntryHandler(
  dependencies: ManualTimeEntryHandlerDependencies
) {
  return (req: NextRequest) => handleManualTimeEntry(req, dependencies)
}

export const POST = createManualTimeEntryHandler({
  prisma,
  getSession: () => getServerSession(authOptions),
})
