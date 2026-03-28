import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { budgetThresholdSchema } from '@/lib/validations/alerts'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const thresholds = await prisma.budgetThreshold.findMany({
    include: {
      costCenter: true,
      subCategory: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(thresholds)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = budgetThresholdSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { name, warningPercent, criticalPercent, costCenterId, subCategoryId, active } =
    parsed.data

  const threshold = await prisma.budgetThreshold.create({
    data: {
      name,
      warningPercent,
      criticalPercent,
      costCenterId: costCenterId ?? null,
      subCategoryId: subCategoryId ?? null,
      active: active ?? true,
    },
    include: {
      costCenter: true,
      subCategory: true,
    },
  })

  return NextResponse.json(threshold, { status: 201 })
}
