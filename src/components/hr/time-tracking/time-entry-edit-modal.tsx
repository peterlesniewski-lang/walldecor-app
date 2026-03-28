'use client'

import { useState, useEffect } from 'react'
import { X, CheckCircle, XCircle, Trash2, Save } from 'lucide-react'
import { formatDuration } from '@/lib/hr/utils'

interface DayEntry {
  id?: string
  clockIn?: string
  clockOut?: string | null
  totalMinutes?: number | null
  status?: string
  leaveType?: string
  leaveColor?: string
}

interface TimeEntryEditModalProps {
  employeeId: string
  employeeName: string
  date: string           // "YYYY-MM-DD"
  entry: DayEntry | null
  userRole: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
  onClose: () => void
  onSaved: () => void
}

function toTimeStr(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function TimeEntryEditModal({
  employeeId,
  employeeName,
  date,
  entry,
  userRole,
  onClose,
  onSaved,
}: TimeEntryEditModalProps) {
  const [clockIn, setClockIn] = useState(toTimeStr(entry?.clockIn))
  const [clockOut, setClockOut] = useState(toTimeStr(entry?.clockOut))
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load full entry details on mount if entry exists
  useEffect(() => {
    if (!entry?.id) return
    void (async () => {
      try {
        const res = await fetch(`/api/hr/time-tracking/${entry.id}`)
        if (!res.ok) return
        const data = await res.json() as { clockIn: string; clockOut: string | null; notes: string | null }
        setClockIn(toTimeStr(data.clockIn))
        setClockOut(toTimeStr(data.clockOut))
        setNotes(data.notes ?? '')
      } catch {
        // silent
      }
    })()
  }, [entry?.id])

  // Computed duration preview
  let previewMinutes: number | null = null
  if (clockIn && clockOut) {
    const [ih, im] = clockIn.split(':').map(Number)
    const [oh, om] = clockOut.split(':').map(Number)
    const total = (oh * 60 + om) - (ih * 60 + im)
    if (total > 0) previewMinutes = total
  }

  const canApproveReject = userRole === 'ADMIN' || userRole === 'MANAGER'
  const canDelete = userRole === 'ADMIN'
  const hasEntry = !!entry?.id

  const handleSave = async () => {
    setLoading(true)
    setError(null)
    try {
      if (!clockIn) {
        setError('Godzina clock-in jest wymagana')
        return
      }

      const body: Record<string, unknown> = { notes: notes || undefined }

      // Build full datetime from date + time strings
      const clockInDt = new Date(`${date}T${clockIn}:00`)
      body.clockIn = clockInDt.toISOString()
      if (clockOut) {
        body.clockOut = new Date(`${date}T${clockOut}:00`).toISOString()
        body.totalMinutes = previewMinutes
      }

      if (hasEntry) {
        const res = await fetch(`/api/hr/time-tracking/${entry!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const d = await res.json() as { error?: string }
          setError(d.error ?? 'Błąd zapisu')
          return
        }
      } else {
        // Create new entry
        const res = await fetch('/api/hr/time-tracking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId,
            date,  // "YYYY-MM-DD" — z.coerce.date() parses this correctly
            ...body,
            source: 'manual',
          }),
        })
        if (!res.ok) {
          const d = await res.json() as { error?: string }
          setError(d.error ?? 'Błąd tworzenia wpisu')
          return
        }
      }

      onSaved()
      onClose()
    } catch {
      setError('Błąd połączenia')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async () => {
    if (!entry?.id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hr/time-tracking/${entry.id}/approve`, { method: 'PATCH' })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Błąd zatwierdzenia')
        return
      }
      onSaved()
      onClose()
    } catch {
      setError('Błąd połączenia')
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (!entry?.id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hr/time-tracking/${entry.id}/reject`, { method: 'PATCH' })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Błąd odrzucenia')
        return
      }
      onSaved()
      onClose()
    } catch {
      setError('Błąd połączenia')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!entry?.id || !canDelete) return
    if (!confirm('Czy na pewno usunąć ten wpis?')) return
    setDeleteLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hr/time-tracking/${entry.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Błąd usuwania')
        return
      }
      onSaved()
      onClose()
    } catch {
      setError('Błąd połączenia')
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{
          background: '#fff',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <div>
            <h2 className="font-semibold text-[var(--wd-text-primary)]">
              {hasEntry ? 'Edytuj wpis' : 'Dodaj wpis'}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
              {employeeName} · {formatDateLabel(date)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--wd-surface-2)] transition-colors"
          >
            <X className="w-4 h-4 text-[var(--wd-text-muted)]" />
          </button>
        </div>

        {/* Status badge */}
        {entry?.status && entry.status !== 'leave' && (
          <div className="px-5 pt-4">
            {entry.status === 'approved' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle className="w-3.5 h-3.5" />
                Zatwierdzony
              </span>
            ) : entry.status === 'rejected' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                <XCircle className="w-3.5 h-3.5" />
                Odrzucony
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                Oczekujący
              </span>
            )}
          </div>
        )}

        {/* Form */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="data-label block mb-1.5">Clock In</label>
              <input
                type="time"
                value={clockIn}
                onChange={(e) => setClockIn(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm font-medium num"
                style={{
                  borderColor: 'var(--wd-border)',
                  background: 'var(--wd-off-white)',
                  color: 'var(--wd-text-primary)',
                }}
              />
            </div>
            <div>
              <label className="data-label block mb-1.5">Clock Out</label>
              <input
                type="time"
                value={clockOut}
                onChange={(e) => setClockOut(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm font-medium num"
                style={{
                  borderColor: 'var(--wd-border)',
                  background: 'var(--wd-off-white)',
                  color: 'var(--wd-text-primary)',
                }}
              />
            </div>
          </div>

          {/* Duration preview */}
          {previewMinutes !== null && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: 'var(--wd-surface-2)' }}
            >
              <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>Czas pracy:</span>
              <span className="text-sm font-semibold num" style={{ color: 'var(--wd-text-primary)' }}>
                {formatDuration(previewMinutes)}
              </span>
            </div>
          )}

          <div>
            <label className="data-label block mb-1.5">Notatka</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Opcjonalna notatka..."
              className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
              style={{
                borderColor: 'var(--wd-border)',
                background: 'var(--wd-off-white)',
                color: 'var(--wd-text-primary)',
              }}
            />
          </div>

          {error && (
            <div
              className="px-3 py-2 rounded-lg text-sm"
              style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center gap-2 px-5 py-4 border-t"
          style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-off-white)' }}
        >
          {/* Left: delete */}
          {hasEntry && canDelete && (
            <button
              onClick={() => void handleDelete()}
              disabled={deleteLoading}
              className="p-2 rounded-lg hover:bg-red-50 transition-colors group"
              title="Usuń wpis"
            >
              <Trash2 className="w-4 h-4 text-red-400 group-hover:text-red-600" />
            </button>
          )}

          <div className="flex-1" />

          {/* Approve / Reject */}
          {hasEntry && canApproveReject && entry?.status === 'pending' && (
            <>
              <button
                onClick={() => void handleReject()}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}
              >
                <XCircle className="w-3.5 h-3.5" />
                Odrzuć
              </button>
              <button
                onClick={() => void handleApprove()}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{ background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0' }}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Zatwierdź
              </button>
            </>
          )}

          {/* Save */}
          <button
            onClick={() => void handleSave()}
            disabled={loading || !clockIn}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
            style={{ background: 'var(--wd-dark)', color: '#fff' }}
          >
            <Save className="w-3.5 h-3.5" />
            {loading ? 'Zapisuję...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  )
}
