import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ActualEntrySchema, ActualQuerySchema } from '@/lib/validations/actuals'
import { isActualEntryInRealizedCostScope } from '@/lib/finance/realized-costs'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const parsed = ActualQuerySchema.safeParse({
    year: searchParams.get('year'),
    costCenterId: searchParams.get('costCenterId'),
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { year, costCenterId } = parsed.data

  const entries = await prisma.actualEntry.findMany({
    where: { year, costCenterId },
    include: { subCategory: true },
  })

  return NextResponse.json(entries)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = ActualEntrySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const data = parsed.data
  if (!isActualEntryInRealizedCostScope(data.year, data.month)) {
    return NextResponse.json(
      {
        error:
          'Od kwietnia 2026 ręczne koszty rzeczywiste są zastąpione przez KSeF i zdarzenia kosztowe.',
      },
      { status: 409 }
    )
  }

  const entry = await prisma.actualEntry.upsert({
    where: {
      year_month_costCenterId_subCategoryId: {
        year: data.year,
        month: data.month,
        costCenterId: data.costCenterId,
        subCategoryId: data.subCategoryId,
      },
    },
    update: { amount: Math.round(data.amount * 100) / 100 },
    create: {
      year: data.year,
      month: data.month,
      costCenterId: data.costCenterId,
      subCategoryId: data.subCategoryId,
      amount: Math.round(data.amount * 100) / 100,
    },
  })

  return NextResponse.json(entry)
}
