import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { COST_CENTER_CHANNELS } from '@/lib/validations/revenue'

const VALID_CHANNELS = ['SALON', 'MONTAZ', 'ECOMMERCE']
const VALID_COST_CENTERS = ['JAG', 'PUL'] // GLOBAL has no revenue channels

const CsvRowSchema = z.object({
  rok: z.coerce.number().int().min(2020).max(2100),
  miesiac: z.coerce.number().int().min(1).max(12),
  centrum_kosztow: z.string().refine((v) => VALID_COST_CENTERS.includes(v), {
    message: 'Centrum kosztów musi być JAG lub PUL',
  }),
  kanal: z.string().refine((v) => VALID_CHANNELS.includes(v), {
    message: 'Kanał musi być SALON, MONTAZ lub ECOMMERCE',
  }),
  kwota: z.coerce.number().min(0, 'Kwota nie może być ujemna'),
})

const ImportBodySchema = z.object({
  type: z.enum(['plan', 'actuals']),
  rows: z.array(z.record(z.string(), z.string())).min(1),
})

function resolveAuth(session: Session | null, type: string, apiKey: string | null): boolean {
  const validApiKey = process.env.IMPORT_API_KEY
  if (apiKey && validApiKey && apiKey === validApiKey) {
    return true
  }
  if (!session) return false
  if (type === 'plan') return session.user.role === 'ADMIN'
  return session.user.role === 'ADMIN'
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('X-Api-Key')
  const session = await getServerSession(authOptions)

  const body = await req.json()
  const parsed = ImportBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { type, rows } = parsed.data

  if (!resolveAuth(session, type, apiKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const errors: { row: number; message: string }[] = []
  const upserts: Array<{
    year: number
    month: number
    costCenterId: string
    channel: string
    amount: number
  }> = []

  for (let i = 0; i < rows.length; i++) {
    const rowParsed = CsvRowSchema.safeParse(rows[i])
    if (!rowParsed.success) {
      const msg = rowParsed.error.issues.map((e) => e.message).join('; ')
      errors.push({ row: i + 2, message: msg })
      continue
    }

    const { rok, miesiac, centrum_kosztow, kanal, kwota } = rowParsed.data

    // Validate channel is valid for cost center
    const allowedChannels = COST_CENTER_CHANNELS[centrum_kosztow] ?? []
    if (!allowedChannels.includes(kanal as 'SALON' | 'MONTAZ' | 'ECOMMERCE')) {
      errors.push({ row: i + 2, message: `Kanał ${kanal} niedostępny dla centrum ${centrum_kosztow}` })
      continue
    }

    upserts.push({ year: rok, month: miesiac, costCenterId: centrum_kosztow, channel: kanal, amount: Math.round(kwota * 100) / 100 })
  }

  if (upserts.length === 0) {
    return NextResponse.json({ imported: 0, errors })
  }

  if (type === 'plan') {
    await prisma.$transaction(
      upserts.map((u) =>
        prisma.revenueBudget.upsert({
          where: { year_month_costCenterId_channel: { year: u.year, month: u.month, costCenterId: u.costCenterId, channel: u.channel } },
          update: { amount: u.amount },
          create: u,
        })
      )
    )
  } else {
    await prisma.$transaction(
      upserts.map((u) =>
        prisma.revenue.upsert({
          where: { year_month_costCenterId_channel: { year: u.year, month: u.month, costCenterId: u.costCenterId, channel: u.channel } },
          update: { amount: u.amount },
          create: u,
        })
      )
    )
  }

  return NextResponse.json({ imported: upserts.length, errors })
}
