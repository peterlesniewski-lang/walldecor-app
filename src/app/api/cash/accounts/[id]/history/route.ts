import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCashAdmin } from '@/lib/cash/cash-access'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const { id } = await params
  const history = await prisma.cashBalanceHistory.findMany({
    where: { accountId: id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return NextResponse.json(history)
}
