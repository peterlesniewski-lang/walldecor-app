import type { Prisma, PrismaClient } from '@/generated/prisma'

// Approving a time entry: the one definition used by the Czas pracy route (PATCH
// /api/hr/time-tracking/[id]/approve) and by the payroll sheet ("Zatwierdź godziny").

type Db = PrismaClient | Prisma.TransactionClient

/** What an approval writes on a time entry: the status and who approved it. */
export function timeEntryApprovalData(approverId: string) {
  return { status: 'approved', approvedById: approverId } as const
}

/** Approves one entry (whatever its current status, as the Czas pracy screen always has). */
export function approveTimeEntry(db: Db, id: string, approverId: string) {
  return db.timeEntry.update({ where: { id }, data: timeEntryApprovalData(approverId) })
}

/**
 * Approves the given entries if they are still waiting and have a clock-out. An entry without a
 * clock-out stays as it is (it keeps blocking payroll until someone closes it). Returns the count.
 */
export async function approvePendingTimeEntries(db: Db, ids: string[], approverId: string): Promise<number> {
  if (ids.length === 0) return 0
  const result = await db.timeEntry.updateMany({
    where: { id: { in: ids }, status: { notIn: ['approved', 'rejected'] }, clockOut: { not: null } },
    data: timeEntryApprovalData(approverId),
  })
  return result.count
}
