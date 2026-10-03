import Link from 'next/link'
import { CalendarCheck, CircleAlert } from 'lucide-react'
import { ProgressBar } from './progress-bar'
import { RunStatusButton } from './run-status-button'
import { StatusBadge } from './status-badge'

interface RunListItem {
  id: string
  name: string
  status: string
  nextItemTitle: string | null
  readyToClose: boolean
  template: {
    module: {
      name: string
      area: { name: string }
    }
  }
  progress: {
    total: number
    done: number
    blocked: number
    percent: number
  }
}

function RunCard({ run, canManage }: { run: RunListItem; canManage: boolean }) {
  const isOpen = run.status === 'open'

  return (
    <div className="relative rounded-xl border bg-white p-4 transition hover:border-gray-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-gray-500" />
            <h3 className="font-semibold text-gray-900">
              <Link href={`/operations/runs/${run.id}`} className="after:absolute after:inset-0">
                {run.name}
              </Link>
            </h3>
            <StatusBadge status={isOpen && run.readyToClose ? 'ready' : run.status} />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {run.template.module.area.name} / {run.template.module.name}
          </p>
          {isOpen && run.nextItemTitle && (
            <p className="mt-1 text-xs text-gray-600">
              Następne: <span className="font-medium text-gray-900">{run.nextItemTitle}</span>
            </p>
          )}
        </div>
        {run.progress.blocked > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
            <CircleAlert className="h-3.5 w-3.5" />
            {run.progress.blocked} bloker
          </span>
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <ProgressBar percent={run.progress.percent} />
        <span className="shrink-0 text-xs font-medium text-gray-500">
          {run.progress.done}/{run.progress.total}
        </span>
      </div>
      {canManage && isOpen && run.readyToClose && (
        <div className="relative z-10 mt-3">
          <RunStatusButton runId={run.id} nextStatus="closed" primary>
            Zamknij miesiąc
          </RunStatusButton>
        </div>
      )}
    </div>
  )
}

function RunSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <div className="grid gap-3">{children}</div>
    </section>
  )
}

export function RunsList({ runs, canManage }: { runs: RunListItem[]; canManage: boolean }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-8 text-sm text-gray-500">
        Brak wykonań. Użyj przycisku „Rozpocznij miesiąc”, żeby zacząć pierwsze zamknięcie.
      </div>
    )
  }

  const active = runs.filter((run) => run.status === 'open')
  const closed = runs.filter((run) => run.status !== 'open')

  return (
    <div className="grid gap-8">
      {active.length > 0 && (
        <RunSection title="Do zrobienia">
          {active.map((run) => (
            <RunCard key={run.id} run={run} canManage={canManage} />
          ))}
        </RunSection>
      )}
      {closed.length > 0 && (
        <RunSection title="Zamknięte">
          {closed.map((run) => (
            <div key={run.id} className="opacity-75">
              <RunCard run={run} canManage={canManage} />
            </div>
          ))}
        </RunSection>
      )}
    </div>
  )
}
