import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const QuerySchema = z.object({
  type: z.enum(['budget', 'actuals']),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  costCenterId: z.string().min(1),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const parsed = QuerySchema.safeParse({
    type: searchParams.get('type'),
    year: searchParams.get('year'),
    month: searchParams.get('month'),
    costCenterId: searchParams.get('costCenterId'),
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.flatten() }, { status: 400 })
  }

  const { type, year, month, costCenterId } = parsed.data

  // Auth check
  if (type === 'budget' && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (type === 'actuals' && !['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Compute previous month
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year

  if (type === 'budget') {
    const prevEntries = await prisma.budgetEntry.findMany({
      where: { year: prevYear, month: prevMonth, costCenterId },
    })

    if (prevEntries.length === 0) {
      return NextResponse.json({ copied: 0 })
    }

    await prisma.$transaction(
      prevEntries.map((e) =>
        prisma.budgetEntry.upsert({
          where: {
            year_month_costCenterId_subCategoryId: {
              year,
              month,
              costCenterId,
              subCategoryId: e.subCategoryId,
            },
          },
          update: { amount: e.amount },
          create: {
            year,
            month,
            costCenterId,
            subCategoryId: e.subCategoryId,
            amount: e.amount,
          },
        })
      )
    )

    return NextResponse.json({ copied: prevEntries.length })
  } else {
    const prevEntries = await prisma.actualEntry.findMany({
      where: { year: prevYear, month: prevMonth, costCenterId },
    })

    if (prevEntries.length === 0) {
      return NextResponse.json({ copied: 0 })
    }

    await prisma.$transaction(
      prevEntries.map((e) =>
        prisma.actualEntry.upsert({
          where: {
            year_month_costCenterId_subCategoryId: {
              year,
              month,
              costCenterId,
              subCategoryId: e.subCategoryId,
            },
          },
          update: { amount: e.amount },
          create: {
            year,
            month,
            costCenterId,
            subCategoryId: e.subCategoryId,
            amount: e.amount,
          },
        })
      )
    )

    return NextResponse.json({ copied: prevEntries.length })
  }
}
