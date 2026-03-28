import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get('date') // YYYY-MM-DD

  let targetDate: Date
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    targetDate = new Date(`${dateParam}T12:00:00`)
  } else {
    targetDate = new Date()
    targetDate.setHours(12, 0, 0, 0)
  }

  const dayStart = new Date(targetDate)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(targetDate)
  dayEnd.setHours(23, 59, 59, 999)

  // Next 7 days range
  const nextWeekStart = new Date(dayStart)
  nextWeekStart.setDate(nextWeekStart.getDate() + 1)
  const nextWeekEnd = new Date(dayStart)
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 7)
  nextWeekEnd.setHours(23, 59, 59, 999)

  // Total active employees
  const total = await prisma.employee.count({ where: { active: true } })

  // Approved leaves covering target date
  const approvedLeaves = await prisma.leaveRequestNew.findMany({
    where: {
      status: 'approved',
      startDate: { lte: dayEnd },
      endDate: { gte: dayStart },
    },
    select: {
      id: true,
      isRemoteWork: true,
    },
  })

  const remote = approvedLeaves.filter((l) => l.isRemoteWork).length
  const absent = approvedLeaves.filter((l) => !l.isRemoteWork).length

  // Present = total - absent - remote (remote workers are not absent from work, just remote)
  const present = Math.max(0, total - absent)

  // Planned leaves starting in next 7 days
  const plannedNext = await prisma.leaveRequestNew.count({
    where: {
      status: 'approved',
      startDate: { gte: nextWeekStart, lte: nextWeekEnd },
    },
  })

  return NextResponse.json({ present, remote, absent, plannedNext, total })
}
