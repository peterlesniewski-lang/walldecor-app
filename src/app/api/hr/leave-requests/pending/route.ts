import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getScopedEmployeeWhere,
  HR_NO_EMPLOYEE_ACCESS_ID,
  HR_NO_EMPLOYEE_ACCESS_WHERE,
} from '@/lib/hr/access'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let scopedEmployeeWhere: Record<string, unknown> | null = null

  if (role === 'MANAGER' && session.user.employeeId) {
    const managerEmployee = await prisma.employee.findUnique({
      where: { id: session.user.employeeId },
      select: { id: true, divisionId: true, active: true },
    })
    scopedEmployeeWhere = getScopedEmployeeWhere(session, managerEmployee)
  } else if (role === 'MANAGER') {
    scopedEmployeeWhere = HR_NO_EMPLOYEE_ACCESS_WHERE
  }

  if (scopedEmployeeWhere?.id === HR_NO_EMPLOYEE_ACCESS_ID) {
    return NextResponse.json([])
  }

  const requests = await prisma.leaveRequestNew.findMany({
    where: {
      status: 'pending',
      ...(scopedEmployeeWhere ? { employee: scopedEmployeeWhere } : {}),
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
