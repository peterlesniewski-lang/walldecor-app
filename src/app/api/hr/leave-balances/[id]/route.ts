import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { leaveBalanceCorrectionSchema } from '@/lib/hr/schemas'

type Params = { params: Promise<{ id: string }> }

type BalanceSnapshot = {
  totalDays: number
  usedDays: number
  pendingDays: number
  carriedOver: number
}

function snapshot(balance: BalanceSnapshot): BalanceSnapshot {
  return {
    totalDays: balance.totalDays,
    usedDays: balance.usedDays,
    pendingDays: balance.pendingDays,
    carriedOver: balance.carriedOver,
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  let rawInput: unknown
  try {
    rawInput = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const parsed = leaveBalanceCorrectionSchema.safeParse(rawInput)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { reason, totalDays, usedDays, carriedOver } = parsed.data
  const result = await prisma.$transaction(async (tx) => {
    const currentBalance = await tx.leaveBalanceNew.findUnique({
      where: { id },
    })
    if (!currentBalance) return { status: 'not-found' } as const

    const before = snapshot(currentBalance)
    const after: BalanceSnapshot = {
      totalDays: totalDays ?? before.totalDays,
      usedDays: usedDays ?? before.usedDays,
      pendingDays: before.pendingDays,
      carriedOver: carriedOver ?? before.carriedOver,
    }

    if (after.carriedOver > after.totalDays) {
      return { status: 'invalid-carryover' } as const
    }

    if (
      before.totalDays === after.totalDays &&
      before.usedDays === after.usedDays &&
      before.carriedOver === after.carriedOver
    ) {
      return { status: 'no-op' } as const
    }

    const updateData: {
      totalDays?: number
      usedDays?: number
      carriedOver?: number
    } = {}
    if (totalDays !== undefined) updateData.totalDays = totalDays
    if (usedDays !== undefined) updateData.usedDays = usedDays
    if (carriedOver !== undefined) updateData.carriedOver = carriedOver

    const balance = await tx.leaveBalanceNew.update({
      where: { id },
      data: updateData,
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

    await tx.leaveBalanceCorrection.create({
      data: {
        balanceId: currentBalance.id,
        employeeId: currentBalance.employeeId,
        leaveTypeId: currentBalance.leaveTypeId,
        year: currentBalance.year,
        reason,
        actorId: session.user.id,
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(after),
      },
    })

    return { status: 'updated', balance } as const
  })

  if (result.status === 'not-found') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (result.status === 'invalid-carryover') {
    return NextResponse.json(
      { error: 'Carried over days cannot exceed total days' },
      { status: 422 }
    )
  }
  if (result.status === 'no-op') {
    return NextResponse.json(
      { error: 'Correction does not change leave balance' },
      { status: 422 }
    )
  }

  return NextResponse.json(result.balance)
}
