import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceReportAccess } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { buildBreakEvenReport, buildCostWarningTotal } from '@/lib/finance/cost-reporting'
import { roundMoney } from '@/lib/finance/ksef-inbox'

export async function GET(req: NextRequest) {
  const auth = await requireFinanceReportAccess()
  if (auth.error) return auth.error

  const now = new Date()
  const year = Number(req.nextUrl.searchParams.get('year') ?? now.getFullYear())
  const month = Number(req.nextUrl.searchParams.get('month') ?? now.getMonth() + 1)

  const [events, revenue, margins, warningInvoices] = await Promise.all([
    prisma.costEvent.findMany({
      where: {
        status: 'APPROVED',
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

  const costRows = new Map<string, { costCenterId: string; fixedCosts: number; variableCosts: number; cogs: number }>()
  for (const event of events) {
    for (const part of event.parts) {
      const tagSlugs = part.tags.map((item) => item.tag.slug.toLowerCase())
      const bucket = tagSlugs.includes('cogs') ? 'cogs' : tagSlugs.includes('variable') ? 'variableCosts' : 'fixedCosts'
      for (const allocation of part.allocations) {
        const current = costRows.get(allocation.costCenterId) ?? { costCenterId: allocation.costCenterId, fixedCosts: 0, variableCosts: 0, cogs: 0 }
        current[bucket] = roundMoney(current[bucket] + part.grossAmount * allocation.percent / 100)
        costRows.set(allocation.costCenterId, current)
      }
    }
  }

  const contributionMargins: Record<string, number> = {}
  for (const setting of margins) {
    if (contributionMargins[setting.costCenterId] == null) {
      contributionMargins[setting.costCenterId] = setting.margin
    }
  }

  const report = buildBreakEvenReport({
    revenue: revenue.map((row) => ({ costCenterId: row.costCenterId, amount: row.amount })),
    allocatedCosts: [...costRows.values()],
    contributionMargins,
    warningAmount: buildCostWarningTotal(warningInvoices),
  })

  return NextResponse.json({ report, year, month })
}
