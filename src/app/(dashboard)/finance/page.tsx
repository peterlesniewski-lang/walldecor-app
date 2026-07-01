import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CompanyHealthView } from '@/components/shared/company-health-view'
import { buildCompanyHealth, type FinanceCostCenterId } from '@/lib/finance/company-health'
import { buildCostWarningTotal } from '@/lib/finance/cost-reporting'
import { roundMoney } from '@/lib/finance/ksef-inbox'

interface PageProps {
  searchParams: Promise<{ year?: string; costCenterId?: string }>
}

export default async function FinancePage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = session.user.role ?? 'EMPLOYEE'
  const isAdmin = role === 'ADMIN'
  const canViewCostReports = isAdmin || role === 'MANAGER'
  const { year: yearParam } = await searchParams
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  const currentMonth = year === new Date().getFullYear() ? new Date().getMonth() + 1 : 12

  const [revenueActuals, actualCosts, cashAccounts, ksefInboxCount, unpaidInvoices, warningInvoices] = await Promise.all([
    prisma.revenue.findMany({ where: { year } }),
    prisma.actualEntry.findMany({ where: { year } }),
    prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
    isAdmin
      ? prisma.ksefInvoice.count({ where: { status: { in: ['NEW', 'MAPPED'] } } })
      : Promise.resolve(0),
    isAdmin
      ? prisma.ksefInvoice.findMany({
          where: { paymentStatus: 'UNPAID' },
          select: { grossAmount: true, reportingGrossAmount: true },
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
          },
        })
      : Promise.resolve([]),
  ])

  const health = buildCompanyHealth({
    year,
    currentMonth,
    revenue: revenueActuals.map((entry) => ({
      costCenterId: entry.costCenterId as FinanceCostCenterId,
      month: entry.month,
      amount: entry.amount,
    })),
    expenses: actualCosts.map((entry) => ({
      costCenterId: entry.costCenterId as FinanceCostCenterId,
      month: entry.month,
      amount: entry.amount,
    })),
  })

  const cashByCurrency = Object.values(
    cashAccounts.reduce<Record<string, { currency: string; amount: number }>>((acc, account) => {
      acc[account.currency] ??= { currency: account.currency, amount: 0 }
      acc[account.currency].amount += account.balance
      return acc
    }, {})
  )
  const unpaidInvoiceAmount = roundMoney(
    unpaidInvoices.reduce((sum, invoice) => sum + (invoice.reportingGrossAmount ?? invoice.grossAmount), 0)
  )
  const unclassifiedWarningAmount = canViewCostReports ? buildCostWarningTotal(warningInvoices) : 0

  return (
    <CompanyHealthView
      role={role}
      health={health}
      cashByCurrency={cashByCurrency}
      ksefInboxCount={ksefInboxCount}
      unpaidInvoiceAmount={unpaidInvoiceAmount}
      unclassifiedWarningAmount={unclassifiedWarningAmount}
    />
  )
}
