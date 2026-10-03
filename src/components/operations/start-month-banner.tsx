'use client'

import { formatClosingPeriod } from '@/lib/operations/run-factory'
import { useStartRun } from './use-start-run'

export function StartMonthBanner({
  templateId,
  periodYear,
  periodMonth,
}: {
  templateId: string
  periodYear: number
  periodMonth: number
}) {
  const { start, loading, error } = useStartRun(templateId)
  const period = formatClosingPeriod(periodYear, periodMonth)

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-semibold text-gray-900 first-letter:uppercase">{period} nie ma jeszcze zamknięcia</p>
      <p className="mt-0.5 text-sm text-amber-900">Księgowość czeka na komplet dokumentów za poprzedni miesiąc.</p>
      <button
        type="button"
        onClick={() => start({ periodYear, periodMonth })}
        disabled={loading}
        className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? 'Uruchamiam...' : `Rozpocznij zamknięcie: ${period}`}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
