import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  canViewEmployeeRecord,
  getScopedEmployeeWhere,
  HR_NO_EMPLOYEE_ACCESS_ID,
} from '@/lib/hr/access'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const employeeId = searchParams.get('employeeId')
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!, 10) : undefined

  const userRole = session.user.role
  const userEmployeeId = session.user.employeeId
  const viewerEmployee =
    userRole === 'MANAGER' && userEmployeeId
      ? await prisma.employee.findUnique({
          where: { id: userEmployeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null

  // Access control: EMPLOYEE can only see own balances
  if (userRole === 'EMPLOYEE') {
    if (!userEmployeeId) {
      return NextResponse.json({ error: 'No employee profile linked' }, { status: 403 })
    }
    if (employeeId && employeeId !== userEmployeeId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  type WhereClause = {
    employeeId?: string | { in: string[] }
    year?: number
  }

  const where: WhereClause = {}

  if (userRole === 'EMPLOYEE') {
    where.employeeId = userEmployeeId!
  } else if (userRole === 'MANAGER') {
    const scopedWhere = getScopedEmployeeWhere(session, viewerEmployee)
    if (scopedWhere.id === HR_NO_EMPLOYEE_ACCESS_ID) return NextResponse.json([])
    if (employeeId) {
      const requestedEmployee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, divisionId: true, active: true },
      })
      if (!requestedEmployee || !canViewEmployeeRecord(session, requestedEmployee, viewerEmployee)) {
        return NextResponse.json([])
      }
      where.employeeId = employeeId
    } else {
      const scopedEmployees = await prisma.employee.findMany({
        where: scopedWhere,
        select: { id: true },
      })
      where.employeeId = { in: scopedEmployees.map((employee) => employee.id) }
    }
  } else if (employeeId) {
    where.employeeId = employeeId
  }

  if (year) where.year = year

  const balances = await prisma.leaveBalanceNew.findMany({
    where,
    include: {
      leaveType: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          costCenter: true,
        },
      },
    },
    orderBy: [
      { employee: { lastName: 'asc' } },
      { leaveType: { name: 'asc' } },
    ],
  })

  return NextResponse.json(balances)
}

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json(
    {
      error:
        'Direct balance creation is disabled. Configure paid leave entitlement or use an audited correction.',
    },
    { status: 405, headers: { Allow: 'GET' } }
  )
}
