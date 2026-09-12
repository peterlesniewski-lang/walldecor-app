import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CompanyHealthView } from '@/components/shared/company-health-view'
import { buildCompanyHealth, type FinanceCostCenterId } from '@/lib/finance/company-health'
import { buildCostWarningSummary } from '@/lib/finance/cost-reporting'
import { buildRealizedCostSummary, costEventYearDateRange } from '@/lib/finance/realized-costs'
import { summarizeInvoicePayments } from '@/lib/finance/invoice-money'
import { isActiveInvoiceMoneyRow } from '@/lib/finance/invoice-money-scope'

interface PageProps {
  searchParams: Promise<{ year?: string; costCenterId?: string }>
}

export default async function FinancePage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = session.user.role ?? 'EMPLOYEE'
  const isAdmin = role === 'ADMIN'
  const canViewCostReports = isAdmin
  const { year: yearParam } = await searchParams
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  const currentMonth = year === new Date().getFullYear() ? new Date().getMonth() + 1 : 12

  const [revenueActuals, actualCosts, costEvents, cashAccounts, ksefInboxCount, unpaidInvoices, warningInvoices] = await Promise.all([
    prisma.revenue.findMany({ where: { year } }),
    prisma.actualEntry.findMany({
      where: { year },
      include: { subCategory: { select: { isFixed: true } } },
    }),
    prisma.costEvent.findMany({
      where: {
        status: 'APPROVED',
        eventDate: costEventYearDateRange(year),
        ...(!isAdmin ? { isConfidential: false } : {}),
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
    isAdmin
      ? prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } })
      : Promise.resolve([]),
    isAdmin
      ? prisma.ksefInvoice.count({ where: {
          status: { in: ['NEW', 'MAPPED'] }, invoiceImportDraft: { is: null },
        } })
      : Promise.resolve(0),
    isAdmin
      ? prisma.ksefInvoice.findMany({
          where: { paymentStatus: { not: 'PAID' } },
          select: {
            currency: true,
            grossAmount: true,
            reportingGrossAmount: true,
            paymentStatus: true,
            dueDate: true,
            documentStatus: true,
            invoiceImportDraft: { select: { state: true } },
          },
        })
      : Promise.resolve([]),
    canViewCostReports
      ? prisma.ksefInvoice.findMany({
          select: {
            status: true,
            documentStatus: true,
            currency: true,
            grossAmount: true,
            reportingGrossAmount: true,
            invoiceImportDraft: { select: { state: true } },
          },
        })
      : Promise.resolve([]),
  ])

  const realizedCosts = buildRealizedCostSummary({
    year,
    actualEntries: actualCosts,
    costEvents,
  })

  const health = buildCompanyHealth({
    year,
    currentMonth,
    revenue: revenueActuals.map((entry) => ({
      costCenterId: entry.costCenterId as FinanceCostCenterId,
      month: entry.month,
      amount: entry.amount,
    })),
    expenses: realizedCosts.monthlyRows,
  })

  const cashByCurrency = Object.values(
    cashAccounts.reduce<Record<string, { currency: string; amount: number }>>((acc, account) => {
      acc[account.currency] ??= { currency: account.currency, amount: 0 }
      acc[account.currency].amount += account.balance
      return acc
    }, {})
  )
  const unpaidSummary = summarizeInvoicePayments(unpaidInvoices.filter(isActiveInvoiceMoneyRow))
  const warningSummary = canViewCostReports
    ? buildCostWarningSummary(warningInvoices.filter(isActiveInvoiceMoneyRow))
    : { plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] }

  return (
    <CompanyHealthView
      role={role === 'INSTALLER' ? 'EMPLOYEE' : role}
      health={health}
      cashByCurrency={cashByCurrency}
      ksefInboxCount={ksefInboxCount}
      unpaidInvoiceAmount={unpaidSummary.unpaid.plnAmount}
      unpaidInvoiceSummary={unpaidSummary.unpaid}
      unpaidInvoiceCount={unpaidSummary.unpaidCount}
      uncertainPaymentCount={unpaidSummary.uncertainPaymentCount}
      unclassifiedWarningAmount={warningSummary.plnAmount}
      unclassifiedWarningSummary={warningSummary}
    />
  )
}
