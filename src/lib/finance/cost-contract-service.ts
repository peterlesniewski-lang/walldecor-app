import type { Prisma, PrismaClient } from '@/generated/prisma'
import type { CostContractAction, CostContractCreate } from '@/lib/validations/cost-contracts'

type Db = PrismaClient | Prisma.TransactionClient

export class CostContractError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

async function audit(tx: Db, contractId: string, actorId: string, action: string, before: unknown, after: unknown) {
  await tx.costContractAuditEvent.create({
    data: {
      contractId,
      action,
      actorId,
      beforeJson: before == null ? null : JSON.stringify(before),
      afterJson: after == null ? null : JSON.stringify(after),
    },
  })
}

export async function listCostContracts(db: Db) {
  return db.costContract.findMany({
    include: {
      amounts: { orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] },
      splits: { orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] },
      auditEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
    orderBy: [{ endMonth: 'asc' }, { startMonth: 'desc' }, { counterparty: 'asc' }],
  })
}

export async function createCostContract(db: PrismaClient, actorId: string, input: CostContractCreate) {
  return db.$transaction(async (tx) => {
    const contract = await tx.costContract.create({
      data: {
        counterparty: input.counterparty,
        description: input.description,
        startMonth: input.startMonth,
        endMonth: input.endMonth ?? null,
        isConfidential: input.isConfidential,
        createdById: actorId,
        amounts: { create: { effectiveFrom: input.startMonth, amountGrosze: input.amount, createdById: actorId } },
        splits: { create: { effectiveFrom: input.startMonth, jagPercent: input.jagPercent, createdById: actorId } },
      },
    })
    await audit(tx, contract.id, actorId, 'contract.create', null, input)
    return contract
  })
}

export async function applyCostContractAction(db: PrismaClient, actorId: string, id: string, action: CostContractAction) {
  try {
    await db.$transaction(async (tx) => {
      const contract = await tx.costContract.findUnique({ where: { id }, include: { amounts: true, splits: true } })
      if (!contract) throw new CostContractError('Umowa nie istnieje.', 404)

      switch (action.action) {
        case 'update': {
          if (action.endMonth && action.endMonth < contract.startMonth) {
            throw new CostContractError('Koniec umowy nie może być przed jej początkiem.')
          }
          const before = { counterparty: contract.counterparty, description: contract.description, endMonth: contract.endMonth, isConfidential: contract.isConfidential }
          const after = { counterparty: action.counterparty, description: action.description, endMonth: action.endMonth, isConfidential: action.isConfidential }
          await tx.costContract.update({ where: { id }, data: after })
          await audit(tx, id, actorId, 'contract.update', before, after)
          return
        }
        case 'amount.add': {
          if (action.effectiveFrom < contract.startMonth) throw new CostContractError('Kwota nie może obowiązywać przed początkiem umowy.')
          const row = await tx.costContractAmount.create({
            data: { contractId: id, effectiveFrom: action.effectiveFrom, amountGrosze: action.amount, createdById: actorId },
          })
          await audit(tx, id, actorId, 'amount.add', null, { effectiveFrom: row.effectiveFrom, amountGrosze: row.amountGrosze })
          return
        }
        case 'amount.revoke': {
          const row = contract.amounts.find((amount) => amount.id === action.amountId && amount.revokedAt === null)
          if (!row) throw new CostContractError('Kwota nie istnieje albo jest już cofnięta.', 404)
          await tx.costContractAmount.update({ where: { id: row.id }, data: { revokedAt: new Date(), revokedById: actorId } })
          await audit(tx, id, actorId, 'amount.revoke', { effectiveFrom: row.effectiveFrom, amountGrosze: row.amountGrosze }, null)
          return
        }
        case 'split.add': {
          if (action.effectiveFrom < contract.startMonth) throw new CostContractError('Podział nie może obowiązywać przed początkiem umowy.')
          const row = await tx.costContractSplit.create({
            data: { contractId: id, effectiveFrom: action.effectiveFrom, jagPercent: action.jagPercent, createdById: actorId },
          })
          await audit(tx, id, actorId, 'split.add', null, { effectiveFrom: row.effectiveFrom, jagPercent: row.jagPercent })
          return
        }
        case 'split.revoke': {
          const row = contract.splits.find((split) => split.id === action.splitId && split.revokedAt === null)
          if (!row) throw new CostContractError('Podział nie istnieje albo jest już cofnięty.', 404)
          await tx.costContractSplit.update({ where: { id: row.id }, data: { revokedAt: new Date(), revokedById: actorId } })
          await audit(tx, id, actorId, 'split.revoke', { effectiveFrom: row.effectiveFrom, jagPercent: row.jagPercent }, null)
          return
        }
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CostContractError('Od tego miesiąca jest już wpis. Cofnij go i dodaj ponownie.', 409)
    }
    throw error
  }
}
