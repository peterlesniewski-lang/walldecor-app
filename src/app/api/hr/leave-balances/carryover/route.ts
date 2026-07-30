import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  calculateConfiguredEntitlement,
  selectEffectiveEntitlement,
  type LeaveEntitlementMode,
} from '@/lib/hr/leave-entitlement'
import {
  runSerializableTransactionWithRetry,
  SerializableTransactionConflictError,
} from '@/lib/hr/serializable-transaction'

const carryoverSchema = z.object({
  fromYear: z.number().int().min(2000).max(2100),
  toYear: z.number().int().min(2000).max(2100),
  maxCarryoverDays: z.number().min(0).optional(),
  reason: z.string().trim().min(3).max(1000),
}).refine((data) => data.toYear > data.fromYear, {
  message: 'toYear must be greater than fromYear',
  path: ['toYear'],
})

type BalanceSnapshotSource = {
  totalDays: number
  usedDays: number
  pendingDays: number
  carriedOver: number
}

type CarryoverAction = 'created' | 'updated' | 'skipped'

function snapshot(balance: BalanceSnapshotSource) {
  return {
    totalDays: balance.totalDays,
    usedDays: balance.usedDays,
    pendingDays: balance.pendingDays,
    carriedOver: balance.carriedOver,
  }
}

function invalidInput(details?: unknown) {
  return NextResponse.json(
    {
      error: 'Invalid input',
      ...(details === undefined ? {} : { details }),
    },
    { status: 400 }
  )
}

function missingCanonicalVl() {
  return NextResponse.json(
    { error: 'Canonical leave type VL is not configured correctly' },
    { status: 503 }
  )
}

function isTargetBalanceUniqueError(error: unknown): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    error.code !== 'P2002' ||
    !('meta' in error) ||
    typeof error.meta !== 'object' ||
    error.meta === null ||
    !('target' in error.meta)
  ) {
    return false
  }

  const target = error.meta.target
  const fields = Array.isArray(target)
    ? target
    : typeof target === 'string'
      ? target.match(/employeeId|leaveTypeId|year/g) ?? []
      : []

  return (
    fields.length === 3 &&
    fields.includes('employeeId') &&
    fields.includes('leaveTypeId') &&
    fields.includes('year')
  )
}

function carryoverConflict() {
  return NextResponse.json(
    {
      code: 'CARRYOVER_CONFLICT',
      error:
        'Leave balance changed during carryover. Run the operation again.',
    },
    { status: 409 }
  )
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let rawInput: unknown
  try {
    rawInput = await req.json()
  } catch {
    return invalidInput('Request body must be valid JSON')
  }

  const parsed = carryoverSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput(parsed.error.flatten())

  const { fromYear, toYear, maxCarryoverDays, reason } = parsed.data
  const vlType = await prisma.leaveType.findUnique({
    where: { code: 'VL' },
    select: {
      id: true,
      code: true,
      parentId: true,
      tracksBalance: true,
    },
  })

  if (
    !vlType ||
    vlType.code !== 'VL' ||
    vlType.parentId !== null ||
    !vlType.tracksBalance
  ) {
    return missingCanonicalVl()
  }

  const targetAsOf = new Date(
    Date.UTC(toYear, 11, 31, 23, 59, 59, 999)
  )
  const sourceRows = await prisma.leaveBalanceNew.findMany({
    where: {
      year: fromYear,
      leaveTypeId: vlType.id,
      employee: { active: true },
    },
    select: {
      id: true,
      employeeId: true,
      leaveTypeId: true,
      year: true,
      totalDays: true,
      usedDays: true,
      pendingDays: true,
      carriedOver: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          startDate: true,
          active: true,
          leaveEntitlementConfigs: {
            where: {
              effectiveFrom: { lte: targetAsOf },
            },
            select: {
              id: true,
              mode: true,
              customAnnualDays: true,
              employmentFraction: true,
              effectiveFrom: true,
            },
          },
        },
      },
    },
  })
  const sourceBalances = sourceRows.filter(
    (balance) =>
      balance.leaveTypeId === vlType.id &&
      balance.employee.active
  )

  const result = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    needsReview: [] as Array<{
      employeeId: string
      employeeName: string
    }>,
  }

  for (const sourceBalance of sourceBalances) {
    result.processed++

    const config = selectEffectiveEntitlement(
      sourceBalance.employee.leaveEntitlementConfigs,
      targetAsOf
    )
    if (!config) {
      result.skipped++
      result.needsReview.push({
        employeeId: sourceBalance.employeeId,
        employeeName: [
          sourceBalance.employee.firstName,
          sourceBalance.employee.lastName,
        ].join(' '),
      })
      continue
    }

    const annualBase = calculateConfiguredEntitlement({
      mode: config.mode as LeaveEntitlementMode,
      customAnnualDays: config.customAnnualDays,
      employmentFraction: config.employmentFraction,
      employmentStartDate: sourceBalance.employee.startDate,
      year: toYear,
    })
    const remaining = Math.max(
      0,
      sourceBalance.totalDays -
        sourceBalance.usedDays -
        sourceBalance.pendingDays
    )
    const carriedOver =
      maxCarryoverDays === undefined
        ? remaining
        : Math.min(remaining, maxCarryoverDays)
    const targetTotalDays = annualBase + carriedOver

    let action: CarryoverAction
    try {
      action = await runSerializableTransactionWithRetry(() =>
        prisma.$transaction(
          async (tx) => {
            const targetBalance = await tx.leaveBalanceNew.findUnique({
              where: {
                employeeId_leaveTypeId_year: {
                  employeeId: sourceBalance.employeeId,
                  leaveTypeId: vlType.id,
                  year: toYear,
                },
              },
            })

            if (!targetBalance) {
              await tx.leaveBalanceNew.create({
                data: {
                  employeeId: sourceBalance.employeeId,
                  leaveTypeId: vlType.id,
                  year: toYear,
                  totalDays: targetTotalDays,
                  carriedOver,
                },
              })
              return 'created'
            }

            if (
              targetBalance.totalDays === targetTotalDays &&
              targetBalance.carriedOver === carriedOver
            ) {
              return 'skipped'
            }

            const before = snapshot(targetBalance)
            const updatedBalance = await tx.leaveBalanceNew.update({
              where: { id: targetBalance.id },
              data: {
                totalDays: targetTotalDays,
                carriedOver,
              },
            })
            const after = snapshot(updatedBalance)

            await tx.leaveBalanceCorrection.create({
              data: {
                balanceId: targetBalance.id,
                employeeId: sourceBalance.employeeId,
                leaveTypeId: vlType.id,
                year: toYear,
                reason,
                actorId: session.user.id,
                beforeJson: JSON.stringify(before),
                afterJson: JSON.stringify(after),
              },
            })

            return 'updated'
          },
          { isolationLevel: 'Serializable' }
        )
      )
    } catch (error) {
      if (
        error instanceof SerializableTransactionConflictError ||
        isTargetBalanceUniqueError(error)
      ) {
        return carryoverConflict()
      }
      throw error
    }

    result[action]++
  }

  return NextResponse.json(result)
}
