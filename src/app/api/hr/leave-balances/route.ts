import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import {
  canViewEmployeeRecord,
  getScopedEmployeeWhere,
  HR_NO_EMPLOYEE_ACCESS_ID,
} from '@/lib/hr/access'

const leaveBalanceCreateSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  totalDays: z.number().min(0),
})

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

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN' && session.user.role !== 'MANAGER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = leaveBalanceCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { employeeId, leaveTypeId, year, totalDays } = parsed.data

  // Validate employee and leave type
  const [employee, leaveType] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId } }),
    prisma.leaveType.findUnique({ where: { id: leaveTypeId } }),
  ])

  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  if (!leaveType) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 })
  if (session.user.role === 'MANAGER') {
    const viewerEmployee = session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
    if (!canViewEmployeeRecord(session, employee, viewerEmployee)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Check for duplicate
  const existing = await prisma.leaveBalanceNew.findUnique({
    where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
  })

  if (existing) {
    return NextResponse.json({ error: 'Balance already exists for this employee/type/year' }, { status: 409 })
  }

  const balance = await prisma.leaveBalanceNew.create({
    data: { employeeId, leaveTypeId, year, totalDays },
    include: {
      leaveType: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  })

  return NextResponse.json(balance, { status: 201 })
}
