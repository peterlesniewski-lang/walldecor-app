import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canViewEmployeeRecord } from '@/lib/hr/access'
import {
  LeaveBalancePolicyConfigurationError,
  resolveLeaveBalancePoolId,
} from '@/lib/hr/leave-balance-policy'
import {
  runSerializableTransactionWithRetry,
  SerializableTransactionConflictError,
} from '@/lib/hr/serializable-transaction'

const rejectSchema = z.object({
  rejectionNote: z.string().min(1, 'Powód odrzucenia jest wymagany'),
})

class LeaveRejectionError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const leaveRequest = await prisma.leaveRequestNew.findUnique({
    where: { id },
    include: {
      leaveType: {
        select: {
          id: true,
          name: true,
          color: true,
          code: true,
          tracksBalance: true,
          parentId: true,
        },
      },
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          userId: true,
          divisionId: true,
          active: true,
        },
      },
    },
  })

  if (!leaveRequest) {
    return role === 'MANAGER'
      ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (role === 'MANAGER') {
    const viewerEmployee = session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
    if (!canViewEmployeeRecord(session, leaveRequest.employee, viewerEmployee)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  if (leaveRequest.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending requests can be rejected' }, { status: 409 })
  }

  const parsed = rejectSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const year = leaveRequest.startDate.getUTCFullYear()
  let balancePoolId: string | null
  try {
    balancePoolId = resolveLeaveBalancePoolId(leaveRequest.leaveType, leaveRequest)
  } catch (error) {
    if (error instanceof LeaveBalancePolicyConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    throw error
  }

  const rejectRequest = () =>
    prisma.$transaction(async (tx) => {
      const transition = await tx.leaveRequestNew.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'rejected',
          rejectionNote: parsed.data.rejectionNote,
        },
      })

      if (transition.count !== 1) {
        throw new LeaveRejectionError(409, 'Wniosek został już przetworzony')
      }

      if (balancePoolId) {
        const balance = await tx.leaveBalanceNew.findUnique({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: leaveRequest.employeeId,
              leaveTypeId: balancePoolId,
              year,
            },
          },
        })

        // Historical requests may outlive an erroneous or deleted balance row.
        // Rejection can still proceed because it only releases entitlement.
        if (balance) {
          if (balance.pendingDays < leaveRequest.days) {
            throw new LeaveRejectionError(
              409,
              'Saldo oczekujących dni jest niższe niż liczba dni wniosku'
            )
          }

          await tx.leaveBalanceNew.update({
            where: { id: balance.id },
            data: {
              pendingDays: { decrement: leaveRequest.days },
            },
          })
        }
      }

      const updatedRequest = await tx.leaveRequestNew.findUnique({
        where: { id },
        include: {
          leaveType: { select: { id: true, name: true, color: true, code: true } },
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              division: { select: { id: true, name: true } },
            },
          },
        },
      })

      if (!updatedRequest) {
        throw new LeaveRejectionError(409, 'Wniosek został usunięty podczas odrzucania')
      }

      return updatedRequest
    }, { isolationLevel: 'Serializable' })

  let updated: Awaited<ReturnType<typeof rejectRequest>>
  try {
    updated = await runSerializableTransactionWithRetry(rejectRequest)
  } catch (error) {
    if (error instanceof LeaveRejectionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof SerializableTransactionConflictError) {
      return NextResponse.json(
        { error: 'Wniosek został zmieniony równocześnie. Spróbuj ponownie.' },
        { status: 409 }
      )
    }
    throw error
  }

  const userId = leaveRequest.employee.userId
  if (userId) {
    await prisma.notification.create({
      data: {
        userId,
        type: 'leave_rejected',
        title: 'Wniosek urlopowy odrzucony',
        message: `Twój wniosek o urlop (${leaveRequest.leaveType.name}) od ${leaveRequest.startDate.toLocaleDateString('pl-PL')} do ${leaveRequest.endDate.toLocaleDateString('pl-PL')} — ${leaveRequest.days} dni — został odrzucony. Powód: ${parsed.data.rejectionNote}`,
        link: '/hr/leave/requests',
      },
    })
  }

  return NextResponse.json(updated)
}
