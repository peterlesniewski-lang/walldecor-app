import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { applySubiektRevenue, applySubiektRevenueMonth } from '@/lib/finance/subiekt-revenue'
import { REVENUE_CHANNELS } from '@/lib/validations/revenue'

const applySubiektRevenueSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  costCenterId: z.enum(['JAG', 'PUL']),
  /** Omitted = every channel of the month that has a Subiekt snapshot. */
  channel: z.enum(REVENUE_CHANNELS).optional(),
})

/** ADMIN: copy the Subiekt gross amount of one cell (or a whole month) into Revenue. */
export async function POST(req: NextRequest) {
  const access = await requireFinanceAdmin()
  if ('error' in access) return access.error
  const parsed = applySubiektRevenueSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Nieprawidłowe dane żądania.' }, { status: 400 })
  const { channel, ...cell } = parsed.data
  const result = channel ? await applySubiektRevenue(prisma, { ...cell, channel }) : await applySubiektRevenueMonth(prisma, cell)
  if (!result.ok) return NextResponse.json(result, { status: 409 })
  return NextResponse.json(result)
}
