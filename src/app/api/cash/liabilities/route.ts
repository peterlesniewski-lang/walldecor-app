import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCashAdmin } from '@/lib/cash/cash-access'

export async function GET() {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const entries = await prisma.cashLiabilitySnapshot.findMany({
    orderBy: { date: 'desc' },
    take: 10,
  })
  return NextResponse.json(entries)
}

const CreateSchema = z.object({
  amount: z.number().min(0),
  notes: z.string().max(500).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const parsed = CreateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid', details: parsed.error.flatten() }, { status: 400 })
  const snapshot = await prisma.cashLiabilitySnapshot.create({
    data: { ...parsed.data, createdBy: auth.session.user.name ?? auth.session.user.email ?? 'unknown' },
  })
  return NextResponse.json(snapshot)
}
