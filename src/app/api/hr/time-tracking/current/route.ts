import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const employee = await prisma.employee.findFirst({
    where: { userId: session.user.id },
  })
  if (!employee) return NextResponse.json({ entry: null })

  const entry = await prisma.timeEntry.findFirst({
    where: {
      employeeId: employee.id,
      clockOut: null,
    },
    include: {
      breaks: { orderBy: { startTime: 'asc' } },
    },
  })

  return NextResponse.json({ entry })
}
