'use client'

import { useCallback, useEffect, useState } from 'react'

interface KsefCutoverPreview {
  cutoff: { year: number; month: number }
  preservedActualEntriesBeforeCutover: number
  removableActualEntriesFromCutover: number
  confirmation: string
}

export function KsefCutoverMaintenance() {
  const [preview, setPreview] = useState<KsefCutoverPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPreview = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/admin/finance/ksef-cutover')
      if (!response.ok) {
        setError('Nie udało się pobrać statusu cutover.')
        return
      }
      setPreview(await response.json())
    } catch {
      setError('Nie udało się pobrać statusu cutover.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPreview()
  }, [loadPreview])

  const handleDelete = async () => {
    if (!preview || preview.removableActualEntriesFromCutover === 0) return

    const confirmed = window.confirm(
      `Usunąć ${preview.removableActualEntriesFromCutover} ręcznych wpisów kosztów od 2026-04? Historia do 2026-03 zostanie zachowana.`
    )
    if (!confirmed) return

    setDeleting(true)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch('/api/admin/finance/ksef-cutover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: preview.confirmation }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body?.error ?? 'Nie udało się wykonać cutover.')
        return
      }
      setMessage(`Usunięto ${body.deletedCount ?? 0} wpisów ręcznych od 2026-04.`)
      await loadPreview()
    } catch {
      setError('Nie udało się wykonać cutover.')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <p className="text-xs" style={{ color: 'var(--wd-dark)', opacity: 0.4 }}>
        Sprawdzanie danych cutover...
      </p>
    )
  }

  return (
    <div className="max-w-3xl rounded-lg border border-[var(--wd-border)] bg-white px-4 py-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Cutover kosztów na KSeF
          </p>
          <p className="mt-1 text-xs leading-5" style={{ color: 'var(--wd-text-muted)' }}>
            Zachowuje ręczne koszty do 2026-03. Od 2026-04 źródłem kosztów są zatwierdzone
            faktury KSeF i zdarzenia kosztowe.
          </p>
          {preview && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-md border border-[var(--wd-border)] px-3 py-2">
                <span style={{ color: 'var(--wd-text-muted)' }}>Zostaje w historii</span>
                <p className="mt-1 text-lg font-semibold" style={{ color: 'var(--wd-dark)' }}>
                  {preview.preservedActualEntriesBeforeCutover}
                </p>
              </div>
              <div className="rounded-md border border-[var(--wd-border)] px-3 py-2">
                <span style={{ color: 'var(--wd-text-muted)' }}>Do usunięcia od 2026-04</span>
                <p className="mt-1 text-lg font-semibold" style={{ color: 'var(--wd-dark)' }}>
                  {preview.removableActualEntriesFromCutover}
                </p>
              </div>
            </div>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={!preview || preview.removableActualEntriesFromCutover === 0 || deleting}
          className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: '#9F2E2E' }}
        >
          {deleting ? 'Czyszczę...' : 'Wyczyść od 2026-04'}
        </button>
      </div>
      {message && <p className="mt-3 text-xs font-medium text-green-600">{message}</p>}
      {error && <p className="mt-3 text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}
