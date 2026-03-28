import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
  })

  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only the owner can cancel their own request
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

  // Cancel request + restore pendingDays in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequestNew.update({
      where: { id },
      data: { status: 'cancelled' },
    })

    // Restore pending days if balance-tracked
    if (!request.isRemoteWork && !request.isDelegation) {
      const year = request.startDate.getFullYear()
      await tx.leaveBalanceNew.updateMany({
        where: {
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          year,
        },
        data: { pendingDays: { decrement: request.days } },
      })
    }
  })

  return NextResponse.json({ success: true })
}
