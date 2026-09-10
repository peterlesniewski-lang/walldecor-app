import type { CashierActor, CashierCommand, CashierCommandResult } from './contracts'
import { accountBalanceCents } from './calculations'
import { CashierError, staleVersion } from './errors'
import { requirePlnCashAccount, writeCashierAudit, type CashierTx } from './ledger'
import { getCashierSettings, reportInclude } from './reports'

export async function setupCashier(tx: CashierTx, actor: CashierActor, command: Extract<CashierCommand, { action: 'setup' }>, today: string): Promise<CashierCommandResult> {
  if (command.startDate > today) throw new CashierError(400, 'START_IN_FUTURE', 'Data uruchomienia nie może być późniejsza niż dzisiaj w Warszawie.')
  const existing = await tx.salonCashSettings.findUnique({ where: { costCenterId: command.costCenterId } })
  if (existing) throw new CashierError(409, 'ALREADY_CONFIGURED', 'Kasa tego salonu została już uruchomiona. Użyj zmiany celu lub audytowanej korekty raportu.')
  if (!await tx.costCenter.findUnique({ where: { id: command.costCenterId }, select: { id: true } })) {
    throw new CashierError(409, 'SALON_MISSING', 'Brakuje salonu w konfiguracji centrów kosztów.')
  }
  let accountId: string
  if (command.cashAccountId) {
    const account = await requirePlnCashAccount(tx, command.cashAccountId)
    if (account.salonCashSettings) throw new CashierError(409, 'ACCOUNT_ALREADY_MANAGED', 'Ten rachunek jest już powiązany z kasą salonu.')
    if (accountBalanceCents(account.balance) !== command.initialCashCents) {
      throw new CashierError(409, 'OPENING_BALANCE_MISMATCH', 'Saldo wybranego rachunku musi być równe policzonej gotówce początkowej. Uzgodnij je przed uruchomieniem kasy.')
    }
    if (await tx.cashDeposit.count({ where: { destinationAccountId: account.id, status: 'RECEIVED' } })) {
      throw new CashierError(409, 'ACCOUNT_HAS_UNVERIFIED_DEPOSITS', 'Najpierw przelicz odebrane depozyty na tym rachunku. Nie można zmienić jego przeznaczenia przed weryfikacją.')
    }
    accountId = account.id
  } else {
    const order = await tx.cashAccount.aggregate({ _max: { order: true } })
    const account = await tx.cashAccount.create({ data: { name: command.newAccountName!, currency: 'PLN', type: 'cash', balance: command.initialCashCents / 100, order: (order._max.order ?? -1) + 1 } })
    accountId = account.id
    await tx.cashBalanceHistory.create({ data: { accountId, previousBalance: 0, newBalance: command.initialCashCents / 100, changedBy: actor.name } })
    await writeCashierAudit(tx, actor, command.costCenterId, 'CASH_ACCOUNT', accountId, 'ACCOUNT_CREATED', null, { name: account.name, balanceCents: command.initialCashCents, noDuplicateCashConfirmed: true }, command.note)
  }
  const settings = await tx.salonCashSettings.create({ data: { costCenterId: command.costCenterId, cashAccountId: accountId, targetFloatCents: command.targetFloatCents, initialCashCents: command.initialCashCents, startDate: command.startDate } })
  await writeCashierAudit(tx, actor, command.costCenterId, 'SETTINGS', settings.costCenterId, 'SALON_CONFIGURED', null, { settings, sourceReportConfirmed: command.sourceReportConfirmed, accountWasCreated: !command.cashAccountId }, command.note)
  return { ok: true }
}

export async function changeCashierTarget(tx: CashierTx, actor: CashierActor, command: Extract<CashierCommand, { action: 'setTarget' }>): Promise<CashierCommandResult> {
  const settings = await getCashierSettings(tx, command.costCenterId)
  if (settings.version !== command.version) staleVersion()
  if (settings.targetFloatCents === command.targetFloatCents) return { ok: true, replayed: true }
  const changed = await tx.salonCashSettings.updateMany({ where: { costCenterId: command.costCenterId, version: command.version }, data: { targetFloatCents: command.targetFloatCents, version: { increment: 1 } } })
  if (changed.count !== 1) staleVersion()
  const draft = await tx.cashDailyReport.findFirst({ where: { costCenterId: command.costCenterId, status: 'DRAFT' }, include: reportInclude })
  if (draft) {
    const reportChanged = await tx.cashDailyReport.updateMany({ where: { id: draft.id, status: 'DRAFT', version: draft.version }, data: { targetFloatCents: command.targetFloatCents, version: { increment: 1 } } })
    if (reportChanged.count !== 1) staleVersion()
    const after = await tx.cashDailyReport.findUniqueOrThrow({ where: { id: draft.id }, include: reportInclude })
    await writeCashierAudit(tx, actor, command.costCenterId, 'REPORT', draft.id, 'REPORT_TARGET_CHANGED', draft, after, command.reason)
  }
  const after = await getCashierSettings(tx, command.costCenterId)
  await writeCashierAudit(tx, actor, command.costCenterId, 'SETTINGS', command.costCenterId, 'TARGET_CHANGED', settings, after, command.reason)
  return { ok: true, ...(draft ? { reportId: draft.id } : {}) }
}
