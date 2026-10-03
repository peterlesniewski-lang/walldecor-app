import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { ListChecks } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { getDefaultRunTemplateId, getRuns } from '@/lib/operations/queries'
import { findRunForPeriod, getPreviousMonthPeriod } from '@/lib/operations/run-factory'
import { RunsList } from '@/components/operations/runs-list'
import { StartMonthBanner } from '@/components/operations/start-month-banner'
import { StartRunButton } from '@/components/operations/start-run-button'

export default async function OperationRunsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const canManage = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'
  const runs = await getRuns({ id: session.user.id, role: session.user.role })
  const templateId = canManage ? await getDefaultRunTemplateId() : null
  const previousPeriod = getPreviousMonthPeriod()
  const previousMonthMissing =
    templateId !== null && findRunForPeriod(runs, templateId, previousPeriod) === undefined

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
            <ListChecks className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Zamknięcie miesiąca</h1>
            <p className="text-sm text-gray-500">Checklista dla księgowości — co miesiąc.</p>
          </div>
        </div>
        {templateId && <StartRunButton templateId={templateId} label="+ Rozpocznij miesiąc" />}
      </div>

      {previousMonthMissing && templateId && (
        <StartMonthBanner
          templateId={templateId}
          periodYear={previousPeriod.periodYear}
          periodMonth={previousPeriod.periodMonth}
        />
      )}

      <RunsList runs={runs} canManage={canManage} />
    </div>
  )
}
