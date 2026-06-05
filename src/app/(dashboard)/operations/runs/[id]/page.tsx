import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getRun } from '@/lib/operations/queries'
import { RunDetailClient } from '@/components/operations/run-detail-client'

export default async function OperationRunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const run = await getRun(id)
  if (!run) notFound()

  const visibleItems =
    session.user.role === 'EMPLOYEE' ? run.items.filter((item) => item.ownerId === session.user.id) : run.items
  const canEditPeriod = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'

  return (
    <div className="mx-auto max-w-7xl p-6">
      <RunDetailClient
        initialRun={{
          id: run.id,
          name: run.name,
          status: run.status,
          periodYear: run.periodYear,
          periodMonth: run.periodMonth,
          canEditPeriod,
          template: run.template,
          progress: run.progress,
          items: visibleItems.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            order: item.order,
            procedureId: item.procedureId,
            ownerId: item.ownerId,
            status: item.status,
            note: item.note,
          })),
          procedures: run.procedures.map((procedure) => ({
            id: procedure.id,
            title: procedure.title,
            content: procedure.content,
          })),
        }}
      />
    </div>
  )
}
