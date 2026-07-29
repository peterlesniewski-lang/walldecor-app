import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canViewEmployeeRecord } from '@/lib/hr/access'
import { resolveLeaveBalancePoolId } from '@/lib/hr/leave-balance-policy'

class LeaveCancellationError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const request = await prisma.leaveRequestNew.findUnique({
    where: { id },
    include: {
      leaveType: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          position: true,
          divisionId: true,
          active: true,
        },
      },
    },
  })

  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const role = session.user.role
  const isAdminOrManager = role === 'ADMIN' || role === 'MANAGER'

  if (!isAdminOrManager && request.employeeId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (role === 'MANAGER') {
    const viewerEmployee = session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
    if (!canViewEmployeeRecord(session, request.employee, viewerEmployee)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  return NextResponse.json(request)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const request = await prisma.leaveRequestNew.findUnique({
    where: { id },
    include: {
      leaveType: {
        select: {
          id: true,
          code: true,
          tracksBalance: true,
          parentId: true,
        },
      },
    },
  })

  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (request.employeeId !== session.user.employeeId) {
    const role = session.user.role
    if (role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (request.status !== 'pending') {
    return NextResponse.json(
      { error: 'Można anulować tylko wnioski oczekujące' },
      { status: 422 }
    )
  }

  const year = request.startDate.getUTCFullYear()
  const balancePoolId = resolveLeaveBalancePoolId(request.leaveType, request)

  try {
    await prisma.$transaction(async (tx) => {
      const transition = await tx.leaveRequestNew.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'cancelled' },
      })

      if (transition.count !== 1) {
        throw new LeaveCancellationError(409, 'Wniosek został już przetworzony')
      }

      if (balancePoolId) {
        const balance = await tx.leaveBalanceNew.findUnique({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: request.employeeId,
              leaveTypeId: balancePoolId,
              year,
            },
          },
        })

        // Historical requests may outlive an erroneous or deleted balance row.
        // Cancellation can still proceed because it only releases entitlement.
        if (balance) {
          if (balance.pendingDays < request.days) {
            throw new LeaveCancellationError(
              409,
              'Saldo oczekujących dni jest niższe niż liczba dni wniosku'
            )
          }

          await tx.leaveBalanceNew.update({
            where: { id: balance.id },
            data: { pendingDays: { decrement: request.days } },
          })
        }
      }
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error instanceof LeaveCancellationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  return NextResponse.json({ success: true })
}
