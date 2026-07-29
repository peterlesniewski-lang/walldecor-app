import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { leaveRequestCreateSchema } from '@/lib/hr/schemas'
import { calculateWorkingDays } from '@/lib/hr/utils'
import {
  isOnDemandLeave,
  resolveLeaveBalancePoolId,
} from '@/lib/hr/leave-balance-policy'
import {
  canViewEmployeeRecord,
  getScopedEmployeeWhere,
  HR_NO_EMPLOYEE_ACCESS_ID,
} from '@/lib/hr/access'

type LeaveRequestErrorPayload = {
  error: string
  available?: number
  requested?: number
}

class LeaveRequestDomainError extends Error {
  constructor(
    readonly status: number,
    readonly payload: LeaveRequestErrorPayload
  ) {
    super(payload.error)
  }
}

function isRetryableReservationConflict(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false

  if (error.code === 'P2034') return true

  return (
    error.code === 'P2028' &&
    error instanceof Error &&
    error.message.includes('expired transaction')
  )
}

async function runWithReservationRetry<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (!isRetryableReservationConflict(error)) throw error
    return operation()
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const role = session.user.role
  const isAdminOrManager = role === 'ADMIN' || role === 'MANAGER'

  const employeeIdParam = searchParams.get('employeeId')
  const statusParam = searchParams.get('status')
  const yearParam = searchParams.get('year')
  const viewerEmployee =
    role === 'MANAGER' && session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}

  if (!isAdminOrManager) {
    if (!session.user.employeeId) {
      return NextResponse.json([])
    }
    where.employeeId = session.user.employeeId
  } else if (role === 'MANAGER') {
    const scopedWhere = getScopedEmployeeWhere(session, viewerEmployee)
    if (scopedWhere.id === HR_NO_EMPLOYEE_ACCESS_ID) return NextResponse.json([])
    if (employeeIdParam) {
      const requestedEmployee = await prisma.employee.findUnique({
        where: { id: employeeIdParam },
        select: { id: true, divisionId: true, active: true },
      })
      if (!requestedEmployee || !canViewEmployeeRecord(session, requestedEmployee, viewerEmployee)) {
        return NextResponse.json([])
      }
      where.employeeId = employeeIdParam
    } else {
      const scopedEmployees = await prisma.employee.findMany({
        where: scopedWhere,
        select: { id: true },
      })
      where.employeeId = { in: scopedEmployees.map((employee) => employee.id) }
    }
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

  const role = session.user.role
  if (role === 'EMPLOYEE' && session.user.employeeId !== employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  if (role === 'MANAGER') {
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

  const leaveType = await prisma.leaveType.findUnique({
    where: { id: leaveTypeId },
    select: {
      id: true,
      code: true,
      tracksBalance: true,
      parentId: true,
    },
  })
  if (!leaveType) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 })

  const days = calculateWorkingDays(startDate, endDate)
  if (days <= 0) {
    return NextResponse.json({ error: 'Wybrany zakres nie zawiera dni roboczych' }, { status: 422 })
  }

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

  const year = startDate.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
  const balancePoolId = resolveLeaveBalancePoolId(leaveType, {
    isRemoteWork,
    isDelegation,
  })
  const canonicalOnDemand = isOnDemandLeave(leaveType, { isOnDemand })

  try {
    const leaveRequest = await runWithReservationRetry(() => prisma.$transaction(async (tx) => {
      const balance = balancePoolId
        ? await tx.leaveBalanceNew.findUnique({
            where: {
              employeeId_leaveTypeId_year: {
                employeeId,
                leaveTypeId: balancePoolId,
                year,
              },
            },
          })
        : null

      if (balancePoolId && !balance) {
        throw new LeaveRequestDomainError(422, {
          error: 'Brak salda urlopowego dla tego typu urlopu',
        })
      }

      if (balance) {
        const available = balance.totalDays - balance.usedDays - balance.pendingDays
        if (available < days) {
          throw new LeaveRequestDomainError(422, {
            error: 'Niewystarczające saldo urlopowe',
            available,
            requested: days,
          })
        }
      }

      if (canonicalOnDemand) {
        const usedOnDemand = await tx.leaveRequestNew.aggregate({
          where: {
            employeeId,
            status: { notIn: ['cancelled', 'rejected'] },
            startDate: {
              gte: yearStart,
              lte: yearEnd,
            },
            OR: [
              { isOnDemand: true },
              { leaveType: { code: 'VLD' } },
            ],
          },
          _sum: { days: true },
        })

        if ((usedOnDemand._sum.days ?? 0) + days > 4) {
          throw new LeaveRequestDomainError(422, {
            error: 'Przekroczono limit urlopu na żądanie (maks. 4 dni w roku)',
          })
        }
      }

      const request = await tx.leaveRequestNew.create({
        data: {
          employeeId,
          leaveTypeId,
          startDate,
          endDate,
          days,
          isOnDemand: canonicalOnDemand,
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

      if (balance) {
        await tx.leaveBalanceNew.update({
          where: { id: balance.id },
          data: { pendingDays: { increment: days } },
        })
      }

      return request
    }, { isolationLevel: 'Serializable' }))

    return NextResponse.json(leaveRequest, { status: 201 })
  } catch (error) {
    if (error instanceof LeaveRequestDomainError) {
      return NextResponse.json(error.payload, { status: error.status })
    }
    throw error
  }
}
