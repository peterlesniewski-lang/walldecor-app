import { Prisma, PrismaClient } from '@/generated/prisma'
import { assertInstallationStatusTransition } from './state-machine'

type InstallationDb = PrismaClient | Prisma.TransactionClient

export async function getInstallationReadiness(db: InstallationDb, orderId: string) {
  const [openBlockingCount, submittedCount] = await Promise.all([
    db.installationClarification.count({ where: { orderId, status: 'OPEN', isBlocking: true } }),
    db.installationFormSubmission.count({ where: { orderId, status: 'SUBMITTED' } }),
  ])
  return {
    isReady: submittedCount > 0 && openBlockingCount === 0,
    openBlockingCount,
    submittedCount,
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
