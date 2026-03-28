import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const employee = await prisma.employee.findFirst({
    where: { userId: session.user.id },
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

  const openBreak = openEntry.breaks.find((b) => b.endTime === null)
  if (!openBreak) {
    return NextResponse.json({ error: 'No active break' }, { status: 404 })
  }

  const updated = await prisma.break.update({
    where: { id: openBreak.id },
    data: { endTime: new Date() },
  })

  return NextResponse.json({ break: updated })
}
