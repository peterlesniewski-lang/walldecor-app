import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin, requireFinanceReportAccess } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const auth = await requireFinanceReportAccess()
  if (auth.error) return auth.error

  const periods = await prisma.financePeriodClose.findMany({
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  })
  return NextResponse.json({ periods })
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const body = await req.json() as { year?: unknown; month?: unknown; note?: unknown }
  const year = Number(body.year)
  const month = Number(body.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
  }

  const period = await prisma.financePeriodClose.upsert({
    where: { year_month: { year, month } },
    update: {
      source: 'MANUAL',
      closedById: auth.session.user.id,
      closedAt: new Date(),
      note: typeof body.note === 'string' ? body.note : null,
    },
    create: {
      year,
      month,
      source: 'MANUAL',
      closedById: auth.session.user.id,
      note: typeof body.note === 'string' ? body.note : null,
    },
  })

  return NextResponse.json({ period })
}
