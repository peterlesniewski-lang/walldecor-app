import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculateWorkingHours, calculateOvertimeMinutes } from '@/lib/hr/utils'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const employee = await prisma.employee.findFirst({
    where: { userId: session.user.id },
    include: { division: { include: { timeRules: true } } },
  })
  if (!employee) {
    return NextResponse.json({ error: 'No employee record for this user' }, { status: 404 })
  }

  const openEntry = await prisma.timeEntry.findFirst({
    where: { employeeId: employee.id, clockOut: null },
    include: { breaks: true },
  })
  if (!openEntry) {
    return NextResponse.json({ error: 'No active time entry' }, { status: 404 })
  }

  // Check for open break
  const openBreak = openEntry.breaks.find((b) => b.endTime === null)
  if (openBreak) {
    return NextResponse.json(
      { error: 'Cannot clock out while break is active' },
      { status: 409 }
    )
  }

  const now = new Date()

  const { totalMinutes, breakMinutes, netMinutes } = calculateWorkingHours(
    openEntry.clockIn,
    now,
    openEntry.breaks.map((b) => ({ startTime: b.startTime, endTime: b.endTime }))
  )

  // Get daily threshold from division time rule or default 8h
  const timeRule = employee.division?.timeRules?.[0]
  const dailyThresholdHours = timeRule?.dailyHours ?? 8
  const overtimeMinutes = calculateOvertimeMinutes(netMinutes, dailyThresholdHours)

  const updated = await prisma.timeEntry.update({
    where: { id: openEntry.id },
    data: {
      clockOut: now,
      totalMinutes,
      breakMinutes,
      overtimeMinutes,
    },
    include: { breaks: true },
  })

  return NextResponse.json({ entry: updated })
}
