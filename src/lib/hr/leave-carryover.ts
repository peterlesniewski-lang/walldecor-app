import { z } from 'zod'
import type { Prisma } from '@/generated/prisma'
import {
  calculateConfiguredEntitlement,
  selectEffectiveEntitlement,
} from '@/lib/hr/leave-entitlement'

const entitlementConfigSchema = z.object({
  id: z.string(),
  mode: z.enum(['DAYS_20', 'DAYS_26', 'CUSTOM']),
  customAnnualDays: z.number().finite().nullable(),
  employmentFraction: z.number().finite().gt(0).lte(1),
  effectiveFrom: z.date().refine((date) => Number.isFinite(date.getTime())),
}).superRefine((config, context) => {
  if (
    config.mode === 'CUSTOM' &&
    (
      config.customAnnualDays === null ||
      !Number.isInteger(config.customAnnualDays) ||
      config.customAnnualDays < 1 ||
      config.customAnnualDays > 365
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['customAnnualDays'],
      message: 'CUSTOM entitlement requires an integer from 1 to 365',
    })
  }
})

type BalanceSnapshotSource = {
  totalDays: number
  usedDays: number
  pendingDays: number
  carriedOver: number
}

export type LeaveCarryoverBatchInput = {
  fromYear: number
  toYear: number
  maxCarryoverDays?: number
  reason: string
  actorId: string
}

export type LeaveCarryoverBatchResult = {
  processed: number
  created: number
  updated: number
  skipped: number
  needsReview: Array<{
    employeeId: string
    employeeName: string
  }>
}

export class LeaveCarryoverCanonicalVlError extends Error {
  constructor() {
    super('Canonical leave type VL is not configured correctly')
    this.name = 'LeaveCarryoverCanonicalVlError'
  }
}

function snapshot(balance: BalanceSnapshotSource) {
  return {
    totalDays: balance.totalDays,
    usedDays: balance.usedDays,
    pendingDays: balance.pendingDays,
    carriedOver: balance.carriedOver,
  }
}

function selectValidatedConfig(
  configs: Array<{
    id: string
    mode: string
    customAnnualDays: number | null
    employmentFraction: number
    effectiveFrom: Date
  }>,
  targetAsOf: Date
) {
  if (
    configs.some(
      (config) =>
        !(config.effectiveFrom instanceof Date) ||
        !Number.isFinite(config.effectiveFrom.getTime())
    )
  ) {
    return null
  }

  const selected = selectEffectiveEntitlement(configs, targetAsOf)
  if (!selected) return null

  const parsed = entitlementConfigSchema.safeParse(selected)
  return parsed.success ? parsed.data : null
}

export async function executeLeaveCarryoverBatch(
  tx: Prisma.TransactionClient,
  input: LeaveCarryoverBatchInput
): Promise<LeaveCarryoverBatchResult> {
  const vlType = await tx.leaveType.findUnique({
    where: { code: 'VL' },
    select: {
      id: true,
      code: true,
      parentId: true,
      isActive: true,
      isPaid: true,
      requiresApproval: true,
      tracksBalance: true,
    },
  })

  if (
    !vlType ||
    vlType.code !== 'VL' ||
    vlType.parentId !== null ||
    !vlType.isActive ||
    !vlType.isPaid ||
    !vlType.requiresApproval ||
    !vlType.tracksBalance
  ) {
    throw new LeaveCarryoverCanonicalVlError()
  }

  const targetAsOf = new Date(
    Date.UTC(input.toYear, 11, 31, 23, 59, 59, 999)
  )
  const sourceRows = await tx.leaveBalanceNew.findMany({
    where: {
      year: input.fromYear,
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
    orderBy: { employeeId: 'asc' },
  })
  const sourceBalances = sourceRows.filter(
    (balance) =>
      balance.leaveTypeId === vlType.id &&
      balance.employee.active
  )

  const result: LeaveCarryoverBatchResult = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    needsReview: [],
  }

  for (const sourceBalance of sourceBalances) {
    result.processed++

    const config = selectValidatedConfig(
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
      mode: config.mode,
      customAnnualDays: config.customAnnualDays,
      employmentFraction: config.employmentFraction,
      employmentStartDate: sourceBalance.employee.startDate,
      year: input.toYear,
    })
    const remaining = Math.max(
      0,
      sourceBalance.totalDays -
        sourceBalance.usedDays -
        sourceBalance.pendingDays
    )
    const carriedOver =
      input.maxCarryoverDays === undefined
        ? remaining
        : Math.min(remaining, input.maxCarryoverDays)
    const targetTotalDays = annualBase + carriedOver

    const targetBalance = await tx.leaveBalanceNew.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: sourceBalance.employeeId,
          leaveTypeId: vlType.id,
          year: input.toYear,
        },
      },
    })

    if (!targetBalance) {
      await tx.leaveBalanceNew.create({
        data: {
          employeeId: sourceBalance.employeeId,
          leaveTypeId: vlType.id,
          year: input.toYear,
          totalDays: targetTotalDays,
          carriedOver,
        },
      })
      result.created++
      continue
    }

    if (
      targetBalance.totalDays === targetTotalDays &&
      targetBalance.carriedOver === carriedOver
    ) {
      result.skipped++
      continue
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
        year: input.toYear,
        reason: input.reason,
        actorId: input.actorId,
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(after),
      },
    })
    result.updated++
  }

  return result
}
