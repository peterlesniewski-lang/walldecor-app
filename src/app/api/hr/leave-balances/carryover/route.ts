import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const carryoverSchema = z.object({
  fromYear: z.number().int().min(2000).max(2100),
  toYear: z.number().int().min(2000).max(2100),
  leaveTypeId: z.string().optional(),
  maxCarryoverDays: z.number().min(0).optional(),
}).refine((d) => d.toYear > d.fromYear, {
  message: 'toYear must be greater than fromYear',
  path: ['toYear'],
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = carryoverSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { fromYear, toYear, leaveTypeId, maxCarryoverDays } = parsed.data

  // Find all balances for fromYear
  const fromBalances = await prisma.leaveBalanceNew.findMany({
    where: {
      year: fromYear,
      ...(leaveTypeId ? { leaveTypeId } : {}),
    },
    include: {
      leaveType: true,
    },
  })

  if (fromBalances.length === 0) {
    return NextResponse.json(
      { error: `No balances found for year ${fromYear}` },
      { status: 404 }
    )
  }

  const results = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    details: [] as Array<{
      employeeId: string
      leaveTypeId: string
      carriedOver: number
      action: 'created' | 'updated' | 'skipped'
    }>,
  }

  for (const balance of fromBalances) {
    const remainingDays = balance.totalDays - balance.usedDays
    results.processed++

    if (remainingDays <= 0) {
      results.skipped++
      results.details.push({
        employeeId: balance.employeeId,
        leaveTypeId: balance.leaveTypeId,
        carriedOver: 0,
        action: 'skipped',
      })
      continue
    }

    const carriedOver =
      maxCarryoverDays !== undefined
        ? Math.min(remainingDays, maxCarryoverDays)
        : remainingDays

    if (carriedOver <= 0) {
      results.skipped++
      results.details.push({
        employeeId: balance.employeeId,
        leaveTypeId: balance.leaveTypeId,
        carriedOver: 0,
        action: 'skipped',
      })
      continue
    }

    // Find or create balance in toYear
    const existingToBalance = await prisma.leaveBalanceNew.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: balance.employeeId,
          leaveTypeId: balance.leaveTypeId,
          year: toYear,
        },
      },
    })

    if (existingToBalance) {
      await prisma.leaveBalanceNew.update({
        where: { id: existingToBalance.id },
        data: {
          totalDays: existingToBalance.totalDays + carriedOver,
          carriedOver: existingToBalance.carriedOver + carriedOver,
        },
      })
      results.updated++
      results.details.push({
        employeeId: balance.employeeId,
        leaveTypeId: balance.leaveTypeId,
        carriedOver,
        action: 'updated',
      })
    } else {
      await prisma.leaveBalanceNew.create({
        data: {
          employeeId: balance.employeeId,
          leaveTypeId: balance.leaveTypeId,
          year: toYear,
          totalDays: carriedOver,
          carriedOver,
        },
      })
      results.created++
      results.details.push({
        employeeId: balance.employeeId,
        leaveTypeId: balance.leaveTypeId,
        carriedOver,
        action: 'created',
      })
    }
  }

  return NextResponse.json({
    success: true,
    fromYear,
    toYear,
    ...results,
  })
}
