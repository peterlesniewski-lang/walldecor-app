import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = CreateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid', details: parsed.error.flatten() }, { status: 400 })
  const snapshot = await prisma.cashLiabilitySnapshot.create({
    data: { ...parsed.data, createdBy: session.user.name ?? session.user.email ?? 'unknown' },
  })
  return NextResponse.json(snapshot)
}
