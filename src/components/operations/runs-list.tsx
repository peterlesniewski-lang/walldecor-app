import Link from 'next/link'
import { CalendarCheck, CircleAlert } from 'lucide-react'
import { ProgressBar } from './progress-bar'
import { StatusBadge } from './status-badge'

interface RunListItem {
  id: string
  name: string
  status: string
  periodYear: number
  periodMonth: number | null
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

export function RunsList({ runs }: { runs: RunListItem[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-8 text-sm text-gray-500">
        Brak uruchomionych wykonań. Zacznij od szablonu checklisty.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {runs.map((run) => (
        <Link
          key={run.id}
          href={`/operations/runs/${run.id}`}
          className="rounded-xl border bg-white p-4 transition hover:border-gray-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-gray-500" />
                <h3 className="font-semibold text-gray-900">{run.name}</h3>
                <StatusBadge status={run.status} />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {run.template.module.area.name} / {run.template.module.name}
              </p>
            </div>
            {run.progress.blocked > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
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
        </Link>
      ))}
    </div>
  )
}
