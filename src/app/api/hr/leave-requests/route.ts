import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { leaveRequestCreateSchema } from '@/lib/hr/schemas'
import { calculateWorkingDays } from '@/lib/hr/utils'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const role = session.user.role
  const isAdminOrManager = role === 'ADMIN' || role === 'MANAGER'

  const employeeIdParam = searchParams.get('employeeId')
  const statusParam = searchParams.get('status')
  const yearParam = searchParams.get('year')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}

  if (!isAdminOrManager) {
    if (!session.user.employeeId) {
      return NextResponse.json([])
    }
    where.employeeId = session.user.employeeId
  } else {
    if (employeeIdParam) where.employeeId = employeeIdParam
  }

  if (statusParam) where.status = statusParam

  if (yearParam) {
    const year = parseInt(yearParam, 10)
    if (!isNaN(year)) {
      where.startDate = {
        gte: new Date(year, 0, 1),
        lte: new Date(year, 11, 31, 23, 59, 59, 999),
      }
    }
  }

  const requests = await prisma.leaveRequestNew.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      leaveType: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          position: true,
        },
      },
    },
  })

  return NextResponse.json(requests)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = leaveRequestCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const {
    employeeId,
    leaveTypeId,
    startDate,
    endDate,
    isOnDemand,
    isRemoteWork,
    isDelegation,
    substituteId,
    notifySubstitute,
    note,
  } = parsed.data

  // EMPLOYEE can only submit for themselves
  const role = session.user.role
  if (role === 'EMPLOYEE') {
    if (session.user.employeeId !== employeeId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Verify employee exists
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  // Verify leave type exists
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } })
  if (!leaveType) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 })

  // Calculate working days
  const days = calculateWorkingDays(startDate, endDate)
  if (days <= 0) {
    return NextResponse.json({ error: 'Wybrany zakres nie zawiera dni roboczych' }, { status: 422 })
  }

  const year = startDate.getFullYear()

  // Check balance availability (skip for remote work and delegation)
  if (!isRemoteWork && !isDelegation) {
    const balance = await prisma.leaveBalanceNew.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
    })

    if (!balance) {
      return NextResponse.json({ error: 'Brak salda urlopowego dla tego typu urlopu' }, { status: 422 })
    }

    const available = balance.totalDays - balance.usedDays - balance.pendingDays
    if (available < days) {
      return NextResponse.json(
        { error: 'Niewystarczające saldo urlopowe', available, requested: days },
        { status: 422 }
      )
    }
  }

  // Validate isOnDemand: max 4/year
  if (isOnDemand) {
    const onDemandCount = await prisma.leaveRequestNew.count({
      where: {
        employeeId,
        isOnDemand: true,
        status: { notIn: ['cancelled', 'rejected'] },
        startDate: {
          gte: new Date(year, 0, 1),
          lte: new Date(year, 11, 31, 23, 59, 59, 999),
        },
      },
    })
    if (onDemandCount >= 4) {
      return NextResponse.json(
        { error: 'Przekroczono limit urlopów na żądanie (max 4/rok)' },
        { status: 422 }
      )
    }
  }

  // Overlap check
  const overlap = await prisma.leaveRequestNew.findFirst({
    where: {
      employeeId,
      status: { notIn: ['cancelled', 'rejected'] },
      OR: [
        { startDate: { lte: endDate }, endDate: { gte: startDate } },
      ],
    },
  })

  if (overlap) {
    return NextResponse.json(
      { error: 'Wniosek nakłada się z innym wnioskiem urlopowym' },
      { status: 422 }
    )
  }

  // Create request + update pending balance in a transaction
  const [leaveRequest] = await prisma.$transaction(async (tx) => {
    const request = await tx.leaveRequestNew.create({
      data: {
        employeeId,
        leaveTypeId,
        startDate,
        endDate,
        days,
        isOnDemand,
        isRemoteWork,
        isDelegation,
        substituteId,
        notifySubstitute,
        note,
        status: 'pending',
      },
      include: {
        leaveType: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, email: true, position: true },
        },
      },
    })

    // Update pendingDays balance (only if balance-tracked type)
    if (!isRemoteWork && !isDelegation) {
      await tx.leaveBalanceNew.update({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
        data: { pendingDays: { increment: days } },
      })
    }

    return [request]
  })

  return NextResponse.json(leaveRequest, { status: 201 })
}
