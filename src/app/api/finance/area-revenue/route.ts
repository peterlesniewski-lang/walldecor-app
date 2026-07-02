import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceReportAccess } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { AreaRevenueEntrySchema } from '@/lib/validations/revenue'
import { roundMoney } from '@/lib/finance/ksef-inbox'

export async function GET(req: NextRequest) {
  const auth = await requireFinanceReportAccess()
  if (auth.error) return auth.error

  const year = Number(req.nextUrl.searchParams.get('year') ?? new Date().getFullYear())
  const costCenterId = req.nextUrl.searchParams.get('costCenterId')?.trim()

  const entries = await prisma.areaRevenue.findMany({
    where: {
      year,
      ...(costCenterId === 'JAG' || costCenterId === 'PUL' ? { costCenterId } : {}),
    },
    orderBy: [{ areaTag: { name: 'asc' } }, { month: 'asc' }],
  })

  return NextResponse.json({ entries })
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceReportAccess()
  if (auth.error) return auth.error

  const parsed = AreaRevenueEntrySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid data', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const areaTag = await prisma.costTag.findFirst({
    where: {
      id: data.areaTagId,
      active: true,
      group: { slug: 'area' },
    },
    select: { id: true },
  })

  if (!areaTag) {
    return NextResponse.json({ error: 'Wybrany tag nie jest aktywnym obszarem.' }, { status: 400 })
  }

  const entry = await prisma.areaRevenue.upsert({
    where: {
      year_month_costCenterId_areaTagId: {
        year: data.year,
        month: data.month,
        costCenterId: data.costCenterId,
        areaTagId: data.areaTagId,
      },
    },
    update: { amount: roundMoney(data.amount) },
    create: {
      year: data.year,
      month: data.month,
      costCenterId: data.costCenterId,
      areaTagId: data.areaTagId,
      amount: roundMoney(data.amount),
    },
  })

  return NextResponse.json({ entry })
}
