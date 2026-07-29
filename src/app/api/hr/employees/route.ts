import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { employeeCreateSchema } from '@/lib/hr/schemas'
import { calcProportionalLeaveDays } from '@/lib/hr/utils'
import {
  getScopedEmployeeWhere,
  HR_NO_EMPLOYEE_ACCESS_ID,
} from '@/lib/hr/access'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const divisionId = searchParams.get('divisionId')
  const departmentId = searchParams.get('departmentId')
  const status = searchParams.get('status')
  const employmentType = searchParams.get('employmentType')
  const search = searchParams.get('search')
  const showHidden = searchParams.get('showHidden') === 'true'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
  const skip = (page - 1) * limit

  const viewerEmployee =
    session.user.role === 'MANAGER' && session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
  const scopedWhere = getScopedEmployeeWhere(session, viewerEmployee)

  if (scopedWhere.id === HR_NO_EMPLOYEE_ACCESS_ID) {
    return NextResponse.json({ employees: [], total: 0, page, limit })
  }

  const where: Record<string, unknown> = { ...scopedWhere }
  const isAdmin = session.user.role === 'ADMIN'

  if (divisionId && isAdmin) where.divisionId = divisionId
  if (divisionId && session.user.role === 'MANAGER' && viewerEmployee?.divisionId !== divisionId) {
    return NextResponse.json({ employees: [], total: 0, page, limit })
  }
  if (departmentId) where.departmentId = departmentId
  if (employmentType) where.employmentType = employmentType
  if (status === 'active') where.active = true
  else if (status === 'inactive' && isAdmin) where.active = false
  else if (!showHidden || !isAdmin) {
    if (!('active' in where) && session.user.role !== 'EMPLOYEE') where.active = true
  }
  if (search) {
    // SQLite does not support mode:'insensitive' — use default (case-insensitive by default for ASCII in SQLite)
    where.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { email: { contains: search } },
    ]
  }

  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        division: true,
        department: true,
        team: true,
        positionRef: true,
        costCenter: true,
      },
    }),
    prisma.employee.count({ where }),
  ])

  return NextResponse.json({ employees, total, page, limit })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = employeeCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const employee = await prisma.employee.create({
    data: parsed.data,
    include: {
      division: true,
      department: true,
      team: true,
      positionRef: true,
      costCenter: true,
    },
  })

  // Auto-create proportional leave balances for UoP/UoD employees
  const employmentType = parsed.data.employmentType
  const annualDays = employmentType === 'B2B' || employmentType === 'UZ' ? 0 : 26

  if (annualDays > 0) {
    const leaveTypes = await prisma.leaveType.findMany({
      where: { isActive: true, isPaid: true, tracksBalance: true },
      select: { id: true },
    })
    if (leaveTypes.length > 0) {
      const currentYear = new Date().getFullYear()
      const days = calcProportionalLeaveDays(
        new Date(parsed.data.startDate),
        currentYear,
        annualDays
      )
      await prisma.leaveBalanceNew.createMany({
        data: leaveTypes.map((lt) => ({
          employeeId: employee.id,
          leaveTypeId: lt.id,
          year: currentYear,
          totalDays: days,
        })),
      })
    }
  }

  return NextResponse.json(employee, { status: 201 })
}
