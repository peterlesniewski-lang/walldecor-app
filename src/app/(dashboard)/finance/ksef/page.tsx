import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { PaymentAgingBucket } from '@/lib/finance/cost-control'
import { sortCostTagGroupsForDisplay } from '@/lib/finance/cost-tags'
import { summarizeInvoicePayments } from '@/lib/finance/invoice-money'
import { isActiveInvoiceMoneyRow } from '@/lib/finance/invoice-money-scope'
import { KsefInboxView, type KsefPaymentStatus, type KsefStatus } from '@/components/shared/ksef-inbox-view'
import { INVOICE_IMPORT_LIST_SELECT, invoiceImportListSummary } from '@/lib/invoice-import/invoice-list-ksef-summary'

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
        invoiceImportDraft: { select: INVOICE_IMPORT_LIST_SELECT },
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
      orderBy: [{ issueDate: 'desc' }, { invoiceNumber: 'asc' }, { status: 'asc' }],
      skip: (INITIAL_PAGE - 1) * INITIAL_PAGE_SIZE,
      take: INITIAL_PAGE_SIZE,
    }),
    prisma.ksefInvoice.count(),
    prisma.ksefInvoice.findMany({
      select: {
        currency: true,
        grossAmount: true,
        reportingGrossAmount: true,
        paymentStatus: true,
        dueDate: true,
        documentStatus: true,
        invoiceImportDraft: { select: { state: true } },
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
  const paymentSummary = summarizeInvoicePayments(amountRows.filter(isActiveInvoiceMoneyRow))
  const paymentAging = Object.fromEntries(PAYMENT_AGING_BUCKETS.map((bucket) => [bucket, {
    ...paymentSummary.paymentAging[bucket],
    grossAmount: paymentSummary.paymentAging[bucket].plnAmount,
  }])) as Record<PaymentAgingBucket, typeof paymentSummary.paymentAging[PaymentAgingBucket] & { grossAmount: number }>

  return (
    <KsefInboxView
      initialInvoices={invoices.map((invoice) => ({
        ...invoice,
        invoiceImportDraft: invoiceImportListSummary(invoice.invoiceImportDraft),
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
      initialGrossAmountTotal={paymentSummary.gross.plnAmount}
      initialGrossAmountSummary={paymentSummary.gross}
      initialUnpaidAmountTotal={paymentSummary.unpaid.plnAmount}
      initialUnpaidAmountSummary={paymentSummary.unpaid}
      initialUnpaidCount={paymentSummary.unpaidCount}
      initialUncertainPaymentCount={paymentSummary.uncertainPaymentCount}
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
      costTagGroups={sortCostTagGroupsForDisplay(costTagGroups.map((group) => ({
        id: group.id,
        name: group.name,
        slug: group.slug,
        tags: group.tags,
      })))}
    />
  )
}
