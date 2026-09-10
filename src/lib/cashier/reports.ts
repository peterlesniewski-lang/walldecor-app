import type { Prisma } from '@/generated/prisma'
import type { CashierActor, CashierCenterId, CashierCommand, CashierCommandResult } from './contracts'
import { calculateCashierReport } from './calculations'
import { CashierError, requireReason, staleVersion } from './errors'
import { adjustCashAccount, writeCashierAudit, type CashierTx } from './ledger'

export const reportInclude = {
  operations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  deposit: { include: { destinationAccount: { select: { name: true } } } },
} satisfies Prisma.CashDailyReportInclude
export type CashierReportRow = Prisma.CashDailyReportGetPayload<{ include: typeof reportInclude }>

export async function getCashierSettings(tx: CashierTx, center: CashierCenterId) {
  const settings = await tx.salonCashSettings.findUnique({ where: { costCenterId: center } })
  if (!settings) throw new CashierError(409, 'SALON_NOT_CONFIGURED', 'Administrator musi najpierw uruchomić kasę tego salonu.')
  return settings
}

export async function getCashierReport(tx: CashierTx, center: CashierCenterId, reportId: string): Promise<CashierReportRow> {
  const report = await tx.cashDailyReport.findFirst({ where: { id: reportId, costCenterId: center }, include: reportInclude })
  if (!report) throw new CashierError(404, 'REPORT_NOT_FOUND', 'Nie znaleziono raportu w Twoim salonie.')
  return report
}

export function assertReportVersion(report: { version: number }, version: number) {
  if (report.version !== version) staleVersion()
}

export function assertDraft(report: { status: string }) {
  if (report.status !== 'DRAFT') throw new CashierError(409, 'REPORT_CLOSED', 'Raport jest zamknięty. Dopuszczalną korektę wykonuje administrator z zachowaniem historii.')
}

async function updateVersionedReport(tx: CashierTx, report: CashierReportRow, data: Prisma.CashDailyReportUpdateManyMutationInput) {
  const changed = await tx.cashDailyReport.updateMany({ where: { id: report.id, version: report.version, status: report.status }, data: { ...data, version: { increment: 1 } } })
  if (changed.count !== 1) staleVersion()
}

export async function canCorrectReport(tx: CashierTx, report: CashierReportRow) {
  if (report.status !== 'CLOSED' || (report.deposit && (report.deposit.receivedAt || !['WAITING', 'VOID'].includes(report.deposit.status)))) return false
  const later = await tx.cashDailyReport.count({ where: { costCenterId: report.costCenterId, businessDate: { gt: report.businessDate } } })
  return later === 0
}

export async function createCashierReport(tx: CashierTx, actor: CashierActor, command: Extract<CashierCommand, { action: 'createReport' }>, today: string): Promise<CashierCommandResult> {
  const settings = await getCashierSettings(tx, command.costCenterId)
  if (command.businessDate < settings.startDate || command.businessDate > today) {
    throw new CashierError(400, 'REPORT_DATE_OUT_OF_RANGE', 'Data raportu musi przypadać od uruchomienia kasy do dzisiejszej daty w Warszawie.')
  }
  const latest = await tx.cashDailyReport.findFirst({ where: { costCenterId: command.costCenterId }, orderBy: { businessDate: 'desc' } })
  if (latest?.status === 'DRAFT') {
    if (latest.businessDate === command.businessDate) return { ok: true, reportId: latest.id, replayed: true }
    throw new CashierError(409, 'OPEN_REPORT_EXISTS', `Najpierw zamknij otwarty raport z dnia ${latest.businessDate}.`)
  }
  if (latest && command.businessDate <= latest.businessDate) {
    throw new CashierError(409, 'REPORT_NOT_CHRONOLOGICAL', 'Nowy raport musi być późniejszy niż ostatni zapisany raport salonu.')
  }
  if (latest && latest.retainedCents == null) throw new CashierError(409, 'OPENING_UNKNOWN', 'Ostatni raport nie zawiera potwierdzonej gotówki pozostawionej. Wymagana jest kontrola administratora.')
  const report = await tx.cashDailyReport.create({ data: {
    costCenterId: command.costCenterId, businessDate: command.businessDate,
    openingCents: latest?.retainedCents ?? settings.initialCashCents, targetFloatCents: settings.targetFloatCents, createdById: actor.id,
  } })
  await writeCashierAudit(tx, actor, command.costCenterId, 'REPORT', report.id, 'REPORT_CREATED', null, report)
  return { ok: true, reportId: report.id }
}

export async function saveCashierReport(tx: CashierTx, actor: CashierActor, command: Extract<CashierCommand, { action: 'updateReport' }>): Promise<CashierCommandResult> {
  const report = await getCashierReport(tx, command.costCenterId, command.reportId)
  assertDraft(report)
  assertReportVersion(report, command.version)
  const data = {
    ...(command.cashReceiptsCents !== undefined ? { cashReceiptsCents: command.cashReceiptsCents } : {}),
    ...(command.cardReceiptsCents !== undefined ? { cardReceiptsCents: command.cardReceiptsCents } : {}),
    ...(command.countedCents !== undefined ? { countedCents: command.countedCents } : {}),
    ...(command.note !== undefined ? { note: command.note || null } : {}),
  }
  calculateCashierReport({ ...report, ...data })
  await updateVersionedReport(tx, report, data)
  const after = await getCashierReport(tx, command.costCenterId, report.id)
  await writeCashierAudit(tx, actor, command.costCenterId, 'REPORT', report.id, 'REPORT_UPDATED', report, after)
  return { ok: true, reportId: report.id }
}

type OperationCommand = Extract<CashierCommand, { action: 'addOperation' | 'updateOperation' | 'cancelOperation' }>
export async function saveCashierOperation(tx: CashierTx, actor: CashierActor, command: OperationCommand, now: Date): Promise<CashierCommandResult> {
  const report = await getCashierReport(tx, command.costCenterId, command.reportId)
  assertDraft(report)
  assertReportVersion(report, command.version)
  const existing = command.action === 'addOperation' ? null : report.operations.find((operation) => operation.id === command.operationId)
  if (command.action !== 'addOperation' && !existing) throw new CashierError(404, 'OPERATION_NOT_FOUND', 'Nie znaleziono operacji w tym raporcie.')
  if (existing?.cancelledAt) throw new CashierError(409, 'OPERATION_CANCELLED', 'Operacja została już anulowana. Historia anulowanej operacji pozostaje niezmienna.')
  await updateVersionedReport(tx, report, {})
  const after = command.action === 'cancelOperation'
    ? await tx.cashDailyOperation.update({ where: { id: existing!.id }, data: { cancelledAt: now } })
    : command.action === 'updateOperation'
      ? await tx.cashDailyOperation.update({ where: { id: existing!.id }, data: { kind: command.kind, method: command.method, amountCents: command.amountCents, reference: command.reference, note: command.note || null } })
      : await tx.cashDailyOperation.create({ data: { reportId: report.id, kind: command.kind, method: command.method, amountCents: command.amountCents, reference: command.reference, note: command.note || null, createdById: actor.id } })
  // Validate aggregates before commit: an individually valid movement can overflow a report.
  calculateCashierReport(await getCashierReport(tx, command.costCenterId, report.id))
  await writeCashierAudit(tx, actor, command.costCenterId, 'OPERATION', after.id,
    command.action === 'addOperation' ? 'OPERATION_CREATED' : command.action === 'updateOperation' ? 'OPERATION_UPDATED' : 'OPERATION_CANCELLED',
    existing ? { ...existing, reportVersion: report.version } : null,
    { ...after, reportVersion: report.version + 1 }, command.action === 'cancelOperation' ? command.reason : undefined)
  return { ok: true, reportId: report.id }
}

function closedCalculation(report: CashierReportRow, reason?: string) {
  if (report.cashReceiptsCents == null || report.cardReceiptsCents == null || report.countedCents == null) {
    throw new CashierError(400, 'INCOMPLETE_REPORT', 'Wpisz wpływy gotówką i kartą (także jawne zero) oraz niezależnie policzoną gotówkę.')
  }
  const values = calculateCashierReport(report)
  if (values.differenceCents !== 0 || values.shortfallCents !== 0) requireReason(reason)
  return {
    expectedCents: values.expectedCents!, differenceCents: values.differenceCents!,
    retainedCents: values.retainedCents!, depositCents: values.depositCents!, shortfallCents: values.shortfallCents!,
  }
}

export async function isExactReplay(tx: CashierTx, entityId: string, action: string, command: CashierCommand) {
  const audit = await tx.cashierAuditLog.findFirst({ where: { entityId, action }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  if (!audit) return false
  try {
    return JSON.stringify((JSON.parse(audit.afterJson) as { command?: CashierCommand }).command) === JSON.stringify(command)
  } catch { return false }
}

export async function closeCashierReport(tx: CashierTx, actor: CashierActor, command: Extract<CashierCommand, { action: 'closeReport' }>, now: Date): Promise<CashierCommandResult> {
  const report = await getCashierReport(tx, command.costCenterId, command.reportId)
  if (report.status === 'CLOSED' && report.closeRequestId === command.requestId && await isExactReplay(tx, report.id, 'REPORT_CLOSED', command)) {
    return { ok: true, reportId: report.id, ...(report.deposit ? { depositId: report.deposit.id } : {}), replayed: true }
  }
  assertDraft(report)
  assertReportVersion(report, command.version)
  const values = closedCalculation(report, command.reason)
  const settings = await getCashierSettings(tx, command.costCenterId)
  await updateVersionedReport(tx, report, { ...values, status: 'CLOSED', closedAt: now, closedById: actor.id, closeRequestId: command.requestId })
  if (values.depositCents > 0) {
    const deposit = await tx.cashDeposit.create({ data: { reportId: report.id, declaredCents: values.depositCents } })
    await writeCashierAudit(tx, actor, command.costCenterId, 'DEPOSIT', deposit.id, 'DEPOSIT_CREATED', null, deposit)
  }
  await adjustCashAccount(tx, actor, command.costCenterId, settings.cashAccountId, report.countedCents! - report.openingCents, `Zamknięcie raportu ${report.businessDate}`)
  const after = await getCashierReport(tx, command.costCenterId, report.id)
  await writeCashierAudit(tx, actor, command.costCenterId, 'REPORT', report.id, 'REPORT_CLOSED', report, { report: after, command }, command.reason)
  return { ok: true, reportId: report.id, ...(after.deposit ? { depositId: after.deposit.id } : {}) }
}

export async function correctCashierReport(tx: CashierTx, actor: CashierActor, command: Extract<CashierCommand, { action: 'correctReport' }>): Promise<CashierCommandResult> {
  const report = await getCashierReport(tx, command.costCenterId, command.reportId)
  assertReportVersion(report, command.version)
  if (!await canCorrectReport(tx, report)) {
    throw new CashierError(409, 'CORRECTION_BOUNDARY', 'Korekta jest możliwa tylko dla ostatniego zamkniętego raportu, przed utworzeniem następnego raportu i przed odbiorem depozytu.')
  }
  const corrected = { ...report, cashReceiptsCents: command.cashReceiptsCents, cardReceiptsCents: command.cardReceiptsCents, countedCents: command.countedCents }
  const values = closedCalculation(corrected, command.reason)
  const settings = await getCashierSettings(tx, command.costCenterId)
  await updateVersionedReport(tx, report, { cashReceiptsCents: command.cashReceiptsCents, cardReceiptsCents: command.cardReceiptsCents, countedCents: command.countedCents, ...values })
  if (report.deposit) {
    const changed = await tx.cashDeposit.updateMany({ where: { id: report.deposit.id, version: report.deposit.version, status: { in: ['WAITING', 'VOID'] }, receivedAt: null }, data: { declaredCents: values.depositCents, status: values.depositCents > 0 ? 'WAITING' : 'VOID', version: { increment: 1 } } })
    if (changed.count !== 1) staleVersion()
    const deposit = await tx.cashDeposit.findUniqueOrThrow({ where: { id: report.deposit.id } })
    await writeCashierAudit(tx, actor, command.costCenterId, 'DEPOSIT', deposit.id, 'DEPOSIT_CORRECTED', report.deposit, deposit, command.reason)
  } else if (values.depositCents > 0) {
    const deposit = await tx.cashDeposit.create({ data: { reportId: report.id, declaredCents: values.depositCents } })
    await writeCashierAudit(tx, actor, command.costCenterId, 'DEPOSIT', deposit.id, 'DEPOSIT_CREATED_BY_CORRECTION', null, deposit, command.reason)
  }
  await adjustCashAccount(tx, actor, command.costCenterId, settings.cashAccountId, command.countedCents - report.countedCents!, command.reason)
  const after = await getCashierReport(tx, command.costCenterId, report.id)
  await writeCashierAudit(tx, actor, command.costCenterId, 'REPORT', report.id, 'REPORT_CORRECTED', report, { report: after, command }, command.reason)
  return { ok: true, reportId: report.id, ...(after.deposit ? { depositId: after.deposit.id } : {}) }
}
