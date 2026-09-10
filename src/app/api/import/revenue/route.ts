import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { parseRevenueAmount, RevenueEntrySchema } from '@/lib/validations/revenue'

const ImportBodySchema = z.object({
  type: z.literal('actuals').default('actuals'),
  rows: z.array(z.record(z.string(), z.string())).min(1),
})

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('X-Api-Key')
  const configuredKey = process.env.IMPORT_API_KEY
  const session = await getServerSession(authOptions)
  const hasIntegrationKey = Boolean(apiKey && configuredKey && apiKey === configuredKey)
  if (!hasIntegrationKey && session?.user.role !== 'ADMIN') {
    return NextResponse.json({ error: session ? 'Forbidden' : 'Unauthorized' }, { status: session ? 403 : 401 })
  }

  const body: unknown = await req.json().catch(() => null)
  if (body && typeof body === 'object' && 'type' in body && body.type === 'plan') {
    return NextResponse.json({ error: 'Import planu sprzedaży został wycofany. Importuj rzeczywiste obroty.' }, { status: 410 })
  }
  const parsed = ImportBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Niepoprawny format importu obrotów', details: parsed.error.flatten() }, { status: 400 })
  }

  const errors: { row: number; message: string }[] = []
  const entries: Array<{ year: number; month: number; costCenterId: string; channel: string; amount: number; asOfDate: string | null }> = []
  parsed.data.rows.forEach((row, index) => {
    const result = RevenueEntrySchema.safeParse({
      year: Number(row.rok),
      month: Number(row.miesiac),
      costCenterId: row.centrum_kosztow?.trim(),
      channel: row.kanal?.trim(),
      amount: parseRevenueAmount(row.kwota ?? ''),
      asOfDate: row.stan_na_dzien?.trim() || null,
    })
    if (!result.success) {
      errors.push({ row: index + 2, message: result.error.issues.map((issue) => issue.message).join('; ') })
      return
    }
    entries.push({ ...result.data, amount: Math.round(result.data.amount * 100) / 100, asOfDate: result.data.asOfDate ?? null })
  })

  if (entries.length > 0) {
    await prisma.$transaction(entries.map((entry) => prisma.revenue.upsert({
      where: { year_month_costCenterId_channel: { year: entry.year, month: entry.month, costCenterId: entry.costCenterId, channel: entry.channel } },
      update: { amount: entry.amount, asOfDate: entry.asOfDate },
      create: entry,
    })))
  }
  return NextResponse.json({ imported: entries.length, errors })
}
