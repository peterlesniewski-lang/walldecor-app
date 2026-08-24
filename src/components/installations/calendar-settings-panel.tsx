'use client'

import { useEffect, useState } from 'react'

type CalendarReadiness = {
  enabled: boolean
  adapter: 'disabled' | 'fake' | 'google'
  credentialsConfigured: boolean
  calendarConfigured: boolean
  impersonationConfigured: boolean
  ready: boolean
}

export function CalendarSettingsPanel() {
  const [readiness, setReadiness] = useState<CalendarReadiness | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/settings/installation-calendar', { cache: 'no-store' })
        if (!response.ok) throw new Error('load')
        setReadiness(await response.json() as CalendarReadiness)
      } catch {
        setError('Nie udało się odczytać gotowości Google Calendar.')
      }
    })()
  }, [])

  return <div className="rounded-xl border p-5" style={{ background: 'var(--wd-white)', borderColor: 'var(--wd-border)' }}>
    <p className="data-label" style={{ color: '#8C5718' }}>Montaże</p>
    <h3 className="mt-1 text-lg font-bold" style={{ color: 'var(--wd-dark)' }}>Google Calendar — gotowość integracji</h3>
    <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>
      Ten ekran nie przechowuje ani nie pokazuje klucza prywatnego. Konfigurację poświadczeń wykonujemy wyłącznie w Coolify.
    </p>
    {readiness ? <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold">Synchronizacja</dt><dd>{readiness.ready ? 'Gotowa do pracy' : 'Wymaga konfiguracji'}</dd></div>
      <div><dt className="font-semibold">Adapter</dt><dd>{readiness.adapter}</dd></div>
      <div><dt className="font-semibold">Włączona</dt><dd>{readiness.enabled ? 'Tak' : 'Nie'}</dd></div>
      <div><dt className="font-semibold">Poświadczenia</dt><dd>{readiness.credentialsConfigured ? 'Skonfigurowane' : 'Brak'}</dd></div>
      <div><dt className="font-semibold">Kalendarz firmowy</dt><dd>{readiness.calendarConfigured ? 'Skonfigurowany' : 'Brak'}</dd></div>
      <div><dt className="font-semibold">Impersonacja</dt><dd>{readiness.impersonationConfigured ? 'Skonfigurowana' : 'Brak'}</dd></div>
    </dl> : !error && <p className="mt-4 text-sm">Wczytywanie…</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
  </div>
}
