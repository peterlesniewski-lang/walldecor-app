import type { Prisma, PrismaClient } from '@/generated/prisma'
import { runSerializableTransactionWithRetry, SerializableTransactionConflictError } from '@/lib/hr/serializable-transaction'
import { accountBalanceCents, checkedCents } from './calculations'
import type { CashierActor, CashierCenterId } from './contracts'
import { CashierError } from './errors'

export type CashierTx = Prisma.TransactionClient

export async function cashierTransaction<T>(db: PrismaClient, work: (tx: CashierTx) => Promise<T>) {
  try {
    return await runSerializableTransactionWithRetry(() => db.$transaction(work, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 }))
  } catch (error) {
    if (error instanceof CashierError) throw error
    if (error instanceof SerializableTransactionConflictError) throw new CashierError(409, 'CONCURRENT_CHANGE', 'Inna operacja zmieniła kasę w tym samym czasie. Odśwież dane i ponów zapis.')
    const code = (error as { code?: string } | null)?.code
    if (code === 'P2002') throw new CashierError(409, 'DUPLICATE_OR_CONCURRENT', 'Ten raport, rachunek lub klucz zamknięcia już istnieje. Odśwież dane przed ponowieniem.')
    if (code === 'P2034' || code === 'P1008') throw new CashierError(409, 'CONCURRENT_CHANGE', 'Kasa jest aktualizowana przez inną operację. Odśwież dane i ponów zapis.')
    throw error
  }
}

export async function writeCashierAudit(tx: CashierTx, actor: CashierActor, center: CashierCenterId, entityType: string, entityId: string, action: string, before: unknown, after: unknown, reason?: string | null) {
  return tx.cashierAuditLog.create({ data: {
    costCenterId: center, entityType, entityId, action, actorId: actor.id, actorName: actor.name,
    beforeJson: before == null ? null : JSON.stringify(before), afterJson: JSON.stringify(after), reason: reason?.trim() || null,
  } })
}

export async function requirePlnCashAccount(tx: CashierTx, accountId: string) {
  const account = await tx.cashAccount.findUnique({ where: { id: accountId }, include: { salonCashSettings: true } })
  if (!account || !account.isActive || account.type !== 'cash' || account.currency !== 'PLN') {
    throw new CashierError(400, 'INVALID_CASH_ACCOUNT', 'Wybierz aktywny rachunek gotówkowy w PLN.')
  }
  checkedCents(accountBalanceCents(account.balance))
  return account
}

export async function assertAccountIsNotCashierManaged(tx: Pick<CashierTx, 'salonCashSettings'>, accountId: string) {
  const settings = await tx.salonCashSettings.findUnique({ where: { cashAccountId: accountId }, select: { costCenterId: true } })
  if (settings) {
    throw new CashierError(409, 'CASHIER_MANAGED_ACCOUNT', `Saldo rachunku wylicza Kasa salonu ${settings.costCenterId}. Korektę wykonaj w Kasie salonu; ręczna zmiana salda i dezaktywacja są zablokowane.`)
  }
}

export async function assertAccountCanBeDeactivated(tx: Pick<CashierTx, 'salonCashSettings' | 'cashDeposit'>, accountId: string) {
  await assertAccountIsNotCashierManaged(tx, accountId)
  if (await tx.cashDeposit.count({ where: { destinationAccountId: accountId, status: 'RECEIVED' } })) {
    throw new CashierError(409, 'ACCOUNT_HAS_UNVERIFIED_DEPOSITS', 'Najpierw przelicz odebrane depozyty na tym rachunku. Nie można go dezaktywować przed weryfikacją.')
  }
}

export async function adjustCashAccount(tx: CashierTx, actor: CashierActor, center: CashierCenterId, accountId: string, deltaCents: number, reason: string) {
  checkedCents(deltaCents, true)
  const account = await requirePlnCashAccount(tx, accountId)
  const beforeCents = accountBalanceCents(account.balance)
  const nextCents = checkedCents(beforeCents + deltaCents)
  if (deltaCents === 0) return { beforeCents, afterCents: nextCents }
  const updated = await tx.cashAccount.updateMany({ where: { id: accountId, balance: account.balance, isActive: true }, data: { balance: nextCents / 100 } })
  if (updated.count !== 1) throw new CashierError(409, 'ACCOUNT_CHANGED', 'Saldo rachunku zmieniło się w międzyczasie. Odśwież dane.')
  await tx.cashBalanceHistory.create({ data: { accountId, previousBalance: account.balance, newBalance: nextCents / 100, changedBy: actor.name } })
  await writeCashierAudit(tx, actor, center, 'CASH_ACCOUNT', accountId, 'ACCOUNT_BALANCE_CHANGED', { balanceCents: beforeCents }, { balanceCents: nextCents, deltaCents }, reason)
  return { beforeCents, afterCents: nextCents }
}
