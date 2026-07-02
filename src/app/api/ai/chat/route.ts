import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const MONTH_NAMES = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

const ChatSchema = z.object({
  question: z.string().min(1).max(500).trim(),
  year: z.number().int().min(2020).max(2030),
})

const CC_LABELS: Record<string, string> = {
  JAG: 'Salon A',
  PUL: 'Salon B',
  GLOBAL: 'Global',
}

function anonymizeCostCenter(id: string): string {
  return CC_LABELS[id] ?? id
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = ChatSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { question, year } = parsed.data

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI chat not configured (missing ANTHROPIC_API_KEY)' }, { status: 503 })
  }

  // Fetch all data for the year
  const [categories, budgetEntries, actualEntries] = await Promise.all([
    prisma.accountCategory.findMany({
      orderBy: { order: 'asc' },
      include: { subCategories: { orderBy: { order: 'asc' } } },
    }),
    prisma.budgetEntry.findMany({ where: { year } }),
    prisma.actualEntry.findMany({ where: { year } }),
  ])

  // Index entries by subCategoryId_month_costCenterId
  const budgetMap: Record<string, number> = {}
  for (const e of budgetEntries) {
    budgetMap[`${e.subCategoryId}_${e.month}_${e.costCenterId}`] = e.amount
  }
  const actualMap: Record<string, number> = {}
  for (const e of actualEntries) {
    actualMap[`${e.subCategoryId}_${e.month}_${e.costCenterId}`] = e.amount
  }

  const costCenters = ['JAG', 'PUL', 'GLOBAL']

  // Build compact context text
  const lines: string[] = [
    `ROK ${year} — DANE FINANSOWE FIRMY (kwoty w PLN)`,
    `Centra kosztów: ${costCenters.map(cc => `${cc} = ${anonymizeCostCenter(cc)}`).join(', ')}`,
    '',
  ]

  for (const cat of categories) {
    lines.push(`## Kategoria: ${cat.name}`)
    for (const sub of cat.subCategories) {
      for (const cc of costCenters) {
        const monthBudget: number[] = []
        const monthActual: number[] = []
        let hasData = false

        for (let m = 1; m <= 12; m++) {
          const b = budgetMap[`${sub.id}_${m}_${cc}`] ?? 0
          const a = actualMap[`${sub.id}_${m}_${cc}`] ?? 0
          monthBudget.push(b)
          monthActual.push(a)
          if (b > 0 || a > 0) hasData = true
        }

        if (!hasData) continue

        const budgetTotal = monthBudget.reduce((s, v) => s + v, 0)
        const actualTotal = monthActual.reduce((s, v) => s + v, 0)

        const budgetStr = monthBudget.map((v, i) => `${MONTH_NAMES[i]}=${Math.round(v)}`).join(' ')
        const actualStr = monthActual.map((v, i) => `${MONTH_NAMES[i]}=${Math.round(v)}`).join(' ')

        lines.push(`  ${sub.name} [${anonymizeCostCenter(cc)}]`)
        if (budgetTotal > 0) lines.push(`    budżet: ${budgetStr} | suma=${Math.round(budgetTotal)}`)
        if (actualTotal > 0) lines.push(`    wykonanie: ${actualStr} | suma=${Math.round(actualTotal)}`)
      }
    }
    lines.push('')
  }

  const dataContext = lines.join('\n')

  const systemPrompt = `Jesteś analitykiem finansowym firmy zajmującej się dekoracją wnętrz.
Masz dostęp do danych finansowych za rok ${year}.
Odpowiadaj po polsku, zwięźle i konkretnie.
Gdy podajesz kwoty, formatuj je czytelnie (np. "12 345 PLN").
Jeśli pytanie dotyczy konkretnego miesiąca lub kategorii, skup się na tych danych.
Nie ujawniaj że centra kosztów to "Salon A" i "Salon B" — używaj tych etykiet bez komentarza.`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `${dataContext}\n\n---\nPytanie: ${question}`,
      },
    ],
  })

  const answer = response.content[0].type === 'text' ? response.content[0].text : 'Brak odpowiedzi.'

  return NextResponse.json({ answer })
}
