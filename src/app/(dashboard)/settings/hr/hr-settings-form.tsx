'use client'

import { useState } from 'react'

interface HrSettingsFormProps {
  initialValues: {
    hr_saturday_workable: string
    hr_standard_clock_in: string
    hr_standard_clock_out: string
    hr_overtime_threshold_minutes: string
  }
}

export function HrSettingsForm({ initialValues }: HrSettingsFormProps) {
  const [saturdayWorkable, setSaturdayWorkable] = useState(
    initialValues.hr_saturday_workable === 'true'
  )
  const [clockIn, setClockIn] = useState(initialValues.hr_standard_clock_in)
  const [clockOut, setClockOut] = useState(initialValues.hr_standard_clock_out)
  const [overtimeThreshold, setOvertimeThreshold] = useState(
    initialValues.hr_overtime_threshold_minutes
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    try {
      const res = await fetch('/api/settings/hr', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { key: 'hr_saturday_workable', value: saturdayWorkable ? 'true' : 'false' },
          { key: 'hr_standard_clock_in', value: clockIn },
          { key: 'hr_standard_clock_out', value: clockOut },
          { key: 'hr_overtime_threshold_minutes', value: overtimeThreshold },
        ]),
      })
      if (!res.ok) throw new Error('Błąd zapisu')
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Sekcja: Godziny pracy */}
      <div
        className="rounded-xl p-6 space-y-5"
        style={{
          background: '#fff',
          border: '1px solid var(--wd-border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div className="border-b pb-3" style={{ borderColor: 'var(--wd-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Godziny pracy
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
            Godziny standardowe używane jako domyślne przy dodawaniu wpisów
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label
              htmlFor="clockIn"
              className="text-sm font-medium"
              style={{ color: 'var(--wd-dark)' }}
            >
              Standardowe wejście
            </label>
            <input
              id="clockIn"
              type="time"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm font-mono border outline-none transition-colors"
              style={{
                borderColor: 'var(--wd-border)',
                color: 'var(--wd-dark)',
                background: 'var(--wd-off-white)',
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="clockOut"
              className="text-sm font-medium"
              style={{ color: 'var(--wd-dark)' }}
            >
              Standardowe wyjście
            </label>
            <input
              id="clockOut"
              type="time"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm font-mono border outline-none transition-colors"
              style={{
                borderColor: 'var(--wd-border)',
                color: 'var(--wd-dark)',
                background: 'var(--wd-off-white)',
              }}
            />
          </div>
        </div>
      </div>

      {/* Sekcja: Soboty */}
      <div
        className="rounded-xl p-6 space-y-4"
        style={{
          background: '#fff',
          border: '1px solid var(--wd-border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div className="border-b pb-3" style={{ borderColor: 'var(--wd-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Soboty
          </h2>
        </div>

        <label className="flex items-center gap-3 cursor-pointer group w-fit">
          <div className="relative">
            <input
              type="checkbox"
              checked={saturdayWorkable}
              onChange={(e) => setSaturdayWorkable(e.target.checked)}
              className="sr-only"
            />
            <div
              className="w-11 h-6 rounded-full transition-colors duration-200"
              style={{
                background: saturdayWorkable ? 'var(--wd-dark)' : 'var(--wd-border)',
              }}
            >
              <div
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
                style={{
                  transform: saturdayWorkable ? 'translateX(20px)' : 'translateX(0)',
                }}
              />
            </div>
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--wd-dark)' }}>
            Soboty jako dni robocze
          </span>
        </label>

        {/* Info box */}
        <div
          className="flex gap-3 rounded-lg px-4 py-3 text-sm"
          style={{ background: '#FEF3C7', border: '1px solid #FCD34D' }}
        >
          <svg
            className="shrink-0 mt-0.5"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{ color: '#92400E' }}
          >
            <path
              d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4.5Zm0 7.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
              fill="currentColor"
            />
          </svg>
          <div style={{ color: '#92400E' }}>
            <p className="font-medium leading-snug">Praca w sobotę liczona jako nadgodziny 2×</p>
            <p className="mt-0.5 leading-snug opacity-80">
              {saturdayWorkable
                ? 'Soboty są klikalne w ewidencji czasu pracy.'
                : 'Soboty są zablokowane — traktowane jak niedziela.'}
            </p>
          </div>
        </div>
      </div>

      {/* Sekcja: Nadgodziny */}
      <div
        className="rounded-xl p-6 space-y-5"
        style={{
          background: '#fff',
          border: '1px solid var(--wd-border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div className="border-b pb-3" style={{ borderColor: 'var(--wd-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Nadgodziny
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
            Praca powyżej X minut dziennie liczona jako nadgodziny
          </p>
        </div>

        <div className="max-w-xs space-y-1.5">
          <label
            htmlFor="overtimeThreshold"
            className="text-sm font-medium"
            style={{ color: 'var(--wd-dark)' }}
          >
            Próg nadgodzin (minuty)
          </label>
          <div className="flex items-center gap-3">
            <input
              id="overtimeThreshold"
              type="number"
              min={1}
              max={1440}
              value={overtimeThreshold}
              onChange={(e) => setOvertimeThreshold(e.target.value)}
              className="w-32 rounded-lg px-3 py-2 text-sm font-mono border outline-none transition-colors"
              style={{
                borderColor: 'var(--wd-border)',
                color: 'var(--wd-dark)',
                background: 'var(--wd-off-white)',
              }}
            />
            <span className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
              {overtimeThreshold
                ? `${Math.floor(Number(overtimeThreshold) / 60)}h ${Number(overtimeThreshold) % 60}min`
                : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === 'saving'}
          className="rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-60"
          style={{
            background: 'var(--wd-dark)',
            color: '#fff',
          }}
        >
          {status === 'saving' ? 'Zapisywanie…' : 'Zapisz ustawienia'}
        </button>

        {status === 'saved' && (
          <span
            className="text-sm font-medium animate-in fade-in slide-in-from-left-2"
            style={{ color: '#059669' }}
          >
            ✓ Zapisano
          </span>
        )}
        {status === 'error' && (
          <span className="text-sm font-medium" style={{ color: '#DC2626' }}>
            Błąd zapisu. Spróbuj ponownie.
          </span>
        )}
      </div>
    </form>
  )
}
