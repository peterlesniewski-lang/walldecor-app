import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const VALID_COST_CENTERS = ['JAG', 'PUL', 'GLOBAL']

const CsvRowSchema = z.object({
  rok: z.coerce.number().int().min(2020).max(2100),
  miesiac: z.coerce.number().int().min(1).max(12),
  centrum_kosztow: z.string().refine((v) => VALID_COST_CENTERS.includes(v), {
    message: 'Centrum kosztów musi być JAG, PUL lub GLOBAL',
  }),
  kategoria: z.string().min(1),
  podkategoria: z.string().min(1),
  kwota: z.coerce.number().min(0, 'Kwota nie może być ujemna'),
})

const ImportBodySchema = z.object({
  type: z.enum(['budget', 'actuals']),
  rows: z.array(z.record(z.string(), z.string())).min(1),
})

function resolveAuth(session: Session | null, type: string, apiKey: string | null): boolean {
  const validApiKey = process.env.IMPORT_API_KEY
  if (apiKey && validApiKey && apiKey === validApiKey) {
    return true // API key auth — full access
  }
  if (!session) return false
  if (type === 'budget') return session.user.role === 'ADMIN'
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

  // Build lookup: "kategoria::podkategoria" -> subCategoryId
  const subCategories = await prisma.subCategory.findMany({ include: { category: true } })
  const subCatMap = new Map<string, string>()
  for (const sc of subCategories) {
    subCatMap.set(`${sc.category.name}::${sc.name}`, sc.id)
  }

  const errors: { row: number; message: string }[] = []
  const upserts: Array<{
    year: number
    month: number
    costCenterId: string
    subCategoryId: string
    amount: number
  }> = []

  for (let i = 0; i < rows.length; i++) {
    const rowParsed = CsvRowSchema.safeParse(rows[i])
    if (!rowParsed.success) {
      const msg = rowParsed.error.issues.map((e) => e.message).join('; ')
      errors.push({ row: i + 2, message: msg }) // +2: header is row 1
      continue
    }

    const { rok, miesiac, centrum_kosztow, kategoria, podkategoria, kwota } = rowParsed.data
    const subCategoryId = subCatMap.get(`${kategoria}::${podkategoria}`)
    if (!subCategoryId) {
      errors.push({ row: i + 2, message: `Nie znaleziono podkategorii: "${kategoria} / ${podkategoria}"` })
      continue
    }

    upserts.push({ year: rok, month: miesiac, costCenterId: centrum_kosztow, subCategoryId, amount: Math.round(kwota * 100) / 100 })
  }

  if (upserts.length === 0) {
    return NextResponse.json({ imported: 0, errors })
  }

  if (type === 'budget') {
    await prisma.$transaction(
      upserts.map((u) =>
        prisma.budgetEntry.upsert({
          where: { year_month_costCenterId_subCategoryId: { year: u.year, month: u.month, costCenterId: u.costCenterId, subCategoryId: u.subCategoryId } },
          update: { amount: u.amount },
          create: u,
        })
      )
    )
  } else {
    await prisma.$transaction(
      upserts.map((u) =>
        prisma.actualEntry.upsert({
          where: { year_month_costCenterId_subCategoryId: { year: u.year, month: u.month, costCenterId: u.costCenterId, subCategoryId: u.subCategoryId } },
          update: { amount: u.amount },
          create: u,
        })
      )
    )
  }

  return NextResponse.json({ imported: upserts.length, errors })
}
