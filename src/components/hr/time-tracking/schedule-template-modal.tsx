'use client'

import { useState } from 'react'
import { X, LayoutTemplate, Check } from 'lucide-react'
import type { EmployeeRow } from './schedule-calendar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayConfig {
  enabled: boolean
  startTime: string
  endTime: string
  breakMinutes: number
}

interface WeekTemplate {
  monday: DayConfig
  tuesday: DayConfig
  wednesday: DayConfig
  thursday: DayConfig
  friday: DayConfig
  saturday: DayConfig
  sunday: DayConfig
}

const DAYS: Array<{ key: keyof WeekTemplate; label: string }> = [
  { key: 'monday', label: 'Poniedziałek' },
  { key: 'tuesday', label: 'Wtorek' },
  { key: 'wednesday', label: 'Środa' },
  { key: 'thursday', label: 'Czwartek' },
  { key: 'friday', label: 'Piątek' },
  { key: 'saturday', label: 'Sobota' },
  { key: 'sunday', label: 'Niedziela' },
]

// ─── Predefined Templates ─────────────────────────────────────────────────────

type TemplatePreset = {
  name: string
  template: WeekTemplate
}

const STD_8_16: WeekTemplate = {
  monday:    { enabled: true,  startTime: '08:00', endTime: '16:00', breakMinutes: 30 },
  tuesday:   { enabled: true,  startTime: '08:00', endTime: '16:00', breakMinutes: 30 },
  wednesday: { enabled: true,  startTime: '08:00', endTime: '16:00', breakMinutes: 30 },
  thursday:  { enabled: true,  startTime: '08:00', endTime: '16:00', breakMinutes: 30 },
  friday:    { enabled: true,  startTime: '08:00', endTime: '16:00', breakMinutes: 30 },
  saturday:  { enabled: false, startTime: '08:00', endTime: '16:00', breakMinutes: 0 },
  sunday:    { enabled: false, startTime: '08:00', endTime: '16:00', breakMinutes: 0 },
}

const SALON_11_19: WeekTemplate = {
  monday:    { enabled: true,  startTime: '11:00', endTime: '19:00', breakMinutes: 30 },
  tuesday:   { enabled: true,  startTime: '11:00', endTime: '19:00', breakMinutes: 30 },
  wednesday: { enabled: true,  startTime: '11:00', endTime: '19:00', breakMinutes: 30 },
  thursday:  { enabled: true,  startTime: '11:00', endTime: '19:00', breakMinutes: 30 },
  friday:    { enabled: true,  startTime: '11:00', endTime: '19:00', breakMinutes: 30 },
  saturday:  { enabled: true,  startTime: '11:00', endTime: '14:00', breakMinutes: 0 },
  sunday:    { enabled: false, startTime: '11:00', endTime: '19:00', breakMinutes: 0 },
}

const PRESETS: TemplatePreset[] = [
  { name: 'Standardowy 8–16', template: STD_8_16 },
  { name: 'Salon 11–19 (WallDecor)', template: SALON_11_19 },
]

function deepClone(t: WeekTemplate): WeekTemplate {
  return JSON.parse(JSON.stringify(t))
}

function calcNetMinutes(start: string, end: string, brk: number): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm) - brk)
}

function fmtH(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ScheduleTemplateModalProps {
  open: boolean
  employees: EmployeeRow[]
  currentMonth: string // "YYYY-MM"
  onClose: () => void
  onApplied: () => void
}

export function ScheduleTemplateModal({
  open,
  employees,
  currentMonth,
  onClose,
  onApplied,
}: ScheduleTemplateModalProps) {
  const [template, setTemplate] = useState<WeekTemplate>(deepClone(STD_8_16))
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set())
  const [startDate, setStartDate] = useState(`${currentMonth}-01`)
  const [endDate, setEndDate] = useState(() => {
    const [y, m] = currentMonth.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    return `${currentMonth}-${String(lastDay).padStart(2, '0')}`
  })
  const [skipHolidays, setSkipHolidays] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  if (!open) return null

  function applyPreset(preset: TemplatePreset) {
    setTemplate(deepClone(preset.template))
  }

  function toggleDay(key: keyof WeekTemplate, enabled: boolean) {
    setTemplate(prev => ({ ...prev, [key]: { ...prev[key], enabled } }))
  }

  function updateDayField(key: keyof WeekTemplate, field: 'startTime' | 'endTime' | 'breakMinutes', value: string | number) {
    setTemplate(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
  }

  function toggleEmployee(id: string) {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllEmployees() {
    if (selectedEmployeeIds.size === employees.length) {
      setSelectedEmployeeIds(new Set())
    } else {
      setSelectedEmployeeIds(new Set(employees.map(e => e.id)))
    }
  }

  async function handleApply() {
    if (selectedEmployeeIds.size === 0) { setError('Wybierz co najmniej jednego pracownika.'); return }
    if (!startDate || !endDate) { setError('Podaj zakres dat.'); return }

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      // Build template payload (only enabled days)
      const templatePayload: Record<string, { startTime: string; endTime: string; breakMinutes: number }> = {}
      for (const { key } of DAYS) {
        const cfg = template[key]
        if (cfg.enabled) {
          templatePayload[key] = {
            startTime: cfg.startTime,
            endTime: cfg.endTime,
            breakMinutes: cfg.breakMinutes,
          }
        }
      }

      const res = await fetch('/api/hr/schedules/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeIds: Array.from(selectedEmployeeIds),
          startDate,
          endDate,
          template: templatePayload,
          skipHolidays,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setSuccess(`Zastosowano szablon — ${data.created} wpisów utworzono/zaktualizowano.`)
        setTimeout(() => onApplied(), 1200)
      } else {
        setError(data.error ?? 'Błąd podczas stosowania szablonu.')
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
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl z-10 overflow-hidden"
        style={{ background: 'var(--wd-white)', border: '1px solid var(--wd-border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <div className="flex items-center gap-2">
            <LayoutTemplate size={18} style={{ color: 'var(--wd-sand)' }} />
            <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
              Zastosuj szablon grafiku
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--wd-surface-2)] transition-colors"
          >
            <X size={15} style={{ color: '#94A3B8' }} />
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Preset buttons */}
          <div>
            <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: '#94A3B8' }}>
              Szybki wybór
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  className="px-3 py-1.5 text-xs rounded-lg border font-medium transition-all hover:opacity-90"
                  style={{
                    background: 'var(--wd-surface-2)',
                    borderColor: 'var(--wd-border)',
                    color: 'var(--wd-dark)',
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Day rows */}
          <div>
            <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: '#94A3B8' }}>
              Konfiguracja dni
            </p>
            <div className="space-y-2">
              {DAYS.map(({ key, label }) => {
                const cfg = template[key]
                const net = cfg.enabled ? calcNetMinutes(cfg.startTime, cfg.endTime, cfg.breakMinutes) : 0
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-lg px-3 py-2"
                    style={{ background: 'var(--wd-surface-2)', border: '1px solid var(--wd-border)' }}
                  >
                    {/* Toggle */}
                    <button
                      onClick={() => toggleDay(key, !cfg.enabled)}
                      className="shrink-0 w-5 h-5 rounded flex items-center justify-center transition-all"
                      style={{
                        background: cfg.enabled ? 'var(--wd-dark)' : 'var(--wd-white)',
                        border: `2px solid ${cfg.enabled ? 'var(--wd-dark)' : 'var(--wd-border)'}`,
                      }}
                    >
                      {cfg.enabled && <Check size={10} color="#fff" />}
                    </button>
                    <span
                      className="text-xs font-medium w-24 shrink-0"
                      style={{ color: cfg.enabled ? 'var(--wd-dark)' : '#94A3B8' }}
                    >
                      {label}
                    </span>
                    {cfg.enabled ? (
                      <>
                        <input
                          type="time"
                          value={cfg.startTime}
                          onChange={e => updateDayField(key, 'startTime', e.target.value)}
                          className="text-xs px-2 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-[var(--wd-sand)]"
                          style={{ background: 'var(--wd-white)', borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
                        />
                        <span className="text-xs" style={{ color: '#94A3B8' }}>–</span>
                        <input
                          type="time"
                          value={cfg.endTime}
                          onChange={e => updateDayField(key, 'endTime', e.target.value)}
                          className="text-xs px-2 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-[var(--wd-sand)]"
                          style={{ background: 'var(--wd-white)', borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
                        />
                        <select
                          value={cfg.breakMinutes}
                          onChange={e => updateDayField(key, 'breakMinutes', parseInt(e.target.value, 10))}
                          className="text-xs px-2 py-1 rounded border focus:outline-none ml-1"
                          style={{ background: 'var(--wd-white)', borderColor: 'var(--wd-border)', color: '#64748B' }}
                        >
                          <option value={0}>0 min przerwy</option>
                          <option value={15}>15 min przerwy</option>
                          <option value={30}>30 min przerwy</option>
                          <option value={45}>45 min przerwy</option>
                        </select>
                        {net > 0 && (
                          <span className="text-xs ml-auto shrink-0" style={{ color: '#64748B' }}>
                            = {fmtH(net)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs" style={{ color: '#94A3B8' }}>brak</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wd-dark)' }}>
                Data od
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)]"
                style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wd-dark)' }}>
                Data do
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)]"
                style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)', color: 'var(--wd-dark)' }}
              />
            </div>
          </div>

          {/* Skip holidays */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <button
              onClick={() => setSkipHolidays(v => !v)}
              className="w-5 h-5 rounded flex items-center justify-center shrink-0 transition-all"
              style={{
                background: skipHolidays ? 'var(--wd-dark)' : 'var(--wd-white)',
                border: `2px solid ${skipHolidays ? 'var(--wd-dark)' : 'var(--wd-border)'}`,
              }}
            >
              {skipHolidays && <Check size={10} color="#fff" />}
            </button>
            <span className="text-xs" style={{ color: 'var(--wd-dark)' }}>
              Pomiń dni świąteczne (polskie święta publiczne)
            </span>
          </label>

          {/* Employee list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#94A3B8' }}>
                Pracownicy ({selectedEmployeeIds.size}/{employees.length})
              </p>
              <button
                onClick={toggleAllEmployees}
                className="text-xs underline"
                style={{ color: 'var(--wd-dark)' }}
              >
                {selectedEmployeeIds.size === employees.length ? 'Odznacz wszystkich' : 'Zaznacz wszystkich'}
              </button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {employees.map(emp => (
                <label
                  key={emp.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-[var(--wd-surface-2)]"
                  style={{ border: '1px solid transparent' }}
                >
                  <button
                    onClick={() => toggleEmployee(emp.id)}
                    className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all"
                    style={{
                      background: selectedEmployeeIds.has(emp.id) ? 'var(--wd-dark)' : 'var(--wd-white)',
                      border: `2px solid ${selectedEmployeeIds.has(emp.id) ? 'var(--wd-dark)' : 'var(--wd-border)'}`,
                    }}
                  >
                    {selectedEmployeeIds.has(emp.id) && <Check size={9} color="#fff" />}
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
          className="flex items-center justify-end gap-3 px-6 py-4 border-t shrink-0"
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
            onClick={handleApply}
            disabled={saving || selectedEmployeeIds.size === 0}
            className="flex items-center gap-1.5 px-5 py-2 text-xs rounded-lg font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--wd-dark)', color: '#fff' }}
          >
            <LayoutTemplate size={12} />
            {saving ? 'Stosowanie…' : 'Zastosuj szablon'}
          </button>
        </div>
      </div>
    </div>
  )
}
