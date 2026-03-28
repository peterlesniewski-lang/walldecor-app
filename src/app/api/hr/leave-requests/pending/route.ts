import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // MANAGER sees only employees from their own division
  let divisionIdFilter: string | undefined

  if (role === 'MANAGER' && session.user.employeeId) {
    const managerEmployee = await prisma.employee.findUnique({
      where: { id: session.user.employeeId },
      select: { divisionId: true },
    })
    divisionIdFilter = managerEmployee?.divisionId ?? undefined
  }

  const requests = await prisma.leaveRequestNew.findMany({
    where: {
      status: 'pending',
      ...(divisionIdFilter
        ? { employee: { divisionId: divisionIdFilter } }
        : {}),
    },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          division: { select: { id: true, name: true } },
        },
      },
      leaveType: {
        select: { id: true, name: true, color: true, code: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(requests)
}
