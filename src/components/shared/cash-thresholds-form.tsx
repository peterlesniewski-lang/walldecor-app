'use client'

import { useEffect, useState } from 'react'

interface ThresholdValues {
  cashThresholdVeryGood: number
  cashThresholdGood: number
  cashThresholdBad: number
}

export function CashThresholdsForm() {
  const [values, setValues] = useState<ThresholdValues>({
    cashThresholdVeryGood: 300000,
    cashThresholdGood: 200000,
    cashThresholdBad: 100000,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings/cash-thresholds')
      .then((r) => r.json())
      .then((data: Partial<ThresholdValues>) => {
        setValues((prev) => ({
          cashThresholdVeryGood: data.cashThresholdVeryGood ?? prev.cashThresholdVeryGood,
          cashThresholdGood: data.cashThresholdGood ?? prev.cashThresholdGood,
          cashThresholdBad: data.cashThresholdBad ?? prev.cashThresholdBad,
        }))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleChange = (key: keyof ThresholdValues, raw: string) => {
    const n = parseFloat(raw)
    if (!isNaN(n)) {
      setValues((prev) => ({ ...prev, [key]: n }))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/cash-thresholds', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
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

  const fields: { key: keyof ThresholdValues; label: string }[] = [
    { key: 'cashThresholdVeryGood', label: 'Bardzo dobry (≥)' },
    { key: 'cashThresholdGood', label: 'Dobry (≥)' },
    { key: 'cashThresholdBad', label: 'Wymaga uwagi (<)' },
  ]

  return (
    <div className="space-y-4 max-w-md">
      <div className="grid grid-cols-3 gap-4">
        {fields.map(({ key, label }) => (
          <div key={key}>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--wd-dark)', opacity: 0.7 }}
            >
              {label}
            </label>
            <input
              type="number"
              min="0"
              step="1000"
              value={values[key]}
              onChange={(e) => handleChange(key, e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
              style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ background: '#2A7D4F' }}
        >
          {saving ? 'Zapisuję...' : 'Zapisz progi'}
        </button>
        {saved && (
          <span className="text-xs font-medium text-green-600 animate-fade-in">
            Zapisano
          </span>
        )}
      </div>
    </div>
  )
}
