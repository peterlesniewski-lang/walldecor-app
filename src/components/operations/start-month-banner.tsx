'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { formatClosingPeriod } from '@/lib/operations/run-factory'

export function StartMonthBanner({
  templateId,
  periodYear,
  periodMonth,
}: {
  templateId: string
  periodYear: number
  periodMonth: number
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const period = formatClosingPeriod(periodYear, periodMonth)

  async function startRun() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/operations/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, periodYear, periodMonth }),
    })
    setLoading(false)

    if (res.status === 409) {
      const existing = (await res.json()) as { runId?: string }
      if (existing.runId) {
        router.push(`/operations/runs/${existing.runId}`)
        return
      }
    }
    if (!res.ok) {
      setError('Nie udało się utworzyć wykonania. Spróbuj ponownie.')
      return
    }
    const run = (await res.json()) as { id: string }
    router.push(`/operations/runs/${run.id}`)
  }

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-semibold text-gray-900 first-letter:uppercase">{period} nie ma jeszcze zamknięcia</p>
      <p className="mt-0.5 text-sm text-amber-900">Księgowość czeka na komplet dokumentów za poprzedni miesiąc.</p>
      <button
        type="button"
        onClick={startRun}
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
