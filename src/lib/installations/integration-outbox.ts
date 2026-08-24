import type { PrismaClient } from '@/generated/prisma'

export const INTEGRATION_OUTBOX_LEASE_MS = 5 * 60 * 1000

export type ClaimedIntegrationJob = {
  id: string
  visitId: string
  operation: 'CALENDAR_UPSERT' | 'CALENDAR_CANCEL'
  revision: number
  idempotencyKey: string
  status: 'PROCESSING'
  forceOverwrite: boolean
  attemptCount: number
  availableAt: Date
  lockedUntil: Date
  completedAt: Date | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: Date
  updatedAt: Date
  workerId: string
}

type ClaimedIntegrationJobRow = Omit<ClaimedIntegrationJob, 'workerId'>

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function toClaimedIntegrationJob(row: ClaimedIntegrationJobRow, workerId: string): ClaimedIntegrationJob {
  return {
    ...row,
    operation: row.operation as ClaimedIntegrationJob['operation'],
    status: 'PROCESSING',
    availableAt: asDate(row.availableAt),
    lockedUntil: asDate(row.lockedUntil),
    completedAt: row.completedAt === null ? null : asDate(row.completedAt),
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
    workerId,
  }
}

/**
 * Takes one SQLite lease in exactly one statement. The returned lockedUntil
 * becomes the fencing token every later worker write must still match.
 */
export async function claimNextIntegrationJob(
  db: PrismaClient,
  now: Date,
  workerId: string,
): Promise<ClaimedIntegrationJob | null> {
  const lockedUntil = new Date(now.getTime() + INTEGRATION_OUTBOX_LEASE_MS)
  const rows = await db.$queryRaw<ClaimedIntegrationJobRow[]>`
    UPDATE "IntegrationOutbox"
    SET "status" = 'PROCESSING',
        "lockedUntil" = ${lockedUntil},
        "updatedAt" = ${now}
    WHERE "id" = (
      SELECT "id"
      FROM "IntegrationOutbox"
      WHERE (
        "status" IN ('PENDING', 'RETRY')
        OR ("status" = 'PROCESSING' AND "lockedUntil" < ${now})
      )
      AND "availableAt" <= ${now}
      AND "operation" IN ('CALENDAR_UPSERT', 'CALENDAR_CANCEL')
      ORDER BY "createdAt" ASC, "id" ASC
      LIMIT 1
    )
    RETURNING *
  `

  const row = rows[0]
  return row ? toClaimedIntegrationJob(row, workerId) : null
}
