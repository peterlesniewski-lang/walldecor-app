import { Prisma, PrismaClient } from '@/generated/prisma'
import { isClientVisitFeeActive } from './delegation-service'
import { assertInstallationStatusTransition } from './state-machine'

type InstallationDb = PrismaClient | Prisma.TransactionClient

export async function getInstallationReadiness(db: InstallationDb, orderId: string) {
  const [openBlockingCount, submittedCount, order] = await Promise.all([
    db.installationClarification.count({ where: { orderId, status: 'OPEN', isBlocking: true } }),
    db.installationFormSubmission.count({ where: { orderId, status: 'SUBMITTED' } }),
    db.installationOrder.findUnique({
      where: { id: orderId },
      select: {
        visitFeeStatus: true,
        visitFeeGrossAmount: true,
        visitFeeClauseText: true,
        visitFeeClauseVersion: true,
        visitFeeLegalApprovedAt: true,
        visitFeeClientAcceptedAt: true,
      },
    }),
  ])
  const visitFeeAcceptanceRequired = Boolean(order && isClientVisitFeeActive({
    status: order.visitFeeStatus,
    grossAmount: order.visitFeeGrossAmount?.toFixed(2) ?? null,
    clauseText: order.visitFeeClauseText,
    clauseVersion: order.visitFeeClauseVersion,
    legalApprovedAt: order.visitFeeLegalApprovedAt,
  }) && !order.visitFeeClientAcceptedAt)
  return {
    isReady: submittedCount > 0 && openBlockingCount === 0 && !visitFeeAcceptanceRequired,
    openBlockingCount,
    submittedCount,
    visitFeeAcceptanceRequired,
  }
}

export async function assertInstallationOrderCanUseStatus(
  db: InstallationDb,
  orderId: string,
  from: string,
  to: string,
) {
  if (to !== 'READY_TO_PLAN') return
  assertInstallationStatusTransition({ from, to, readiness: await getInstallationReadiness(db, orderId) })
}
