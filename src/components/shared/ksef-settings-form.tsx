'use client'

import { useEffect, useState } from 'react'

type KsefEnvironment = 'test' | 'demo' | 'production'

interface KsefSettingsValues {
  enabled: boolean
  environment: KsefEnvironment
  companyNip: string
  syncFrom: string
  token: string
}

interface KsefSettingsResponse {
  enabled?: boolean
  environment?: KsefEnvironment
  companyNip?: string
  syncFrom?: string
  hasToken?: boolean
  tokenPreview?: string | null
}

const DEFAULT_VALUES: KsefSettingsValues = {
  enabled: false,
  environment: 'test',
  companyNip: '',
  syncFrom: '2026-02-01',
  token: '',
}

export function KsefSettingsForm() {
  const [values, setValues] = useState<KsefSettingsValues>(DEFAULT_VALUES)
  const [hasToken, setHasToken] = useState(false)
  const [tokenPreview, setTokenPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/ksef')
      .then((response) => response.json())
      .then((data: KsefSettingsResponse) => {
        setValues((prev) => ({
          ...prev,
          enabled: data.enabled ?? prev.enabled,
          environment: data.environment ?? prev.environment,
          companyNip: data.companyNip ?? prev.companyNip,
          syncFrom: data.syncFrom ?? prev.syncFrom,
          token: '',
        }))
        setHasToken(data.hasToken ?? false)
        setTokenPreview(data.tokenPreview ?? null)
      })
      .catch(() => setError('Nie udało się pobrać ustawień KSeF.'))
      .finally(() => setLoading(false))
  }, [])

  const update = <K extends keyof KsefSettingsValues>(key: K, value: KsefSettingsValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
    setError(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)

    try {
      const payload = {
        enabled: values.enabled,
        environment: values.environment,
        companyNip: values.companyNip.replace(/\D/g, ''),
        syncFrom: values.syncFrom,
        token: values.token.trim() || undefined,
      }
      const response = await fetch('/api/settings/ksef', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        setError('Nie udało się zapisać ustawień. Sprawdź NIP i datę.')
        return
      }
      setValues((prev) => ({ ...prev, companyNip: payload.companyNip, token: '' }))
      if (payload.token) {
        setHasToken(true)
        setTokenPreview(payload.token.length < 8 ? '***' : `${payload.token.slice(0, 4)}...${payload.token.slice(-4)}`)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <p className="text-xs" style={{ color: 'var(--wd-dark)', opacity: 0.4 }}>
        Ładowanie...
      </p>
    )
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between rounded-lg border border-[var(--wd-border)] bg-white px-4 py-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Integracja KSeF
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
            Token jest zapisywany jako sekret aplikacji i nie jest zwracany w pełnej postaci.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={values.enabled}
            onChange={(event) => update('enabled', event.target.checked)}
          />
          Aktywna
        </label>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-dark)', opacity: 0.7 }}>
            Środowisko
          </label>
          <select
            value={values.environment}
            onChange={(event) => update('environment', event.target.value as KsefEnvironment)}
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
          >
            <option value="test">Testowe</option>
            <option value="demo">Demo</option>
            <option value="production">Produkcyjne</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-dark)', opacity: 0.7 }}>
            NIP firmy
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={values.companyNip}
            onChange={(event) => update('companyNip', event.target.value)}
            placeholder="5250007133"
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-dark)', opacity: 0.7 }}>
            Pobieraj od
          </label>
          <input
            type="date"
            value={values.syncFrom}
            onChange={(event) => update('syncFrom', event.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-dark)', opacity: 0.7 }}>
          Token KSeF
        </label>
        <input
          type="password"
          value={values.token}
          onChange={(event) => update('token', event.target.value)}
          placeholder={hasToken && tokenPreview ? `Zapisany: ${tokenPreview}` : 'Wklej token KSeF'}
          className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
          style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--wd-text-muted)' }}>
          Pozostaw puste, żeby nie zmieniać już zapisanego tokenu.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ background: '#2A7D4F' }}
        >
          {saving ? 'Zapisuję...' : 'Zapisz KSeF'}
        </button>
        {saved && <span className="text-xs font-medium text-green-600">Zapisano</span>}
        {error && <span className="text-xs font-medium text-red-600">{error}</span>}
      </div>
    </div>
  )
}
