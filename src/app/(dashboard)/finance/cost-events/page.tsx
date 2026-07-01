import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/finance/ksef-inbox'
import { CostEventsView } from '@/components/shared/cost-events-view'

export default async function CostEventsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) redirect('/finance')

  const [events, costCenters, costTagGroups] = await Promise.all([
    prisma.costEvent.findMany({
      where: {
        status: 'APPROVED',
        ...(session.user.role !== 'ADMIN' ? { isConfidential: false } : {}),
      },
      include: {
        parts: {
          include: {
            tags: { include: { tag: true } },
            allocations: true,
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    }),
    prisma.costCenter.findMany({
      where: { id: { in: ['JAG', 'PUL', 'GLOBAL'] } },
      orderBy: { id: 'asc' },
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

  return (
    <CostEventsView
      role={session.user.role ?? 'EMPLOYEE'}
      initialEvents={events.map((event) => ({
        ...event,
        eventDate: event.eventDate.toISOString(),
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
      }))}
      initialTotalGrossAmount={roundMoney(events.reduce((sum, event) => sum + event.grossAmount, 0))}
      costCenters={costCenters}
      costTagGroups={costTagGroups}
    />
  )
}
