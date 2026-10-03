'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function RunStatusButton({
  runId,
  nextStatus,
  children,
  primary = false,
}: {
  runId: string
  nextStatus: 'open' | 'closed'
  children: React.ReactNode
  primary?: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function changeStatus() {
    setLoading(true)
    setFailed(false)
    const res = await fetch(`/api/operations/runs/${runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
    setLoading(false)
    if (!res.ok) {
      setFailed(true)
      return
    }
    router.refresh()
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={changeStatus}
        disabled={loading}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
          primary ? 'bg-gray-900 text-white hover:bg-gray-800' : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
        }`}
      >
        {loading ? 'Zapisuję...' : children}
      </button>
      {failed && <span role="alert" className="text-xs text-red-700">Nie udało się zapisać.</span>}
    </span>
  )
}
