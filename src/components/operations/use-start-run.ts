'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const START_ERROR = 'Nie udało się utworzyć wykonania. Spróbuj ponownie.'

export interface StartRunPeriod {
  periodYear: number
  periodMonth: number
}

/**
 * Starts a month-closing run for the given template and period, then opens it.
 * A duplicate month (409) opens the already existing run instead of failing.
 */
export function useStartRun(templateId: string) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start({ periodYear, periodMonth }: StartRunPeriod) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/operations/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, periodYear, periodMonth }),
      })

      if (res.status === 409) {
        const existing = (await res.json()) as { runId?: string }
        if (existing.runId) {
          router.push(`/operations/runs/${existing.runId}`)
          return
        }
      }
      if (!res.ok) {
        setError(START_ERROR)
        return
      }
      const run = (await res.json()) as { id: string }
      router.push(`/operations/runs/${run.id}`)
    } catch {
      setError(START_ERROR)
    } finally {
      setLoading(false)
    }
  }

  return { start, loading, error }
}
