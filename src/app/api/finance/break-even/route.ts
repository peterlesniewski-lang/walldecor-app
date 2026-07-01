import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceReportAccess } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { buildBreakEvenReport, buildCostWarningTotal } from '@/lib/finance/cost-reporting'
import { buildRealizedCostSummary } from '@/lib/finance/realized-costs'

function costEventMonthDateRange(year: number, month: number) {
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lt: new Date(Date.UTC(year, month, 1)),
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireFinanceReportAccess()
  if (auth.error) return auth.error

  const now = new Date()
  const year = Number(req.nextUrl.searchParams.get('year') ?? now.getFullYear())
  const month = Number(req.nextUrl.searchParams.get('month') ?? now.getMonth() + 1)

  const [actualCosts, costEvents, revenue, margins, warningInvoices] = await Promise.all([
    prisma.actualEntry.findMany({
      where: { year, month },
      include: { subCategory: { select: { isFixed: true } } },
    }),
    prisma.costEvent.findMany({
      where: {
        status: 'APPROVED',
        eventDate: costEventMonthDateRange(year, month),
        ...(auth.session.user.role !== 'ADMIN' ? { isConfidential: false } : {}),
      },
      include: {
        parts: {
          include: {
            tags: { include: { tag: true } },
            allocations: true,
          },
        },
      },
    }),
    prisma.revenue.findMany({
      where: { year, month, costCenterId: { in: ['JAG', 'PUL'] } },
    }),
    prisma.contributionMarginSetting.findMany({
      orderBy: [{ costCenterId: 'asc' }, { effectiveFrom: 'desc' }],
    }),
    prisma.ksefInvoice.findMany({
      select: { status: true, documentStatus: true, currency: true, grossAmount: true, reportingGrossAmount: true },
    }),
  ])

  const realizedCosts = buildRealizedCostSummary({
    year,
    actualEntries: actualCosts,
    costEvents,
  })

  const contributionMargins: Record<string, number> = {}
  for (const setting of margins) {
    if (contributionMargins[setting.costCenterId] == null) {
      contributionMargins[setting.costCenterId] = setting.margin
    }
  }

  const report = buildBreakEvenReport({
    revenue: revenue.map((row) => ({ costCenterId: row.costCenterId, amount: row.amount })),
    allocatedCosts: realizedCosts.breakEvenCostRows,
    contributionMargins,
    warningAmount: buildCostWarningTotal(warningInvoices),
  })

  return NextResponse.json({ report, year, month })
}
