'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { formatDuration } from '@/lib/hr/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BreakEntry {
  id: string
  startTime: string
  endTime: string | null
  type: string
}

interface TimeEntryData {
  id: string
  clockIn: string
  clockOut: string | null
  breaks: BreakEntry[]
  totalMinutes: number | null
  breakMinutes: number | null
  overtimeMinutes: number
  notes: string | null
}

interface WeekStats {
  totalMinutes: number
  breakMinutes: number
  todayMinutes: number
  todayBreakMinutes: number
}

interface ClockWidgetProps {
  employeeId: string
  weekStats: WeekStats
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
}

function formatDateHeader(date: Date): string {
  return date.toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function calcBreakMinutes(breaks: BreakEntry[]): number {
  return breaks.reduce((sum, b) => {
    if (!b.endTime) return sum
    const diff = (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000
    return sum + Math.round(diff)
  }, 0)
}

type UIState = 'idle' | 'working' | 'on_break'

// ─── Component ────────────────────────────────────────────────────────────────

export function ClockWidget({ weekStats }: ClockWidgetProps) {
  const [entry, setEntry] = useState<TimeEntryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchCurrent = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/time-tracking/current')
      if (!res.ok) return
      const data = await res.json() as { entry: TimeEntryData | null }
      setEntry(data.entry)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    void fetchCurrent()
  }, [fetchCurrent])

  // Auto-refresh every 60s
  useEffect(() => {
    refreshIntervalRef.current = setInterval(() => { void fetchCurrent() }, 60000)
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    }
  }, [fetchCurrent])

  // Live timer
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)

    if (!entry) {
      setElapsed(0)
      return
    }

    const activeBreak = entry.breaks.find((b) => b.endTime === null)

    const computeElapsed = () => {
      const now = Date.now()
      if (activeBreak) {
        const breakStart = new Date(activeBreak.startTime).getTime()
        return Math.floor((now - breakStart) / 1000)
      }
      const clockIn = new Date(entry.clockIn).getTime()
      return Math.floor((now - clockIn) / 1000)
    }

    setElapsed(computeElapsed())

    intervalRef.current = setInterval(() => {
      setElapsed(computeElapsed())
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [entry])

  const uiState: UIState = !entry
    ? 'idle'
    : entry.breaks.some((b) => b.endTime === null)
    ? 'on_break'
    : 'working'

  const handleClockIn = async () => {
    setActionLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/hr/time-tracking/clock-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Błąd clock-in')
        return
      }
      const d = await res.json() as { entry: TimeEntryData }
      setEntry(d.entry)
    } catch {
      setError('Błąd połączenia')
    } finally {
      setActionLoading(false)
    }
  }

  const handleClockOut = async () => {
    setActionLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/hr/time-tracking/clock-out', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Błąd clock-out')
        return
      }
      const d = await res.json() as { entry: TimeEntryData }
      setEntry(d.entry)
    } catch {
      setError('Błąd połączenia')
    } finally {
      setActionLoading(false)
    }
  }

  const handleBreakStart = async () => {
    setActionLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/hr/time-tracking/break/start', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Błąd przerwy')
        return
      }
      await fetchCurrent()
    } catch {
      setError('Błąd połączenia')
    } finally {
      setActionLoading(false)
    }
  }

  const handleBreakEnd = async () => {
    setActionLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/hr/time-tracking/break/end', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Błąd zakończenia przerwy')
        return
      }
      await fetchCurrent()
    } catch {
      setError('Błąd połączenia')
    } finally {
      setActionLoading(false)
    }
  }

  const now = new Date()
  const completedBreakMinutes = entry ? calcBreakMinutes(entry.breaks) : 0
  const activeBreak = entry?.breaks.find((b) => b.endTime === null)

  // Net work time for today
  const workElapsed = entry
    ? Math.floor((now.getTime() - new Date(entry.clockIn).getTime()) / 1000 / 60) - completedBreakMinutes - (activeBreak ? Math.floor((now.getTime() - new Date(activeBreak.startTime).getTime()) / 1000 / 60) : 0)
    : 0

  const remainingMinutes = Math.max(0, 480 - workElapsed) // 8h = 480min

  if (loading) {
    return (
      <div className="rounded-2xl p-8 flex items-center justify-center min-h-[240px]" style={{ background: '#1E1E1E' }}>
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Main Clock Card ── */}
      <div
        className="rounded-2xl p-6 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #1E1E1E 0%, #2A2A2A 100%)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        }}
      >
        {/* State indicator dot */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-2.5 h-2.5 rounded-full ${uiState === 'idle' ? 'bg-zinc-500' : uiState === 'working' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`}
            />
            <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: uiState === 'idle' ? '#8A8582' : uiState === 'working' ? '#34D399' : '#FBBF24' }}>
              {uiState === 'idle' ? 'Offline' : uiState === 'working' ? 'Pracujesz' : 'Przerwa'}
            </span>
          </div>
          <span className="text-xs" style={{ color: '#8A8582' }}>
            {formatDateHeader(now).charAt(0).toUpperCase() + formatDateHeader(now).slice(1)}
          </span>
        </div>

        {/* Timer display */}
        <div className="mb-6">
          {uiState === 'idle' ? (
            <div className="text-center py-4">
              <p className="text-5xl font-thin tracking-widest text-white/20 num">--:--:--</p>
              <p className="text-sm mt-3" style={{ color: '#8A8582' }}>Nie zacząłeś jeszcze pracy</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-5xl font-thin tracking-widest text-white num">{formatElapsed(elapsed)}</p>
              <p className="text-xs mt-2" style={{ color: '#8A8582' }}>
                {uiState === 'on_break' ? `Przerwa od ${formatTime(activeBreak!.startTime)}` : `Clock in: ${formatTime(entry!.clockIn)}`}
              </p>
            </div>
          )}
        </div>

        {/* Break history */}
        {entry && entry.breaks.filter((b) => b.endTime !== null).length > 0 && (
          <div className="mb-5 space-y-1">
            {entry.breaks.filter((b) => b.endTime !== null).map((b) => (
              <div key={b.id} className="flex items-center gap-2 text-xs" style={{ color: '#8A8582' }}>
                <span>☕</span>
                <span>{formatTime(b.startTime)}–{formatTime(b.endTime!)}</span>
                <span className="ml-auto num">
                  {Math.round((new Date(b.endTime!).getTime() - new Date(b.startTime).getTime()) / 60000)}m
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Stats row */}
        {entry && (
          <div className="grid grid-cols-3 gap-3 mb-5 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="text-center">
              <p className="text-xs mb-1" style={{ color: '#8A8582' }}>Przepracowano</p>
              <p className="text-sm font-semibold text-white num">{formatDuration(Math.max(0, workElapsed))}</p>
            </div>
            <div className="text-center border-x" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <p className="text-xs mb-1" style={{ color: '#8A8582' }}>Przerwy</p>
              <p className="text-sm font-semibold text-white num">{formatDuration(completedBreakMinutes)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs mb-1" style={{ color: '#8A8582' }}>Pozostało</p>
              <p className="text-sm font-semibold num" style={{ color: remainingMinutes > 0 ? '#FBBF24' : '#34D399' }}>
                {remainingMinutes > 0 ? formatDuration(remainingMinutes) : 'Gotowe!'}
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: 'rgba(220,38,38,0.15)', color: '#FCA5A5', border: '1px solid rgba(220,38,38,0.3)' }}>
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          {uiState === 'idle' && (
            <button
              onClick={() => void handleClockIn()}
              disabled={actionLoading}
              className="flex-1 py-3 px-6 rounded-xl font-semibold text-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#16A34A', color: '#fff' }}
              onMouseEnter={(e) => { if (!actionLoading) e.currentTarget.style.background = '#15803D' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#16A34A' }}
            >
              {actionLoading ? 'Ładowanie...' : '▶ Clock In'}
            </button>
          )}

          {uiState === 'working' && (
            <>
              <button
                onClick={() => void handleClockOut()}
                disabled={actionLoading}
                className="flex-1 py-3 px-4 rounded-xl font-semibold text-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#DC2626', color: '#fff' }}
                onMouseEnter={(e) => { if (!actionLoading) e.currentTarget.style.background = '#B91C1C' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#DC2626' }}
              >
                {actionLoading ? '...' : '⏹ Clock Out'}
              </button>
              <button
                onClick={() => void handleBreakStart()}
                disabled={actionLoading}
                className="flex-1 py-3 px-4 rounded-xl font-semibold text-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#D97706', color: '#fff' }}
                onMouseEnter={(e) => { if (!actionLoading) e.currentTarget.style.background = '#B45309' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#D97706' }}
              >
                {actionLoading ? '...' : '☕ Przerwa'}
              </button>
            </>
          )}

          {uiState === 'on_break' && (
            <button
              onClick={() => void handleBreakEnd()}
              disabled={actionLoading}
              className="flex-1 py-3 px-6 rounded-xl font-semibold text-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#D97706', color: '#fff' }}
              onMouseEnter={(e) => { if (!actionLoading) e.currentTarget.style.background = '#B45309' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#D97706' }}
            >
              {actionLoading ? '...' : '▶ Zakończ przerwę'}
            </button>
          )}
        </div>
      </div>

      {/* ── Weekly Stats Card ── */}
      <div
        className="rounded-xl p-5"
        style={{
          background: '#FFFFFF',
          border: '1px solid var(--wd-border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <p className="text-xs font-semibold tracking-widest uppercase mb-4" style={{ color: '#8A8582' }}>
          Ten tydzień
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="data-label mb-1">Godziny</p>
            <p className="text-2xl font-light num" style={{ color: '#1E1E1E' }}>
              {formatDuration(weekStats.totalMinutes)}
            </p>
          </div>
          <div>
            <p className="data-label mb-1">Przerwy</p>
            <p className="text-2xl font-light num" style={{ color: '#1E1E1E' }}>
              {formatDuration(weekStats.breakMinutes)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
