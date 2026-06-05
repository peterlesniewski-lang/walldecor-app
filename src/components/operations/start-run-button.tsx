'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CalendarDays, Play, X } from 'lucide-react'
import { getPreviousMonthPeriod, MONTHS } from '@/lib/operations/run-factory'

export function StartRunButton({ templateId }: { templateId: string }) {
  const router = useRouter()
  const defaultPeriod = getPreviousMonthPeriod()
  const [open, setOpen] = useState(false)
  const [periodYear, setPeriodYear] = useState(defaultPeriod.periodYear)
  const [periodMonth, setPeriodMonth] = useState(defaultPeriod.periodMonth)
  const [loading, setLoading] = useState(false)

  async function startRun() {
    setLoading(true)
    const res = await fetch('/api/operations/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId,
        periodYear,
        periodMonth,
      }),
    })
    setLoading(false)
    if (!res.ok) return
    const run = (await res.json()) as { id: string }
    router.push(`/operations/runs/${run.id}`)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        <Play className="h-4 w-4" />
        {loading ? 'Uruchamiam...' : 'Uruchom zamknięcie miesiąca'}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border bg-white p-4 text-left shadow-lg">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Jaki miesiąc zamykamy?</p>
              <p className="text-xs text-gray-500">Domyślnie proponujemy poprzedni miesiąc.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-gray-100" aria-label="Zamknij">
              <X className="h-4 w-4 text-gray-500" />
            </button>
          </div>

          <div className="grid grid-cols-[1fr_96px] gap-2">
            <select
              value={periodMonth}
              onChange={(event) => setPeriodMonth(Number(event.target.value))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={2020}
              max={2100}
              value={periodYear}
              onChange={(event) => setPeriodYear(Number(event.target.value))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          <button
            type="button"
            onClick={startRun}
            disabled={loading}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            <CalendarDays className="h-4 w-4" />
            {loading ? 'Uruchamiam...' : `Utwórz wykonanie: ${MONTHS[periodMonth - 1]} ${periodYear}`}
          </button>
        </div>
      )}
    </div>
  )
}
