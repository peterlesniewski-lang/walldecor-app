import type { Prisma, PrismaClient } from '@/generated/prisma'
import type { EmployerRates, PayrollSettlementType } from './employer-cost'
import { PayrollError, audit } from './service'

type Db = PrismaClient | Prisma.TransactionClient

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

// ─── Employer rates (company-wide) ───────────────────────────────────────────

export async function listEmployerRates(db: Db) {
  return db.payrollEmployerRate.findMany({
    orderBy: [{ settlementType: 'asc' }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function createEmployerRate(
  db: PrismaClient,
  actorId: string,
  input: {
    settlementType: PayrollSettlementType
    effectiveFrom: string
    pension: number
    disability: number
    accident: number
    labourFund: number
    guaranteeFund: number
    ppk: number
    note: string | null
  }
) {
  const rates: EmployerRates = {
    pensionBp: input.pension,
    disabilityBp: input.disability,
    accidentBp: input.accident,
    labourFundBp: input.labourFund,
    guaranteeFundBp: input.guaranteeFund,
    ppkBp: input.ppk,
  }
  try {
    // The append-only table is its own history: author, time and revocation are kept on each row.
    return await db.payrollEmployerRate.create({
      data: { settlementType: input.settlementType, effectiveFrom: input.effectiveFrom, ...rates, note: input.note, createdById: actorId },
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PayrollError('Stawki dla tego rodzaju umowy od tego miesiąca już istnieją. Cofnij je i dodaj ponownie.', 409)
    }
    throw error
  }
}

export async function revokeEmployerRate(db: PrismaClient, actorId: string, id: string) {
  const row = await db.payrollEmployerRate.findUnique({ where: { id } })
  if (!row) throw new PayrollError('Stawki nie istnieją.', 404)
  if (row.revokedAt) throw new PayrollError('Stawki są już cofnięte.', 409)
  return db.payrollEmployerRate.update({ where: { id }, data: { revokedAt: new Date(), revokedById: actorId } })
}

// ─── Per-employee exemptions and salon split ─────────────────────────────────

async function requireEmployee(db: Db, employeeId: string) {
  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } })
  if (!employee) throw new PayrollError('Pracownik nie istnieje.', 404)
}

export async function getEmployeeCostSettings(db: Db, employeeId: string) {
  await requireEmployee(db, employeeId)
  const [profile, splits] = await Promise.all([
    db.payrollCostProfile.findUnique({ where: { employeeId } }),
    db.payrollCostSplit.findMany({ where: { employeeId }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] }),
  ])
  return {
    withoutFunds: profile?.withoutFunds ?? false,
    withoutContributions: profile?.withoutContributions ?? false,
    splits,
  }
}

export async function updateCostProfile(
  db: PrismaClient,
  actorId: string,
  input: { employeeId: string; withoutFunds: boolean; withoutContributions: boolean }
) {
  await requireEmployee(db, input.employeeId)
  return db.$transaction(async (tx) => {
    const before = await tx.payrollCostProfile.findUnique({ where: { employeeId: input.employeeId } })
    const data = { withoutFunds: input.withoutFunds, withoutContributions: input.withoutContributions, updatedById: actorId }
    const row = await tx.payrollCostProfile.upsert({
      where: { employeeId: input.employeeId },
      create: { employeeId: input.employeeId, ...data },
      update: data,
    })
    await audit(tx, {
      employeeId: input.employeeId,
      action: 'costProfile.update',
      entityType: 'PayrollCostProfile',
      entityId: input.employeeId,
      before: before ? { withoutFunds: before.withoutFunds, withoutContributions: before.withoutContributions } : null,
      after: { withoutFunds: row.withoutFunds, withoutContributions: row.withoutContributions },
      actorId,
    })
    return row
  })
}

export async function createCostSplit(
  db: PrismaClient,
  actorId: string,
  input: { employeeId: string; effectiveFrom: string; jagPercent: number }
) {
  await requireEmployee(db, input.employeeId)
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.payrollCostSplit.create({ data: { ...input, createdById: actorId } })
      await audit(tx, {
        employeeId: input.employeeId,
        action: 'costSplit.create',
        entityType: 'PayrollCostSplit',
        entityId: row.id,
        after: { effectiveFrom: row.effectiveFrom, jagPercent: row.jagPercent, pulPercent: 100 - row.jagPercent },
        actorId,
      })
      return row
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PayrollError('Podział od tego miesiąca już istnieje. Cofnij go i dodaj ponownie.', 409)
    }
    throw error
  }
}

export async function revokeCostSplit(db: PrismaClient, actorId: string, id: string, reason: string) {
  return db.$transaction(async (tx) => {
    const row = await tx.payrollCostSplit.findUnique({ where: { id } })
    if (!row) throw new PayrollError('Podział nie istnieje.', 404)
    if (row.revokedAt) throw new PayrollError('Podział jest już cofnięty.', 409)
    const updated = await tx.payrollCostSplit.update({ where: { id }, data: { revokedAt: new Date(), revokedById: actorId } })
    await audit(tx, {
      employeeId: row.employeeId,
      action: 'costSplit.revoke',
      entityType: 'PayrollCostSplit',
      entityId: row.id,
      before: { effectiveFrom: row.effectiveFrom, jagPercent: row.jagPercent },
      reason,
      actorId,
    })
    return updated
  })
}
