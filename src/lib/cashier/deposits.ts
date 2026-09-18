import type { CashierActor, CashierCommand, CashierCommandResult } from './contracts'
import { CashierError, requireReason, staleVersion } from './errors'
import { adjustCashAccount, requirePlnCashAccount, writeCashierAudit, type CashierTx } from './ledger'
import { getCashierSettings, isExactReplay } from './reports'

type DepositCommand = Extract<CashierCommand, { action: 'receiveDeposit' | 'verifyDeposit' }>

export async function processCashierDeposit(tx: CashierTx, actor: CashierActor, command: DepositCommand, now: Date): Promise<CashierCommandResult> {
  const deposit = await tx.cashDeposit.findFirst({ where: { id: command.depositId, report: { costCenterId: command.costCenterId } }, include: { report: true } })
  if (!deposit) throw new CashierError(404, 'DEPOSIT_NOT_FOUND', 'Nie znaleziono depozytu w tym salonie.')
  const action = command.action === 'receiveDeposit' ? 'DEPOSIT_RECEIVED' : 'DEPOSIT_VERIFIED'
  const alreadyApplied = command.action === 'receiveDeposit'
    ? ['RECEIVED', 'VERIFIED', 'DISCREPANCY'].includes(deposit.status)
    : ['VERIFIED', 'DISCREPANCY'].includes(deposit.status)
  if (alreadyApplied && await isExactReplay(tx, deposit.id, action, command)) {
    return { ok: true, reportId: deposit.reportId, depositId: deposit.id, replayed: true }
  }
  if (deposit.version !== command.version) staleVersion()
  if (command.action === 'receiveDeposit') {
    if (deposit.status !== 'WAITING' || deposit.receivedAt || deposit.declaredCents <= 0) throw new CashierError(409, 'DEPOSIT_NOT_WAITING', 'Do odbioru dostępny jest tylko oczekujący, niewycofany depozyt.')
    const destination = await requirePlnCashAccount(tx, command.destinationAccountId)
    if (destination.salonCashSettings) throw new CashierError(409, 'DESTINATION_IS_SALON', 'Rachunek docelowy nie może być kasą salonu. Wybierz oddzielny rachunek gotówkowy właściciela.')
    const settings = await getCashierSettings(tx, command.costCenterId)
    const changed = await tx.cashDeposit.updateMany({ where: { id: deposit.id, version: command.version, status: 'WAITING', receivedAt: null }, data: { status: 'RECEIVED', destinationAccountId: destination.id, receivedById: actor.id, receivedAt: now, version: { increment: 1 } } })
    if (changed.count !== 1) staleVersion()
    await adjustCashAccount(tx, actor, command.costCenterId, settings.cashAccountId, -deposit.declaredCents, `Wydanie depozytu ${deposit.id}`)
    await adjustCashAccount(tx, actor, command.costCenterId, destination.id, deposit.declaredCents, `Odbiór zapieczętowanego depozytu ${deposit.id}; zawartość nieprzeliczona`)
  } else {
    if (deposit.status !== 'RECEIVED' || !deposit.receivedAt || !deposit.destinationAccountId) throw new CashierError(409, 'DEPOSIT_NOT_RECEIVED', 'Najpierw potwierdź fizyczny odbiór zapieczętowanego depozytu.')
    const difference = command.actualCents - deposit.declaredCents
    if (difference !== 0) requireReason(command.reason)
    const destination = await requirePlnCashAccount(tx, deposit.destinationAccountId)
    if (destination.salonCashSettings) throw new CashierError(409, 'DESTINATION_IS_SALON', 'Rachunek odbiorczy został powiązany z kasą salonu. Wymagana jest kontrola administratora.')
    const changed = await tx.cashDeposit.updateMany({ where: { id: deposit.id, version: command.version, status: 'RECEIVED' }, data: { status: difference === 0 ? 'VERIFIED' : 'DISCREPANCY', actualCents: command.actualCents, verifiedById: actor.id, verifiedAt: now, verificationNote: command.reason?.trim() || null, version: { increment: 1 } } })
    if (changed.count !== 1) staleVersion()
    await adjustCashAccount(tx, actor, command.costCenterId, deposit.destinationAccountId, difference, command.reason?.trim() || `Potwierdzenie zawartości depozytu ${deposit.id}`)
  }
  const after = await tx.cashDeposit.findUniqueOrThrow({ where: { id: deposit.id } })
  await writeCashierAudit(tx, actor, command.costCenterId, 'DEPOSIT', deposit.id, action, deposit, { deposit: after, command }, command.action === 'verifyDeposit' ? command.reason : undefined)
  return { ok: true, reportId: deposit.reportId, depositId: deposit.id }
}
