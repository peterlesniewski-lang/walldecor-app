import type { PrismaClient } from '@/generated/prisma'
import type { RevenueEntryInput } from '@/lib/validations/revenue'

type RevenueWriter = Pick<PrismaClient, 'revenue'>

/**
 * Single write path for a monthly gross revenue cell. Used by the manual
 * editor (`POST /api/revenue`) and by applying a Subiekt snapshot, so both
 * round and store the amount identically.
 */
export async function upsertRevenueEntry(db: RevenueWriter, data: RevenueEntryInput) {
  const amount = Math.round(data.amount * 100) / 100
  const asOfDate = data.asOfDate ?? null
  const where = {
    year_month_costCenterId_channel: {
      year: data.year, month: data.month, costCenterId: data.costCenterId, channel: data.channel,
    },
  }
  return db.revenue.upsert({
    where,
    update: { amount, asOfDate },
    create: { year: data.year, month: data.month, costCenterId: data.costCenterId, channel: data.channel, amount, asOfDate },
  })
}
