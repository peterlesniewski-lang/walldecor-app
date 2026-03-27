import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const history = await prisma.cashBalanceHistory.findMany({
    where: { accountId: id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return NextResponse.json(history)
}
