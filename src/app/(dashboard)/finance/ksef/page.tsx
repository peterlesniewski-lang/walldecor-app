import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { KsefInboxView, type KsefStatus } from '@/components/shared/ksef-inbox-view'

const INITIAL_PAGE = 1
const INITIAL_PAGE_SIZE = 50 as const

export default async function KsefInboxPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/finance')

  const [invoices, total, grossAmountAggregate, statusCounts, rules, costCenters, subCategories] = await Promise.all([
    prisma.ksefInvoice.findMany({
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
      },
      orderBy: [{ status: 'asc' }, { issueDate: 'desc' }, { invoiceNumber: 'asc' }],
      skip: (INITIAL_PAGE - 1) * INITIAL_PAGE_SIZE,
      take: INITIAL_PAGE_SIZE,
    }),
    prisma.ksefInvoice.count(),
    prisma.ksefInvoice.aggregate({ _sum: { grossAmount: true } }),
    prisma.ksefInvoice.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ksefSupplierRule.findMany({
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
      },
      orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
    }),
    prisma.costCenter.findMany({
      where: { id: { in: ['JAG', 'PUL', 'GLOBAL'] } },
      orderBy: { id: 'asc' },
    }),
    prisma.subCategory.findMany({
      include: { category: true },
      orderBy: [{ category: { order: 'asc' } }, { order: 'asc' }],
    }),
  ])
  const counts: Record<KsefStatus, number> = { NEW: 0, MAPPED: 0, APPROVED: 0, IGNORED: 0 }
  for (const row of statusCounts) {
    counts[row.status as KsefStatus] = row._count._all
  }

  return (
    <KsefInboxView
      initialInvoices={invoices.map((invoice) => ({
        ...invoice,
        status: invoice.status as KsefStatus,
        issueDate: invoice.issueDate.toISOString(),
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
      }))}
      initialTotal={total}
      initialGrossAmountTotal={grossAmountAggregate._sum.grossAmount ?? 0}
      initialPage={INITIAL_PAGE}
      initialPageSize={INITIAL_PAGE_SIZE}
      initialTotalPages={Math.max(1, Math.ceil(total / INITIAL_PAGE_SIZE))}
      initialCounts={counts}
      initialRules={rules.map((rule) => ({
        ...rule,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      }))}
      costCenters={costCenters}
      subCategories={subCategories}
    />
  )
}
