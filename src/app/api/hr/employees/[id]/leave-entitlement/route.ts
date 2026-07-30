import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { leaveEntitlementSaveSchema } from '@/lib/hr/schemas'
import {
  entitlementAsOfDate,
  getWarsawBusinessDate,
  maxEffectiveDateForYear,
} from '@/lib/hr/business-date'
import {
  calculateConfiguredEntitlement,
  selectEffectiveEntitlement,
  type LeaveEntitlementMode,
} from '@/lib/hr/leave-entitlement'

type RouteContext = {
  params: Promise<{ id: string }>
}

type BalanceSnapshotSource = {
  totalDays: number
  usedDays: number
  pendingDays: number
  carriedOver: number
}

type EntitlementConfigSnapshotSource = {
  id: string
  employeeId: string
  mode: string
  customAnnualDays: number | null
  employmentFraction: number
  effectiveFrom: Date
  note: string | null
  createdById: string
  createdAt: Date
  updatedAt: Date
}

type EntitlementConfigInput = {
  mode: string
  customAnnualDays: number | null
  employmentFraction: number
  note?: string | null
}

const yearSchema = z.coerce.number().int().min(2000).max(2100)

class PreviewBalanceConflictError extends Error {}
class PreviewConfigConflictError extends Error {}
class ConfigDateConflictError extends Error {}
class CorrectionReasonRequiredError extends Error {}

function snapshot(balance: BalanceSnapshotSource) {
  return {
    totalDays: balance.totalDays,
    usedDays: balance.usedDays,
    pendingDays: balance.pendingDays,
    carriedOver: balance.carriedOver,
  }
}

function entitlementConfigSnapshot(config: EntitlementConfigSnapshotSource) {
  return {
    id: config.id,
    employeeId: config.employeeId,
    mode: config.mode,
    customAnnualDays: config.customAnnualDays,
    employmentFraction: config.employmentFraction,
    effectiveFrom: config.effectiveFrom.toISOString(),
    note: config.note,
    createdById: config.createdById,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }
}

function isEntitlementConfigUniqueError(error: unknown): boolean {
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
      ? target.match(/employeeId|effectiveFrom/g) ?? []
      : []

  return (
    fields.length === 2 &&
    fields.includes('employeeId') &&
    fields.includes('effectiveFrom')
  )
}

function normalizeCorrectionReason(rawInput: unknown): unknown {
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)) {
    return rawInput
  }

  const correctionReason = (rawInput as Record<string, unknown>).correctionReason
  if (typeof correctionReason !== 'string' || correctionReason.trim().length >= 3) {
    return rawInput
  }

  return { ...rawInput, correctionReason: undefined }
}

function previewMetadata(
  calculatedDays: number,
  balance: BalanceSnapshotSource | null,
  exactConfig: EntitlementConfigInput | null,
  input: EntitlementConfigInput
) {
  const currentTotalDays = balance?.totalDays ?? 0
  const carriedOver = balance?.carriedOver ?? 0
  const targetTotalDays = calculatedDays + carriedOver
  const balanceChanged =
    balance !== null && balance.totalDays !== targetTotalDays
  const configChanged =
    exactConfig !== null &&
    (exactConfig.mode !== input.mode ||
      exactConfig.customAnnualDays !== input.customAnnualDays ||
      exactConfig.employmentFraction !== input.employmentFraction ||
      exactConfig.note !== (input.note ?? null))

  return {
    calculatedDays,
    targetTotalDays,
    currentTotalDays,
    expectedCurrentTotalDays: balance?.totalDays ?? null,
    expectedCurrentCarriedOver: balance?.carriedOver ?? null,
    deltaDays: targetTotalDays - currentTotalDays,
    configChanged,
    balanceChanged,
    requiresCorrection: configChanged || balanceChanged,
  }
}

function configVersion(
  config: { id: string; updatedAt: Date } | null
): string | null {
  return config ? `${config.id}:${config.updatedAt.toISOString()}` : null
}

function isOlderThanActiveConfig(
  activeConfig: { effectiveFrom: Date } | null,
  effectiveFrom: Date
): boolean {
  return activeConfig !== null && effectiveFrom < activeConfig.effectiveFrom
}

function invalidInput(details: unknown) {
  return NextResponse.json({ error: 'Invalid input', details }, { status: 400 })
}

function missingCanonicalVl() {
  return NextResponse.json(
    { error: 'Canonical leave type VL is not configured' },
    { status: 503 }
  )
}

export async function GET(req: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = new Date()
  const parsedYear = yearSchema.safeParse(
    req.nextUrl.searchParams.get('year') ?? getWarsawBusinessDate(now).year
  )
  if (!parsedYear.success) return invalidInput(parsedYear.error.flatten())

  const { id: employeeId } = await context.params
  const year = parsedYear.data
  const targetAsOf = entitlementAsOfDate(year, now)
  const [employee, vlType] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, startDate: true },
    }),
    prisma.leaveType.findUnique({ where: { code: 'VL' } }),
  ])

  if (!employee) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  }
  if (!vlType) return missingCanonicalVl()

  const [configs, balance, corrections] = await Promise.all([
    prisma.leaveEntitlementConfig.findMany({
      where: {
        employeeId,
        effectiveFrom: { lte: targetAsOf },
      },
    }),
    prisma.leaveBalanceNew.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId,
          leaveTypeId: vlType.id,
          year,
        },
      },
    }),
    prisma.leaveBalanceCorrection.findMany({
      where: { employeeId, leaveTypeId: vlType.id, year },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const config = selectEffectiveEntitlement(configs, targetAsOf)
  const calculatedDays = config
    ? calculateConfiguredEntitlement({
        mode: config.mode as LeaveEntitlementMode,
        customAnnualDays: config.customAnnualDays,
        employmentFraction: config.employmentFraction,
        employmentStartDate: employee.startDate,
        year,
      })
    : null

  return NextResponse.json({
    config,
    calculatedDays,
    balance,
    corrections,
    needsReview: config === null,
  })
}

export async function POST(req: NextRequest, context: RouteContext) {
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

  const parsed = leaveEntitlementSaveSchema.safeParse(
    normalizeCorrectionReason(rawInput)
  )
  if (!parsed.success) return invalidInput(parsed.error.flatten())

  const { id: employeeId } = await context.params
  const input = parsed.data
  const now = new Date()
  const businessDate = getWarsawBusinessDate(now)
  const maxEffectiveDate = maxEffectiveDateForYear(input.year, now)
  const targetAsOf = entitlementAsOfDate(input.year, now)
  const effectiveDate = input.effectiveFrom.toISOString().slice(0, 10)

  if (input.year === businessDate.year && effectiveDate > maxEffectiveDate) {
    return invalidInput({
      fieldErrors: {
        effectiveFrom: [
          `effectiveFrom must be no later than ${maxEffectiveDate}`,
        ],
      },
    })
  }

  const [employee, vlType] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, startDate: true },
    }),
    prisma.leaveType.findUnique({ where: { code: 'VL' } }),
  ])

  if (!employee) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  }
  if (!vlType) return missingCanonicalVl()

  const calculatedDays = calculateConfiguredEntitlement({
    mode: input.mode,
    customAnnualDays: input.customAnnualDays,
    employmentFraction: input.employmentFraction,
    employmentStartDate: employee.startDate,
    year: input.year,
  })

  const normalizedInput = {
    mode: input.mode,
    customAnnualDays: input.customAnnualDays,
    employmentFraction: input.employmentFraction,
    effectiveFrom: input.effectiveFrom,
    note: input.note ?? null,
    year: input.year,
  }

  if (input.preview) {
    const [exactConfig, activeConfig, existingBalance] = await Promise.all([
      prisma.leaveEntitlementConfig.findUnique({
        where: {
          employeeId_effectiveFrom: {
            employeeId,
            effectiveFrom: input.effectiveFrom,
          },
        },
      }),
      prisma.leaveEntitlementConfig.findFirst({
        where: {
          employeeId,
          effectiveFrom: { lte: targetAsOf },
        },
        orderBy: { effectiveFrom: 'desc' },
      }),
      prisma.leaveBalanceNew.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId,
            leaveTypeId: vlType.id,
            year: input.year,
          },
        },
      }),
    ])

    if (isOlderThanActiveConfig(activeConfig, input.effectiveFrom)) {
      return NextResponse.json(
        {
          code: 'CONFIG_DATE_CONFLICT',
          error: 'Leave entitlement config date is older than the active config',
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      ...previewMetadata(calculatedDays, existingBalance, exactConfig, input),
      expectedConfigVersion: configVersion(exactConfig),
      expectedActiveConfigVersion: configVersion(activeConfig),
      input: normalizedInput,
    })
  }

  try {
    const applied = await prisma.$transaction(async (tx) => {
      const [exactConfig, activeConfig, currentBalance] = await Promise.all([
        tx.leaveEntitlementConfig.findUnique({
          where: {
            employeeId_effectiveFrom: {
              employeeId,
              effectiveFrom: input.effectiveFrom,
            },
          },
        }),
        tx.leaveEntitlementConfig.findFirst({
          where: {
            employeeId,
            effectiveFrom: { lte: targetAsOf },
          },
          orderBy: { effectiveFrom: 'desc' },
        }),
        tx.leaveBalanceNew.findUnique({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId,
              leaveTypeId: vlType.id,
              year: input.year,
            },
          },
        }),
      ])

      if (
        input.expectedConfigVersion !== configVersion(exactConfig) ||
        input.expectedActiveConfigVersion !== configVersion(activeConfig)
      ) {
        throw new PreviewConfigConflictError()
      }
      if (isOlderThanActiveConfig(activeConfig, input.effectiveFrom)) {
        throw new ConfigDateConflictError()
      }

      const metadata = {
        ...previewMetadata(calculatedDays, currentBalance, exactConfig, input),
        expectedConfigVersion: configVersion(exactConfig),
        expectedActiveConfigVersion: configVersion(activeConfig),
      }

      if (
        input.expectedCurrentTotalDays !== metadata.expectedCurrentTotalDays ||
        input.expectedCurrentCarriedOver !== metadata.expectedCurrentCarriedOver
      ) {
        throw new PreviewBalanceConflictError()
      }
      if (metadata.requiresCorrection && !input.correctionReason) {
        throw new CorrectionReasonRequiredError()
      }

      let config
      if (exactConfig) {
        config = metadata.configChanged
          ? await tx.leaveEntitlementConfig.update({
              where: { id: exactConfig.id },
              data: {
                mode: input.mode,
                customAnnualDays: input.customAnnualDays,
                employmentFraction: input.employmentFraction,
                note: input.note ?? null,
              },
            })
          : exactConfig
      } else {
        config = await tx.leaveEntitlementConfig.create({
            data: {
              employeeId,
              mode: input.mode,
              customAnnualDays: input.customAnnualDays,
              employmentFraction: input.employmentFraction,
              effectiveFrom: input.effectiveFrom,
              note: input.note ?? null,
              createdById: session.user.id,
            },
          })
      }

      const balance =
        currentBalance !== null && !metadata.balanceChanged
          ? currentBalance
          : await tx.leaveBalanceNew.upsert({
              where: {
                employeeId_leaveTypeId_year: {
                  employeeId,
                  leaveTypeId: vlType.id,
                  year: input.year,
                },
              },
              create: {
                employeeId,
                leaveTypeId: vlType.id,
                year: input.year,
                totalDays: metadata.targetTotalDays,
              },
              update: { totalDays: metadata.targetTotalDays },
            })

      if (metadata.requiresCorrection) {
        const beforeBalance = currentBalance ?? balance
        const beforeSnapshot = snapshot(beforeBalance)
        const afterSnapshot = snapshot(balance)
        const beforeJson =
          metadata.configChanged && exactConfig
            ? {
                ...beforeSnapshot,
                changeType: 'ENTITLEMENT_CONFIG',
                entitlementConfig: entitlementConfigSnapshot(exactConfig),
              }
            : beforeSnapshot
        const afterJson =
          metadata.configChanged
            ? {
                ...afterSnapshot,
                changeType: 'ENTITLEMENT_CONFIG',
                entitlementConfig: entitlementConfigSnapshot(config),
              }
            : afterSnapshot

        await tx.leaveBalanceCorrection.create({
          data: {
            balanceId: balance.id,
            employeeId,
            leaveTypeId: vlType.id,
            year: input.year,
            reason: input.correctionReason!,
            actorId: session.user.id,
            beforeJson: JSON.stringify(beforeJson),
            afterJson: JSON.stringify(afterJson),
          },
        })
      }

      return { config, balance, metadata, updatedExistingConfig: exactConfig !== null }
    })

    return NextResponse.json({
      ...applied.metadata,
      input: normalizedInput,
      config: applied.config,
      balance: applied.balance,
    }, { status: applied.updatedExistingConfig ? 200 : 201 })
  } catch (error) {
    if (error instanceof PreviewConfigConflictError) {
      return NextResponse.json(
        {
          code: 'CONFIG_CONFLICT',
          error: 'Leave entitlement config changed since preview',
        },
        { status: 409 }
      )
    }
    if (error instanceof ConfigDateConflictError) {
      return NextResponse.json(
        {
          code: 'CONFIG_DATE_CONFLICT',
          error: 'Leave entitlement config date is older than the active config',
        },
        { status: 409 }
      )
    }
    if (error instanceof PreviewBalanceConflictError) {
      return NextResponse.json(
        {
          code: 'BALANCE_PREVIEW_CONFLICT',
          error: 'Leave balance changed since preview',
        },
        { status: 409 }
      )
    }
    if (error instanceof CorrectionReasonRequiredError) {
      return NextResponse.json(
        { error: 'Correction reason must contain at least 3 characters' },
        { status: 422 }
      )
    }
    if (isEntitlementConfigUniqueError(error)) {
      return NextResponse.json(
        {
          code: 'CONFIG_CONFLICT',
          error: 'Leave entitlement config changed since preview',
        },
        { status: 409 }
      )
    }
    throw error
  }
}
