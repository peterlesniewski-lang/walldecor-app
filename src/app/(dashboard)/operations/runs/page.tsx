import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { ListChecks } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { getRuns } from '@/lib/operations/queries'
import { RunsList } from '@/components/operations/runs-list'

export default async function OperationRunsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const runs = await getRuns({ id: session.user.id, role: session.user.role })

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
          <ListChecks className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Wykonania</h1>
          <p className="text-sm text-gray-500">Miesięczne i procesowe checklisty z historią realizacji.</p>
        </div>
      </div>
      <RunsList runs={runs} />
    </div>
  )
}
