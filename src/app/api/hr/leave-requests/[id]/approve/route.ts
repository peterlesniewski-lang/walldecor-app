import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
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
import {
  getWarsawBusinessDate,
  getWarsawBusinessDateQueryRange,
} from '@/lib/hr/business-date'

class LeaveApprovalError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export async function PATCH(
  _req: NextRequest,
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
          division: { select: { id: true, name: true } },
        },
      },
    },
  })

  if (!leaveRequest) return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
    return NextResponse.json({ error: 'Only pending requests can be approved' }, { status: 409 })
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
  const now = new Date()

  const approveRequest = () =>
    prisma.$transaction(async (tx) => {
      if (!leaveRequest.isRemoteWork && !leaveRequest.isDelegation) {
        const startRange = getWarsawBusinessDateQueryRange(leaveRequest.startDate)
        const endRange = getWarsawBusinessDateQueryRange(leaveRequest.endDate)
        const startDateKey = getWarsawBusinessDate(leaveRequest.startDate).isoDate
        const endDateKey = getWarsawBusinessDate(leaveRequest.endDate).isoDate
        const timeEntries = await tx.timeEntry.findMany({
          where: {
            employeeId: leaveRequest.employeeId,
            date: {
              gte: startRange.gte,
              lte: endRange.lte,
            },
          },
          select: { id: true, date: true },
        })
        const hasWorkedTime = timeEntries.some((entry) => {
          const dateKey = getWarsawBusinessDate(entry.date).isoDate
          return startDateKey <= dateKey && dateKey <= endDateKey
        })

        if (hasWorkedTime) {
          throw new LeaveApprovalError(
            409,
            'Nie można zatwierdzić urlopu w dniu z zarejestrowanym czasem pracy'
          )
        }
      }

      const transition = await tx.leaveRequestNew.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'approved',
          approverId: session.user.id,
          approvedAt: now,
        },
      })

      if (transition.count !== 1) {
        throw new LeaveApprovalError(409, 'Wniosek został już przetworzony')
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

        if (!balance) {
          throw new LeaveApprovalError(
            422,
            'Brak salda urlopowego dla tego typu urlopu'
          )
        }

        const available = balance.totalDays - balance.usedDays
        if (available < leaveRequest.days) {
          throw new LeaveApprovalError(
            422,
            `Niewystarczające saldo urlopowe. Dostępne: ${available} dni, wymagane: ${leaveRequest.days} dni`
          )
        }

        if (balance.pendingDays < leaveRequest.days) {
          throw new LeaveApprovalError(
            409,
            'Saldo oczekujących dni jest niższe niż liczba dni wniosku'
          )
        }

        await tx.leaveBalanceNew.update({
          where: { id: balance.id },
          data: {
            usedDays: { increment: leaveRequest.days },
            pendingDays: { decrement: leaveRequest.days },
          },
        })
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
        throw new LeaveApprovalError(409, 'Wniosek został usunięty podczas zatwierdzania')
      }

      return updatedRequest
    }, { isolationLevel: 'Serializable' })

  let updated: Awaited<ReturnType<typeof approveRequest>>
  try {
    updated = await runSerializableTransactionWithRetry(approveRequest)
  } catch (error) {
    if (error instanceof LeaveApprovalError) {
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
        type: 'leave_approved',
        title: 'Wniosek urlopowy zatwierdzony',
        message: `Twój wniosek o urlop (${leaveRequest.leaveType.name}) od ${leaveRequest.startDate.toLocaleDateString('pl-PL')} do ${leaveRequest.endDate.toLocaleDateString('pl-PL')} — ${leaveRequest.days} dni — został zatwierdzony.`,
        link: '/hr/leave/requests',
      },
    })
  }

  if (process.env.N8N_WEBHOOK_URL) {
    void fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaveRequestId: id,
        employeeFirstName: updated.employee.firstName,
        employeeLastName: updated.employee.lastName,
        leaveTypeName: updated.leaveType.name,
        leaveTypeColor: updated.leaveType.color,
        startDate: updated.startDate.toISOString().split('T')[0],
        endDate: updated.endDate.toISOString().split('T')[0],
        days: leaveRequest.days,
        divisionName: updated.employee.division?.name ?? null,
      }),
    }).catch(() => {})
  }

  return NextResponse.json(updated)
}
