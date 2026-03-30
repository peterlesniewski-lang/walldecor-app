import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ActualsGrid } from '@/components/shared/actuals-grid'

interface PageProps {
  searchParams: Promise<{ year?: string; costCenterId?: string }>
}

export default async function ActualsPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { year: yearParam, costCenterId: ccParam } = await searchParams
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  const costCenterId = ccParam ?? 'GLOBAL'
  const isGlobal = costCenterId === 'GLOBAL'
  const where = isGlobal ? { year } : { year, costCenterId }

  const categories = await prisma.accountCategory.findMany({
    orderBy: { order: 'asc' },
    include: { subCategories: { orderBy: { order: 'asc' } } },
  })

  const [rawBudget, rawActuals] = await Promise.all([
    prisma.budgetEntry.findMany({ where }),
    prisma.actualEntry.findMany({ where }),
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

  const editable = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'

  return (
    <ActualsGrid
      key={`actuals-${year}-${costCenterId}`}
      categories={categories}
      budgetEntries={budgetEntries}
      initialActuals={initialActuals}
      year={year}
      costCenterId={costCenterId}
      editable={editable}
    />
  )
}
