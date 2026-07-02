import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCashAdmin } from '@/lib/cash/cash-access'

export async function GET() {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const entries = await prisma.receivableEntry.findMany({ orderBy: { dueDate: 'asc' } })
  return NextResponse.json(entries)
}

const CreateSchema = z.object({
  clientName: z.string().max(200).optional(),
  amount: z.number().positive(),
  dueDate: z.string().datetime(),
  status: z.enum(['PENDING', 'REMINDER_SENT', 'COLLECTION']).default('PENDING'),
  notes: z.string().max(500).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const parsed = CreateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid', details: parsed.error.flatten() }, { status: 400 })
  const entry = await prisma.receivableEntry.create({ data: { ...parsed.data, dueDate: new Date(parsed.data.dueDate) } })
  return NextResponse.json(entry)
}
