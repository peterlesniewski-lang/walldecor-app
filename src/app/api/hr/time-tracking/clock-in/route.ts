import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { PrismaClient } from '@/generated/prisma'
import {
  ApprovedLeaveBlocksTimeEntryError,
  createTimeEntryRespectingApprovedLeave,
  OpenTimeEntryExistsError,
  TimeEntryAlreadyExistsError,
  TimeEntryConcurrentWriteError,
} from '@/lib/hr/time-tracking/create-entry'

export interface ClockInHandlerDependencies {
  prisma: PrismaClient
  getSession: () => Promise<Session | null>
  now?: () => Date
}

async function handleClockIn(
  req: NextRequest,
  {
    prisma: db,
    getSession,
    now: getNow = () => new Date(),
  }: ClockInHandlerDependencies
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const employee = await db.employee.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!employee) {
    return NextResponse.json({ error: 'No employee record for this user' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as { projectId?: string; notes?: string }

  const now = getNow()

  let entry
  try {
    entry = await createTimeEntryRespectingApprovedLeave(db, {
      employeeId: employee.id,
      date: now,
      rejectWhenAnyEntryIsOpen: true,
      data: {
        clockIn: now,
        source: 'clock',
        projectId: body.projectId ?? null,
        notes: body.notes ?? null,
      },
    })
  } catch (error) {
    if (error instanceof OpenTimeEntryExistsError) {
      return NextResponse.json({ error: 'Already clocked in' }, { status: 409 })
    }
    if (error instanceof TimeEntryAlreadyExistsError) {
      return NextResponse.json({ error: 'Entry already exists for today' }, { status: 409 })
    }
    if (error instanceof ApprovedLeaveBlocksTimeEntryError) {
      return NextResponse.json(
        { error: 'Zatwierdzony urlop blokuje rozpoczęcie czasu pracy' },
        { status: 409 }
      )
    }
    if (error instanceof TimeEntryConcurrentWriteError) {
      return NextResponse.json(
        { error: 'Nie rozpoczęto czasu pracy z powodu równoczesnej zmiany. Spróbuj ponownie.' },
        { status: 409 }
      )
    }
    throw error
  }

  return NextResponse.json({ entry }, { status: 201 })
}

export function createClockInHandler(dependencies: ClockInHandlerDependencies) {
  return (req: NextRequest) => handleClockIn(req, dependencies)
}

export const POST = createClockInHandler({
  prisma,
  getSession: () => getServerSession(authOptions),
})
