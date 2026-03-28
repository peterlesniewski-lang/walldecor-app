'use client'

import { useState } from 'react'
import { X, Copy, Check } from 'lucide-react'
import type { EmployeeRow } from './schedule-calendar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleCopyModalProps {
  open: boolean
  employees: EmployeeRow[]
  currentMonth: string // "YYYY-MM"
  onClose: () => void
  onCopied: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

const PL_MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${PL_MONTHS[m - 1]} ${y}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScheduleCopyModal({
  open,
  employees,
  currentMonth,
  onClose,
  onCopied,
}: ScheduleCopyModalProps) {
  const [fromEmployeeId, setFromEmployeeId] = useState(employees[0]?.id ?? '')
  const [toEmployeeIds, setToEmployeeIds] = useState<Set<string>>(new Set())
  const [fromMonth, setFromMonth] = useState(currentMonth)
  const [toMonth, setToMonth] = useState(shiftMonth(currentMonth, 1))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  if (!open) return null

  function toggleToEmployee(id: string) {
    setToEmployeeIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleCopy() {
    if (!fromEmployeeId) { setError('Wybierz źródłowego pracownika.'); return }
    if (toEmployeeIds.size === 0) { setError('Wybierz co najmniej jednego docelowego pracownika.'); return }
    if (fromMonth === toMonth && toEmployeeIds.has(fromEmployeeId)) {
      setError('Nie można kopiować grafiku na ten sam miesiąc dla tego samego pracownika.')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch('/api/hr/schedules/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromEmployeeId,
          toEmployeeIds: Array.from(toEmployeeIds),
          fromMonth,
          toMonth,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setSuccess(`Skopiowano ${data.created} wpisów.`)
        setTimeout(() => onCopied(), 1200)
      } else {
        setError(data.error ?? 'Błąd podczas kopiowania grafiku.')
      }
    } catch {
      setError('Wystąpił nieoczekiwany błąd.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl z-10 overflow-hidden"
        style={{ background: 'var(--wd-white)', border: '1px solid var(--wd-border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <div className="flex items-center gap-2">
            <Copy size={17} style={{ color: 'var(--wd-sand)' }} />
            <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
              Kopiuj grafik
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--wd-surface-2)] transition-colors"
          >
            <X size={15} style={{ color: '#94A3B8' }} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Source employee */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wd-dark)' }}>
              Pracownik źródłowy
            </label>
            <select
              value={fromEmployeeId}
              onChange={e => setFromEmployeeId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)]"
              style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
            >
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
            </select>
          </div>

          {/* Month selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wd-dark)' }}>
                Miesiąc źródłowy
              </label>
              <input
                type="month"
                value={fromMonth}
                onChange={e => setFromMonth(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)]"
                style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
              />
              <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>{monthLabel(fromMonth)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wd-dark)' }}>
                Miesiąc docelowy
              </label>
              <input
                type="month"
                value={toMonth}
                onChange={e => setToMonth(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)]"
                style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
              />
              <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>{monthLabel(toMonth)}</p>
            </div>
          </div>

          {/* Target employees */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium" style={{ color: 'var(--wd-dark)' }}>
                Kopiuj do pracowników ({toEmployeeIds.size} wybranych)
              </label>
              <button
                onClick={() => {
                  if (toEmployeeIds.size === employees.length) {
                    setToEmployeeIds(new Set())
                  } else {
                    setToEmployeeIds(new Set(employees.map(e => e.id)))
                  }
                }}
                className="text-xs underline"
                style={{ color: 'var(--wd-dark)' }}
              >
                {toEmployeeIds.size === employees.length ? 'Odznacz' : 'Zaznacz wszystkich'}
              </button>
            </div>
            <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
              {employees.map(emp => (
                <label
                  key={emp.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-[var(--wd-surface-2)]"
                >
                  <button
                    onClick={() => toggleToEmployee(emp.id)}
                    className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all"
                    style={{
                      background: toEmployeeIds.has(emp.id) ? 'var(--wd-dark)' : 'var(--wd-white)',
                      border: `2px solid ${toEmployeeIds.has(emp.id) ? 'var(--wd-dark)' : 'var(--wd-border)'}`,
                    }}
                  >
                    {toEmployeeIds.has(emp.id) && <Check size={9} color="#fff" />}
                  </button>
                  <span className="text-xs" style={{ color: 'var(--wd-dark)' }}>
                    {emp.firstName} {emp.lastName}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
          {success && (
            <p className="text-xs font-medium" style={{ color: '#16A34A' }}>{success}</p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4 border-t"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-lg border transition-colors"
            style={{ borderColor: 'var(--wd-border)', color: '#64748B', background: 'var(--wd-white)' }}
          >
            Anuluj
          </button>
          <button
            onClick={handleCopy}
            disabled={saving || toEmployeeIds.size === 0}
            className="flex items-center gap-1.5 px-5 py-2 text-xs rounded-lg font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--wd-dark)', color: '#fff' }}
          >
            <Copy size={12} />
            {saving ? 'Kopiowanie…' : 'Kopiuj grafik'}
          </button>
        </div>
      </div>
    </div>
  )
}
