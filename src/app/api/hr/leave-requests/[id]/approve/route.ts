import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canViewEmployeeRecord } from '@/lib/hr/access'

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

  // 1. Pobierz wniosek z leaveType i employee
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

  // 2. Pobierz saldo urlopowe
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

  // 3. Walidacja salda
  if (balance) {
    const available = balance.totalDays - balance.usedDays
    if (available < leaveRequest.days) {
      return NextResponse.json(
        {
          error: `Niewystarczające saldo urlopowe. Dostępne: ${available} dni, wymagane: ${leaveRequest.days} dni`,
        },
        { status: 422 }
      )
    }
  }

  const now = new Date()

  // 4 & 5. Transakcja: zaktualizuj wniosek + saldo
  const updated = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.leaveRequestNew.update({
      where: { id },
      data: {
        status: 'approved',
        approverId: session.user.id,
        approvedAt: now,
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
          usedDays: { increment: leaveRequest.days },
          pendingDays: { decrement: leaveRequest.days },
        },
      })
    }

    return updatedRequest
  })

  // 6. Utwórz powiadomienie dla pracownika
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

  // 7. Fire-and-forget webhook to n8n for Google Calendar sync
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
    }).catch(() => {}) // fire-and-forget, don't fail approval if webhook fails
  }

  return NextResponse.json(updated)
}
