import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { RevenueTabs } from '@/components/shared/revenue-tabs'
import { revenueWarsawToday } from '@/lib/validations/revenue'

interface PageProps {
  searchParams: Promise<{ year?: string; costCenterId?: string; tab?: string }>
}

export default async function RevenuePage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/finance')

  const { year: yearParam, costCenterId: centerParam } = await searchParams
  const requestedYear = Number(yearParam)
  const year = Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= 2100
    ? requestedYear : Number(revenueWarsawToday().slice(0, 4))
  const costCenterId = centerParam === 'JAG' || centerParam === 'PUL' ? centerParam : 'GLOBAL'
  const isCompany = costCenterId === 'GLOBAL'
  const entries = await prisma.revenue.findMany({
    where: isCompany ? { year } : { year, costCenterId },
    orderBy: [{ month: 'asc' }, { costCenterId: 'asc' }, { channel: 'asc' }],
    select: { year: true, month: true, costCenterId: true, channel: true, amount: true, asOfDate: true },
  })

  return (
    <RevenueTabs
      entries={entries}
      year={year}
      costCenterId={costCenterId}
      editable={session.user.role === 'ADMIN' && !isCompany}
    />
  )
}
