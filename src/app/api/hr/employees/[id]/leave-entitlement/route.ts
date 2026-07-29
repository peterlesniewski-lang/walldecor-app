import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { leaveEntitlementSaveSchema } from '@/lib/hr/schemas'
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

const yearSchema = z.coerce.number().int().min(2000).max(2100)

class PreviewBalanceConflictError extends Error {}
class CorrectionReasonRequiredError extends Error {}

function yearEnd(year: number): Date {
  return new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
}

function snapshot(balance: BalanceSnapshotSource) {
  return {
    totalDays: balance.totalDays,
    usedDays: balance.usedDays,
    pendingDays: balance.pendingDays,
    carriedOver: balance.carriedOver,
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
  balance: BalanceSnapshotSource | null
) {
  const currentTotalDays = balance?.totalDays ?? 0
  return {
    calculatedDays,
    currentTotalDays,
    expectedCurrentTotalDays: balance?.totalDays ?? null,
    deltaDays: calculatedDays - currentTotalDays,
    requiresCorrection: balance !== null && balance.totalDays !== calculatedDays,
  }
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

  const parsedYear = yearSchema.safeParse(
    req.nextUrl.searchParams.get('year') ?? new Date().getUTCFullYear()
  )
  if (!parsedYear.success) return invalidInput(parsedYear.error.flatten())

  const { id: employeeId } = await context.params
  const year = parsedYear.data
  const targetYearEnd = yearEnd(year)
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
        effectiveFrom: { lte: targetYearEnd },
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

  const config = selectEffectiveEntitlement(configs, targetYearEnd)
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

  const duplicateConfig = await prisma.leaveEntitlementConfig.findUnique({
    where: {
      employeeId_effectiveFrom: {
        employeeId,
        effectiveFrom: input.effectiveFrom,
      },
    },
  })

  if (duplicateConfig) {
    return NextResponse.json(
      { error: 'Leave entitlement config already exists for this effective date' },
      { status: 409 }
    )
  }

  const normalizedInput = {
    mode: input.mode,
    customAnnualDays: input.customAnnualDays,
    employmentFraction: input.employmentFraction,
    effectiveFrom: input.effectiveFrom,
    note: input.note ?? null,
    year: input.year,
  }

  if (input.preview) {
    const existingBalance = await prisma.leaveBalanceNew.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId,
          leaveTypeId: vlType.id,
          year: input.year,
        },
      },
    })
    return NextResponse.json({
      ...previewMetadata(calculatedDays, existingBalance),
      input: normalizedInput,
    })
  }

  try {
    const applied = await prisma.$transaction(async (tx) => {
      const currentBalance = await tx.leaveBalanceNew.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId,
            leaveTypeId: vlType.id,
            year: input.year,
          },
        },
      })
      const metadata = previewMetadata(calculatedDays, currentBalance)

      if (input.expectedCurrentTotalDays !== metadata.expectedCurrentTotalDays) {
        throw new PreviewBalanceConflictError()
      }
      if (metadata.requiresCorrection && !input.correctionReason) {
        throw new CorrectionReasonRequiredError()
      }

      const config = await tx.leaveEntitlementConfig.create({
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

      const balance = await tx.leaveBalanceNew.upsert({
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
          totalDays: calculatedDays,
        },
        update: { totalDays: calculatedDays },
      })

      if (metadata.requiresCorrection && currentBalance) {
        await tx.leaveBalanceCorrection.create({
          data: {
            balanceId: balance.id,
            employeeId,
            leaveTypeId: vlType.id,
            year: input.year,
            reason: input.correctionReason!,
            actorId: session.user.id,
            beforeJson: JSON.stringify(snapshot(currentBalance)),
            afterJson: JSON.stringify(snapshot(balance)),
          },
        })
      }

      return { config, balance, metadata }
    })

    return NextResponse.json({
      ...applied.metadata,
      input: normalizedInput,
      config: applied.config,
      balance: applied.balance,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof PreviewBalanceConflictError) {
      return NextResponse.json(
        { error: 'Leave balance changed since preview' },
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
        { error: 'Leave entitlement config already exists for this effective date' },
        { status: 409 }
      )
    }
    throw error
  }
}
