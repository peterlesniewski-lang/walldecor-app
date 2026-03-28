'use client'

import { useState } from 'react'
import { X, Zap } from 'lucide-react'
import { formatDuration } from '@/lib/hr/utils'

interface Employee {
  id: string
  firstName: string
  lastName: string
}

interface BulkAddModalProps {
  weekStart: string   // "YYYY-MM-DD"
  weekEnd: string     // "YYYY-MM-DD"
  employees: Employee[]
  onClose: () => void
  onCreated: () => void
}

const QUICK_PRESETS: { label: string; clockIn: string; clockOut: string; minutes: number }[] = [
  { label: '8h', clockIn: '08:00', clockOut: '16:00', minutes: 480 },
  { label: '8h (11–19)', clockIn: '11:00', clockOut: '19:00', minutes: 480 },
  { label: '4h', clockIn: '11:00', clockOut: '15:00', minutes: 240 },
  { label: '2h', clockIn: '11:00', clockOut: '13:00', minutes: 120 },
  { label: '1h', clockIn: '11:00', clockOut: '12:00', minutes: 60 },
  { label: '30m', clockIn: '11:00', clockOut: '11:30', minutes: 30 },
]

export function BulkAddModal({ weekStart, weekEnd, employees, onClose, onCreated }: BulkAddModalProps) {
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>(employees.map((e) => e.id))
  const [startDate, setStartDate] = useState(weekStart)
  const [endDate, setEndDate] = useState(weekEnd)
  const [clockIn, setClockIn] = useState('08:00')
  const [clockOut, setClockOut] = useState('16:00')
  const [skipWeekends, setSkipWeekends] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)

  const previewMinutes = (() => {
    if (!clockIn || !clockOut) return null
    const [ih, im] = clockIn.split(':').map(Number)
    const [oh, om] = clockOut.split(':').map(Number)
    const diff = (oh * 60 + om) - (ih * 60 + im)
    return diff > 0 ? diff : null
  })()

  const toggleEmployee = (id: string) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    )
  }

  const selectAll = () => setSelectedEmployeeIds(employees.map((e) => e.id))
  const selectNone = () => setSelectedEmployeeIds([])

  const applyPreset = (preset: typeof QUICK_PRESETS[number]) => {
    setClockIn(preset.clockIn)
    setClockOut(preset.clockOut)
  }

  const handleSubmit = async () => {
    if (!selectedEmployeeIds.length) {
      setError('Wybierz co najmniej jednego pracownika')
      return
    }
    if (!clockIn || !clockOut) {
      setError('Wpisz godziny clock-in i clock-out')
      return
    }
    if (previewMinutes === null || previewMinutes <= 0) {
      setError('Clock-out musi być po clock-in')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/hr/time-tracking/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeIds: selectedEmployeeIds,
          startDate: new Date(`${startDate}T00:00:00`).toISOString(),
          endDate: new Date(`${endDate}T00:00:00`).toISOString(),
          clockIn,
          clockOut,
          skipWeekends,
        }),
      })

      const data = await res.json() as { created?: number; skipped?: number; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Błąd tworzenia wpisów')
        return
      }

      setResult({ created: data.created ?? 0, skipped: data.skipped ?? 0 })
      onCreated()
    } catch {
      setError('Błąd połączenia')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden"
        style={{ background: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--wd-dark)' }}
            >
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-[var(--wd-text-primary)]">Dodaj zbiorczo</h2>
              <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                Masowe tworzenie wpisów czasu pracy
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--wd-surface-2)] transition-colors"
          >
            <X className="w-4 h-4 text-[var(--wd-text-muted)]" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Date range */}
          <div>
            <label className="data-label block mb-2">Zakres dat</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--wd-text-muted)] block mb-1">Od</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-off-white)' }}
                />
              </div>
              <div>
                <label className="text-xs text-[var(--wd-text-muted)] block mb-1">Do</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-off-white)' }}
                />
              </div>
            </div>
          </div>

          {/* Quick presets */}
          <div>
            <label className="data-label block mb-2">Szybkie wypełnienie</label>
            <div className="flex flex-wrap gap-2">
              {QUICK_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors hover:border-[var(--wd-dark)] hover:bg-[var(--wd-surface-2)]"
                  style={{
                    borderColor: clockIn === preset.clockIn && clockOut === preset.clockOut
                      ? 'var(--wd-dark)'
                      : 'var(--wd-border)',
                    background: clockIn === preset.clockIn && clockOut === preset.clockOut
                      ? 'var(--wd-dark)'
                      : 'transparent',
                    color: clockIn === preset.clockIn && clockOut === preset.clockOut
                      ? '#fff'
                      : 'var(--wd-text-primary)',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Time inputs */}
          <div>
            <label className="data-label block mb-2">Godziny</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--wd-text-muted)] block mb-1">Clock In</label>
                <input
                  type="time"
                  value={clockIn}
                  onChange={(e) => setClockIn(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border text-sm font-medium num"
                  style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-off-white)' }}
                />
              </div>
              <div>
                <label className="text-xs text-[var(--wd-text-muted)] block mb-1">Clock Out</label>
                <input
                  type="time"
                  value={clockOut}
                  onChange={(e) => setClockOut(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border text-sm font-medium num"
                  style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-off-white)' }}
                />
              </div>
            </div>
            {previewMinutes !== null && (
              <p className="text-xs mt-1.5" style={{ color: 'var(--wd-text-muted)' }}>
                Czas pracy: <span className="font-semibold text-[var(--wd-text-primary)] num">{formatDuration(previewMinutes)}</span> / dzień
              </p>
            )}
          </div>

          {/* Skip weekends */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSkipWeekends(!skipWeekends)}
              className={`relative w-10 h-5 rounded-full transition-colors ${skipWeekends ? 'bg-[var(--wd-dark)]' : 'bg-[var(--wd-border)]'}`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${skipWeekends ? 'translate-x-5' : 'translate-x-0.5'}`}
              />
            </button>
            <span className="text-sm" style={{ color: 'var(--wd-text-primary)' }}>
              Pomijaj weekendy
            </span>
          </div>

          {/* Employee selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="data-label">Pracownicy ({selectedEmployeeIds.length}/{employees.length})</label>
              <div className="flex gap-2">
                <button
                  onClick={selectAll}
                  className="text-xs px-2 py-0.5 rounded border border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors"
                  style={{ color: 'var(--wd-text-muted)' }}
                >
                  Wszyscy
                </button>
                <button
                  onClick={selectNone}
                  className="text-xs px-2 py-0.5 rounded border border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors"
                  style={{ color: 'var(--wd-text-muted)' }}
                >
                  Żaden
                </button>
              </div>
            </div>
            <div
              className="rounded-xl border max-h-40 overflow-y-auto"
              style={{ borderColor: 'var(--wd-border)' }}
            >
              {employees.map((emp, idx) => (
                <label
                  key={emp.id}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors hover:bg-[var(--wd-off-white)] ${idx < employees.length - 1 ? 'border-b' : ''}`}
                  style={{ borderColor: 'var(--wd-border)' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedEmployeeIds.includes(emp.id)}
                    onChange={() => toggleEmployee(emp.id)}
                    className="rounded"
                  />
                  <span className="text-sm" style={{ color: 'var(--wd-text-primary)' }}>
                    {emp.firstName} {emp.lastName}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              className="px-3 py-2 rounded-lg text-sm"
              style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}
            >
              {error}
            </div>
          )}

          {/* Success result */}
          {result && (
            <div
              className="px-4 py-3 rounded-xl text-sm"
              style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}
            >
              <p className="font-semibold text-emerald-700">Gotowe!</p>
              <p className="text-emerald-600 mt-0.5">
                Utworzono: <span className="font-semibold">{result.created}</span> wpisów
                {result.skipped > 0 && <span className="ml-2 text-amber-600">· Pominięto: {result.skipped} (już istniały)</span>}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-4 border-t"
          style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-off-white)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--wd-surface-2)]"
            style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-text-muted)' }}
          >
            {result ? 'Zamknij' : 'Anuluj'}
          </button>
          {!result && (
            <button
              onClick={() => void handleSubmit()}
              disabled={loading || selectedEmployeeIds.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
              style={{ background: 'var(--wd-dark)', color: '#fff' }}
            >
              <Zap className="w-3.5 h-3.5" />
              {loading ? 'Tworzę...' : `Utwórz wpisy (${selectedEmployeeIds.length} os.)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
