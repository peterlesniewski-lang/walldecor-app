import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCashAdmin } from '@/lib/cash/cash-access'

export async function GET() {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const accounts = await prisma.cashAccount.findMany({
    where: { isActive: true },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json(accounts)
}

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  currency: z.enum(['PLN', 'EUR']),
  type: z.enum(['bank', 'cash']),
})

export async function POST(req: NextRequest) {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const parsed = CreateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid', details: parsed.error.flatten() }, { status: 400 })
  const maxOrder = await prisma.cashAccount.aggregate({ _max: { order: true } })
  const account = await prisma.cashAccount.create({
    data: { ...parsed.data, order: (maxOrder._max.order ?? -1) + 1 },
  })
  return NextResponse.json(account)
}
