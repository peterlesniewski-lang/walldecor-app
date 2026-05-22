'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Play } from 'lucide-react'

export function StartRunButton({ templateId }: { templateId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function startRun() {
    setLoading(true)
    const now = new Date()
    const res = await fetch('/api/operations/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId,
        periodYear: now.getFullYear(),
        periodMonth: now.getMonth() + 1,
      }),
    })
    setLoading(false)
    if (!res.ok) return
    const run = (await res.json()) as { id: string }
    router.push(`/operations/runs/${run.id}`)
  }

  return (
    <button
      onClick={startRun}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
    >
      <Play className="h-4 w-4" />
      {loading ? 'Uruchamiam...' : 'Uruchom bieżący miesiąc'}
    </button>
  )
}
