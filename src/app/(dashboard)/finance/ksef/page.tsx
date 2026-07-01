import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculatePaymentAgingBucket, type PaymentAgingBucket } from '@/lib/finance/cost-control'
import { roundMoney } from '@/lib/finance/ksef-inbox'
import { KsefInboxView, type KsefPaymentStatus, type KsefStatus } from '@/components/shared/ksef-inbox-view'

const INITIAL_PAGE = 1
const INITIAL_PAGE_SIZE = 50 as const
const PAYMENT_AGING_BUCKETS: PaymentAgingBucket[] = ['OVERDUE', 'DUE_0_7', 'DUE_8_14', 'DUE_15_30', 'LATER', 'MISSING_DUE_DATE']

export default async function KsefInboxPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/finance')

  const [invoices, total, amountRows, statusCounts, rules, costCenters, subCategories, costTagGroups] = await Promise.all([
    prisma.ksefInvoice.findMany({
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
        parts: {
          include: {
            tags: { include: { tag: true } },
            allocations: true,
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: [{ status: 'asc' }, { issueDate: 'desc' }, { invoiceNumber: 'asc' }],
      skip: (INITIAL_PAGE - 1) * INITIAL_PAGE_SIZE,
      take: INITIAL_PAGE_SIZE,
    }),
    prisma.ksefInvoice.count(),
    prisma.ksefInvoice.findMany({
      select: {
        grossAmount: true,
        reportingGrossAmount: true,
        paymentStatus: true,
        dueDate: true,
      },
    }),
    prisma.ksefInvoice.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ksefSupplierRule.findMany({
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
        tags: { include: { tag: true } },
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
    prisma.costTagGroup.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: {
        tags: {
          where: { active: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, slug: true },
        },
      },
    }),
  ])
  const counts: Record<KsefStatus, number> = { NEW: 0, MAPPED: 0, APPROVED: 0, IGNORED: 0 }
  for (const row of statusCounts) {
    counts[row.status as KsefStatus] = row._count._all
  }
  const paymentAging = Object.fromEntries(
    PAYMENT_AGING_BUCKETS.map((bucket) => [bucket, { count: 0, grossAmount: 0 }])
  ) as Record<PaymentAgingBucket, { count: number; grossAmount: number }>
  let grossAmountTotal = 0
  let unpaidAmountTotal = 0
  for (const invoice of amountRows) {
    const amount = roundMoney(invoice.reportingGrossAmount ?? invoice.grossAmount)
    grossAmountTotal = roundMoney(grossAmountTotal + amount)
    if (invoice.paymentStatus !== 'PAID') {
      unpaidAmountTotal = roundMoney(unpaidAmountTotal + amount)
      const bucket = calculatePaymentAgingBucket(invoice.dueDate)
      paymentAging[bucket].count += 1
      paymentAging[bucket].grossAmount = roundMoney(paymentAging[bucket].grossAmount + amount)
    }
  }

  return (
    <KsefInboxView
      initialInvoices={invoices.map((invoice) => ({
        ...invoice,
        status: invoice.status as KsefStatus,
        paymentStatus: invoice.paymentStatus as KsefPaymentStatus,
        issueDate: invoice.issueDate.toISOString(),
        paidAt: invoice.paidAt?.toISOString() ?? null,
        dueDate: invoice.dueDate?.toISOString() ?? null,
        convertedAt: invoice.convertedAt?.toISOString() ?? null,
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
      }))}
      initialTotal={total}
      initialGrossAmountTotal={grossAmountTotal}
      initialUnpaidAmountTotal={unpaidAmountTotal}
      initialPaymentAging={paymentAging}
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
      costTagGroups={costTagGroups.map((group) => ({
        id: group.id,
        name: group.name,
        slug: group.slug,
        tags: group.tags,
      }))}
    />
  )
}
