import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sortCostTagGroupsForDisplay } from '@/lib/finance/cost-tags'
import { buildAreaProfitabilityReport } from '@/lib/finance/area-profitability'
import { costEventYearDateRange } from '@/lib/finance/realized-costs'
import { AreaProfitabilityView } from '@/components/shared/area-profitability-view'

interface PageProps {
  searchParams: Promise<{ year?: string; costCenterId?: string }>
}

function normalizeCostCenterId(value: string | undefined) {
  return value === 'JAG' || value === 'PUL' ? value : 'COMPANY'
}

export default async function AreaProfitabilityPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) redirect('/finance')

  const { year: yearParam, costCenterId: costCenterParam } = await searchParams
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  const selectedCostCenterId = normalizeCostCenterId(costCenterParam)

  const [areaGroup, areaRevenues, costEvents, costCenters] = await Promise.all([
    prisma.costTagGroup.findUnique({
      where: { slug: 'area' },
      include: {
        tags: {
          where: { active: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, slug: true },
        },
      },
    }),
    prisma.areaRevenue.findMany({
      where: {
        year,
        ...(selectedCostCenterId === 'COMPANY' ? {} : { costCenterId: selectedCostCenterId }),
      },
    }),
    prisma.costEvent.findMany({
      where: {
        status: 'APPROVED',
        eventDate: costEventYearDateRange(year),
        ...(session.user.role !== 'ADMIN' ? { isConfidential: false } : {}),
        ...(selectedCostCenterId === 'COMPANY'
          ? {}
          : { parts: { some: { allocations: { some: { costCenterId: selectedCostCenterId } } } } }),
      },
      include: {
        parts: {
          include: {
            tags: { include: { tag: { include: { group: true } } } },
            allocations: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    }),
    prisma.costCenter.findMany({
      where: { id: { in: ['JAG', 'PUL'] } },
      orderBy: { id: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  const sortedAreaGroups = areaGroup
    ? sortCostTagGroupsForDisplay([areaGroup]) as Array<{ tags: Array<{ id: string; slug: string; name: string }> }>
    : []
  const areaTags = sortedAreaGroups
    .flatMap((group) => group.tags)
    .map((tag) => ({ id: tag.id, slug: tag.slug, name: tag.name }))
  const report = buildAreaProfitabilityReport({
    year,
    costCenterId: selectedCostCenterId,
    areaTags,
    revenues: areaRevenues,
    costEvents,
  })

  return (
    <AreaProfitabilityView
      year={year}
      selectedCostCenterId={selectedCostCenterId}
      role={session.user.role ?? 'EMPLOYEE'}
      report={report}
      areaTags={areaTags}
      costCenters={costCenters}
      revenueEntries={areaRevenues}
    />
  )
}
