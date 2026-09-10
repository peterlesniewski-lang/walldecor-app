import type { CashDeposit, Prisma } from '@/generated/prisma'
import { fromZonedTime } from 'date-fns-tz'
import { accountBalanceCents, calculateCashierReport, checkedCents } from './calculations'
import { CASHIER_CENTERS, type CashierActor, type CashierBootstrap, type CashierCenterId, type CashierDeposit, type CashierDepositStatus, type CashierPaymentMethod, type CashierOperationKind, type CashierQuery, type CashierReport } from './contracts'
import type { CashierTx } from './ledger'
import { getCashierReport, reportInclude, type CashierReportRow } from './reports'

function depositDto(deposit: CashDeposit & { destinationAccount: { name: string } | null }, costCenterId: string, businessDate: string): CashierDeposit {
  return {
    id: deposit.id,
    reportId: deposit.reportId,
    declaredCents: deposit.declaredCents,
    version: deposit.version,
    costCenterId: costCenterId as CashierCenterId,
    businessDate,
    status: deposit.status as CashierDepositStatus,
    destinationAccountId: deposit.destinationAccountId,
    destinationAccountName: deposit.destinationAccount?.name ?? null,
    receivedById: deposit.receivedById,
    receivedAt: deposit.receivedAt?.toISOString() ?? null,
    actualCents: deposit.actualCents,
    verifiedById: deposit.verifiedById,
    verifiedAt: deposit.verifiedAt?.toISOString() ?? null,
    verificationNote: deposit.verificationNote,
    createdAt: deposit.createdAt.toISOString(), updatedAt: deposit.updatedAt.toISOString(),
  }
}

function reportDto(report: CashierReportRow, actor: CashierActor, latestReportId: string | null): CashierReport {
  const calculation = calculateCashierReport(report)
  const { operations, deposit, ...row } = report
  return {
    ...row,
    costCenterId: report.costCenterId as CashierCenterId,
    status: report.status as 'DRAFT' | 'CLOSED',
    ...(report.status === 'DRAFT' ? {
      expectedCents: calculation.expectedCents, differenceCents: calculation.differenceCents,
      retainedCents: calculation.retainedCents, depositCents: calculation.depositCents, shortfallCents: calculation.shortfallCents,
    } : {}),
    closedAt: report.closedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(), updatedAt: report.updatedAt.toISOString(),
    operations: operations.map((operation) => ({ ...operation,
      kind: operation.kind as CashierOperationKind, method: operation.method as CashierPaymentMethod,
      cancelledAt: operation.cancelledAt?.toISOString() ?? null, createdAt: operation.createdAt.toISOString(), updatedAt: operation.updatedAt.toISOString(),
    })),
    deposit: deposit ? depositDto(deposit, report.costCenterId, report.businessDate) : null,
    canCorrect: actor.role === 'ADMIN' && report.status === 'CLOSED' && report.id === latestReportId
      && (!deposit || (!deposit.receivedAt && ['WAITING', 'VOID'].includes(deposit.status))),
  }
}

export async function loadCashierBootstrap(tx: CashierTx, actor: CashierActor, center: CashierCenterId, query: CashierQuery, today: string): Promise<CashierBootstrap> {
  const allowedCenters = actor.role === 'ADMIN' ? [...CASHIER_CENTERS] : [actor.costCenterId!]
  const dateFilter = query.from || query.to ? { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } : undefined
  const auditDateFilter = query.from || query.to ? {
    ...(query.from ? { gte: fromZonedTime(`${query.from}T00:00:00.000`, 'Europe/Warsaw') } : {}),
    ...(query.to ? { lte: fromZonedTime(`${query.to}T23:59:59.999`, 'Europe/Warsaw') } : {}),
  } : undefined
  // Resolve explicit IDs inside the allowed center before assembling any data.
  const explicitReport = query.reportId ? await getCashierReport(tx, center, query.reportId) : null
  const reportWhere: Prisma.CashDailyReportWhereInput = { costCenterId: center, ...(dateFilter ? { businessDate: dateFilter } : {}) }
  const [centers, settingsRows, accounts, reports, deposits, logs, latest, waiting, openReport] = await Promise.all([
    tx.costCenter.findMany({ where: { id: { in: allowedCenters } }, select: { id: true, name: true } }),
    tx.salonCashSettings.findMany({ where: { costCenterId: { in: allowedCenters } }, include: { cashAccount: { select: { id: true, name: true, balance: true } } } }),
    actor.role === 'ADMIN' ? tx.cashAccount.findMany({ where: { isActive: true, currency: 'PLN', type: 'cash' }, include: { salonCashSettings: { select: { costCenterId: true } } }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }) : Promise.resolve([]),
    tx.cashDailyReport.findMany({ where: reportWhere, include: reportInclude, orderBy: { businessDate: 'desc' }, take: 201 }),
    tx.cashDeposit.findMany({ where: { report: reportWhere }, include: { report: { select: { costCenterId: true, businessDate: true } }, destinationAccount: { select: { name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 501 }),
    tx.cashierAuditLog.findMany({ where: {
      costCenterId: center,
      ...(auditDateFilter ? { createdAt: auditDateFilter } : {}),
      // The receiving account may hold private owner cash from other sources.
      ...(actor.role === 'EMPLOYEE' ? { entityType: { not: 'CASH_ACCOUNT' } } : {}),
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.auditPage - 1) * 100, take: 101 }),
    tx.cashDailyReport.findFirst({ where: { costCenterId: center }, select: { id: true }, orderBy: { businessDate: 'desc' } }),
    tx.cashDeposit.aggregate({ where: { status: 'WAITING', report: { costCenterId: center } }, _sum: { declaredCents: true } }),
    tx.cashDailyReport.findFirst({ where: { costCenterId: center, status: 'DRAFT' }, include: reportInclude }),
  ])
  const settings = settingsRows.find((row) => row.costCenterId === center)
  const reportDtos = reports.slice(0, 200).map((report) => reportDto(report, actor, latest?.id ?? null))
  const selectedReport = explicitReport ? reportDto(explicitReport, actor, latest?.id ?? null) : reportDtos[0] ?? null
  return {
    actor,
    centers: allowedCenters.map((id) => ({ id, name: centers.find((row) => row.id === id)?.name ?? (id === 'PUL' ? 'Puławska' : 'Jagiellońska'), configured: settingsRows.some((row) => row.costCenterId === id) })),
    selectedCostCenterId: center, today,
    settings: settings ? {
      costCenterId: center, cashAccountId: settings.cashAccountId, cashAccountName: settings.cashAccount.name,
      balanceCents: accountBalanceCents(settings.cashAccount.balance), targetFloatCents: settings.targetFloatCents,
      initialCashCents: settings.initialCashCents, startDate: settings.startDate, version: settings.version,
      createdAt: settings.createdAt.toISOString(), updatedAt: settings.updatedAt.toISOString(),
    } : null,
    accounts: accounts.map((account) => ({ id: account.id, name: account.name, balanceCents: accountBalanceCents(account.balance), managedByCostCenterId: (account.salonCashSettings?.costCenterId as CashierCenterId | undefined) ?? null })),
    reports: reportDtos, selectedReport,
    openReport: openReport ? reportDto(openReport, actor, latest?.id ?? null) : null,
    deposits: deposits.slice(0, 500).map((deposit) => depositDto(deposit, deposit.report.costCenterId, deposit.report.businessDate)),
    audit: logs.slice(0, 100).map((log) => ({ ...log, costCenterId: log.costCenterId as CashierCenterId, createdAt: log.createdAt.toISOString() })),
    auditPage: query.auditPage, auditHasMore: logs.length > 100,
    waitingDepositsCents: checkedCents(waiting._sum.declaredCents ?? 0),
    reportsTruncated: reports.length > 200, depositsTruncated: deposits.length > 500, auditTruncated: logs.length > 100,
  }
}
