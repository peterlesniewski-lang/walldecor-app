'use client'

import { useState } from 'react'
import { X, Trash2, Clock, Save } from 'lucide-react'
import type { ScheduleEntry } from './schedule-calendar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleEntryModalProps {
  open: boolean
  dateIso: string
  employeeId: string
  employeeName: string
  schedule?: ScheduleEntry
  onClose: () => void
  onSave: (data: {
    employeeId: string
    dateIso: string
    startTime: string
    endTime: string
    breakMinutes: number
    type: string
  }) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PL_MONTHS_GEN = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
]

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return `${d.getDate()} ${PL_MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`
}

function calcNetMinutes(startTime: string, endTime: string, breakMinutes: number): number {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm) - breakMinutes)
}

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScheduleEntryModal({
  open,
  dateIso,
  employeeId,
  employeeName,
  schedule,
  onClose,
  onSave,
  onDelete,
}: ScheduleEntryModalProps) {
  const [startTime, setStartTime] = useState(schedule?.startTime ?? '08:00')
  const [endTime, setEndTime] = useState(schedule?.endTime ?? '16:00')
  const [breakMinutes, setBreakMinutes] = useState(schedule?.breakMinutes ?? 30)
  const [type, setType] = useState<'regular' | 'overtime' | 'on-call'>(schedule?.type ?? 'regular')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const netMinutes = calcNetMinutes(startTime, endTime, breakMinutes)
  const isValid = netMinutes > 0

  async function handleSave() {
    if (!isValid) return
    setSaving(true)
    setError('')
    try {
      const ok = await onSave({ employeeId, dateIso, startTime, endTime, breakMinutes, type })
      if (!ok) setError('Błąd podczas zapisu. Spróbuj ponownie.')
    } catch {
      setError('Wystąpił nieoczekiwany błąd.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!schedule?.id) return
    setDeleting(true)
    try {
      await onDelete(schedule.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-sm rounded-2xl shadow-2xl p-6 z-10"
        style={{ background: 'var(--wd-white)', border: '1px solid var(--wd-border)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
              {schedule ? 'Edytuj grafik' : 'Dodaj grafik'}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
              {employeeName} · {fmtDate(dateIso)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--wd-surface-2)] transition-colors"
          >
            <X size={15} style={{ color: '#94A3B8' }} />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Time inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wd-dark)' }}>
                Godzina start
              </label>
              <div className="relative">
                <Clock size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }} />
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)]"
                  style={{
                    background: 'var(--wd-surface-2)',
                    borderColor: 'var(--wd-border)',
                    color: 'var(--wd-dark)',
                  }}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wd-dark)' }}>
                Godzina koniec
              </label>
              <div className="relative">
                <Clock size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }} />
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)]"
                  style={{
                    background: 'var(--wd-surface-2)',
                    borderColor: 'var(--wd-border)',
                    color: 'var(--wd-dark)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Break */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wd-dark)' }}>
              Przerwa (minuty)
            </label>
            <select
              value={breakMinutes}
              onChange={e => setBreakMinutes(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)]"
              style={{
                background: 'var(--wd-surface-2)',
                borderColor: 'var(--wd-border)',
                color: 'var(--wd-dark)',
              }}
            >
              <option value={0}>Brak przerwy</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>60 min</option>
            </select>
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wd-dark)' }}>
              Typ
            </label>
            <div className="flex gap-2">
              {(['regular', 'overtime', 'on-call'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className="flex-1 py-1.5 text-xs rounded-lg border transition-all font-medium"
                  style={{
                    background: type === t ? 'var(--wd-dark)' : 'var(--wd-surface-2)',
                    borderColor: type === t ? 'var(--wd-dark)' : 'var(--wd-border)',
                    color: type === t ? '#fff' : '#64748B',
                  }}
                >
                  {t === 'regular' ? 'Regularne' : t === 'overtime' ? 'Nadgodziny' : 'Dyżur'}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          {isValid && (
            <div
              className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
              style={{ background: 'var(--wd-surface-2)', color: '#64748B' }}
            >
              <span>Czas pracy netto</span>
              <span className="font-semibold" style={{ color: 'var(--wd-dark)' }}>
                {fmtHours(netMinutes)}
              </span>
            </div>
          )}

          {!isValid && (startTime || endTime) && (
            <p className="text-xs text-red-500">
              Czas końca musi być późniejszy niż start (po odliczeniu przerwy).
            </p>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-6">
          {schedule?.id && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition-colors disabled:opacity-50"
              style={{
                borderColor: '#FCA5A5',
                color: '#DC2626',
                background: '#FEF2F2',
              }}
            >
              <Trash2 size={12} />
              {deleting ? 'Usuwanie…' : 'Usuń'}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-lg border transition-colors"
            style={{
              borderColor: 'var(--wd-border)',
              color: '#64748B',
              background: 'var(--wd-white)',
            }}
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid || saving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--wd-dark)', color: '#fff' }}
          >
            <Save size={12} />
            {saving ? 'Zapisuję…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  )
}
