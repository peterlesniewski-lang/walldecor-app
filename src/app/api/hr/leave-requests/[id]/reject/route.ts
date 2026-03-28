import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const rejectSchema = z.object({
  rejectionNote: z.string().min(1, 'Powód odrzucenia jest wymagany'),
})

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
      leaveType: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          userId: true,
        },
      },
    },
  })

  if (!leaveRequest) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (leaveRequest.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending requests can be rejected' }, { status: 409 })
  }

  const parsed = rejectSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  // Pobierz saldo aby zaktualizować pendingDays
  const year = leaveRequest.startDate.getFullYear()
  const balance = await prisma.leaveBalanceNew.findUnique({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId: leaveRequest.employeeId,
        leaveTypeId: leaveRequest.leaveTypeId,
        year,
      },
    },
  })

  // 1 & 2. Transakcja: zaktualizuj wniosek + saldo
  const updated = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.leaveRequestNew.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectionNote: parsed.data.rejectionNote,
      },
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

    if (balance) {
      await tx.leaveBalanceNew.update({
        where: { id: balance.id },
        data: {
          pendingDays: { decrement: leaveRequest.days },
        },
      })
    }

    return updatedRequest
  })

  // 3. Utwórz powiadomienie dla pracownika
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
