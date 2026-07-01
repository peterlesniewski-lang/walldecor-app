import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { BudgetGrid } from '@/components/shared/budget-grid'

interface PageProps {
  searchParams: Promise<{ year?: string; costCenterId?: string }>
}

export default async function CostAssumptionsPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { year: yearParam, costCenterId: costCenterParam } = await searchParams
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  const costCenterId = costCenterParam ?? 'GLOBAL'

  const categories = await prisma.accountCategory.findMany({
    orderBy: { order: 'asc' },
    include: { subCategories: { orderBy: { order: 'asc' } } },
  })

  const isGlobal = costCenterId === 'GLOBAL'
  const editable = session.user.role === 'ADMIN'
  const canManage = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'

  const rawEntries = await prisma.budgetEntry.findMany({
    where: isGlobal ? { year } : { year, costCenterId },
  })
  const initialEntries: Record<string, number> = {}
  for (const entry of rawEntries) {
    const key = `${entry.subCategoryId}_${entry.month}`
    initialEntries[key] = (initialEntries[key] ?? 0) + entry.amount
  }

  const rawRevenue = await prisma.revenue.findMany({
    where: isGlobal ? { year } : { year, costCenterId },
  })

  const revenueByMonth = new Array(12).fill(0) as number[]
  for (const row of rawRevenue) revenueByMonth[row.month - 1] += row.amount

  return (
    <BudgetGrid
      key={`assumptions-${year}-${costCenterId}`}
      categories={categories}
      initialEntries={initialEntries}
      year={year}
      costCenterId={costCenterId}
      editable={editable}
      canManage={canManage}
      revenueByMonth={revenueByMonth}
    />
  )
}
