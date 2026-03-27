import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { BudgetGrid } from '@/components/shared/budget-grid'
import { ActualsGrid } from '@/components/shared/actuals-grid'
import { FinanceTabSwitcher } from '@/components/shared/finance-tab-switcher'

interface PageProps {
  searchParams: Promise<{ year?: string; costCenterId?: string; tab?: string }>
}

export default async function FinancePage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { year: yearParam, costCenterId: costCenterParam, tab: tabParam } = await searchParams
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  const costCenterId = costCenterParam ?? 'GLOBAL'
  const tab = tabParam === 'actuals' ? 'actuals' : 'plan'

  const categories = await prisma.accountCategory.findMany({
    orderBy: { order: 'asc' },
    include: { subCategories: { orderBy: { order: 'asc' } } },
  })

  const isGlobal = costCenterId === 'GLOBAL'
  const editable = session.user.role === 'ADMIN' && !isGlobal
  const canManage = (session.user.role === 'ADMIN' || session.user.role === 'MANAGER') && !isGlobal

  if (tab === 'actuals') {
    const [rawBudget, rawActuals] = await Promise.all([
      prisma.budgetEntry.findMany({ where: isGlobal ? { year } : { year, costCenterId } }),
      prisma.actualEntry.findMany({ where: isGlobal ? { year } : { year, costCenterId } }),
    ])

    const budgetEntries: Record<string, number> = {}
    for (const e of rawBudget) {
      const key = `${e.subCategoryId}_${e.month}`
      budgetEntries[key] = (budgetEntries[key] ?? 0) + e.amount
    }

    const initialActuals: Record<string, number> = {}
    for (const e of rawActuals) {
      const key = `${e.subCategoryId}_${e.month}`
      initialActuals[key] = (initialActuals[key] ?? 0) + e.amount
    }

    return (
      <div>
        <FinanceTabSwitcher activeTab="actuals" year={year} costCenterId={costCenterId} />
        <ActualsGrid
          key={`actuals-${year}-${costCenterId}`}
          categories={categories}
          budgetEntries={budgetEntries}
          initialActuals={initialActuals}
          year={year}
          costCenterId={costCenterId}
          editable={canManage}
          basePath="/finance?tab=actuals"
        />
      </div>
    )
  }

  const rawEntries = await prisma.budgetEntry.findMany({ where: isGlobal ? { year } : { year, costCenterId } })
  const initialEntries: Record<string, number> = {}
  for (const entry of rawEntries) {
    const key = `${entry.subCategoryId}_${entry.month}`
    initialEntries[key] = (initialEntries[key] ?? 0) + entry.amount
  }

  return (
    <div>
      <FinanceTabSwitcher activeTab="plan" year={year} costCenterId={costCenterId} />
      <BudgetGrid
        key={`budget-${year}-${costCenterId}`}
        categories={categories}
        initialEntries={initialEntries}
        year={year}
        costCenterId={costCenterId}
        editable={editable}
        canManage={canManage}
      />
    </div>
  )
}
