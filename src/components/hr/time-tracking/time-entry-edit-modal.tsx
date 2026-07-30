'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle, Loader2, Save, Trash2, XCircle } from 'lucide-react'
import { formatDuration } from '@/lib/hr/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
  onSaved: () => void | Promise<void>
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
  const [hydrating, setHydrating] = useState(Boolean(entry?.id))
  const returnFocusRef = useRef<HTMLElement | null>(null)
  if (returnFocusRef.current === null && typeof document !== 'undefined') {
    returnFocusRef.current = document.activeElement as HTMLElement | null
  }

  useEffect(() => {
    setClockIn(toTimeStr(entry?.clockIn))
    setClockOut(toTimeStr(entry?.clockOut))
    setNotes('')
    setError(null)

    if (!entry?.id) {
      setHydrating(false)
      return
    }

    const controller = new AbortController()
    setHydrating(true)

    void (async () => {
      try {
        const res = await fetch(`/api/hr/time-tracking/${entry.id}`, {
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (!res.ok) throw new Error('Time entry detail request failed')
        const data = await res.json() as { clockIn: string; clockOut: string | null; notes: string | null }
        if (controller.signal.aborted) return
        setClockIn(toTimeStr(data.clockIn))
        setClockOut(toTimeStr(data.clockOut))
        setNotes(data.notes ?? '')
      } catch {
        if (!controller.signal.aborted) {
          setError('Nie udało się pobrać szczegółów wpisu')
        }
      } finally {
        if (!controller.signal.aborted) setHydrating(false)
      }
    })()

    return () => controller.abort()
  }, [entry?.clockIn, entry?.clockOut, entry?.id])

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
  const mutationPending = loading || deleteLoading
  const controlsDisabled = hydrating || mutationPending

  const restoreFocus = () => {
    const target = returnFocusRef.current
    queueMicrotask(() => target?.focus())
  }

  const handleSave = async () => {
    if (controlsDisabled) return
    setLoading(true)
    setError(null)
    try {
      if (!clockIn) {
        setError('Godzina wejścia jest wymagana')
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

      await onSaved()
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
      await onSaved()
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
      await onSaved()
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
      await onSaved()
      onClose()
    } catch {
      setError('Błąd połączenia')
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutationPending) onClose()
      }}
    >
      <DialogContent
        aria-modal="true"
        onEscapeKeyDown={(event) => {
          if (mutationPending) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (mutationPending) event.preventDefault()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreFocus()
        }}
        className="max-w-md gap-0 overflow-hidden border-[var(--wd-border)] bg-white p-0 shadow-2xl"
      >
        <DialogHeader className="border-b border-[var(--wd-border)] px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-base font-semibold text-[var(--wd-text-primary)]">
            {hasEntry ? 'Edytuj wpis' : 'Dodaj wpis'}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--muted-foreground)]">
            {employeeName} · {formatDateLabel(date)}
          </DialogDescription>
        </DialogHeader>

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

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSave()
          }}
        >
          <div className="space-y-4 p-5">
            {hydrating && (
              <div
                role="status"
                className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Ładowanie szczegółów wpisu
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="time-entry-clock-in"
                  className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]"
                >
                  Wejście
                </label>
                <input
                  id="time-entry-clock-in"
                  type="time"
                  value={clockIn}
                  onChange={(event) => setClockIn(event.target.value)}
                  disabled={controlsDisabled}
                  className="num w-full rounded-md border border-[var(--wd-border)] bg-[var(--wd-off-white)] px-3 py-2 text-sm font-medium text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60"
                />
              </div>
              <div>
                <label
                  htmlFor="time-entry-clock-out"
                  className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]"
                >
                  Wyjście
                </label>
                <input
                  id="time-entry-clock-out"
                  type="time"
                  value={clockOut}
                  onChange={(event) => setClockOut(event.target.value)}
                  disabled={controlsDisabled}
                  className="num w-full rounded-md border border-[var(--wd-border)] bg-[var(--wd-off-white)] px-3 py-2 text-sm font-medium text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60"
                />
              </div>
            </div>

            {previewMinutes !== null && (
              <div className="flex items-center gap-2 rounded-md bg-[var(--wd-surface-2)] px-3 py-2">
                <span className="text-xs text-[var(--muted-foreground)]">Czas pracy:</span>
                <span className="num text-sm font-semibold text-[var(--wd-text-primary)]">
                  {formatDuration(previewMinutes)}
                </span>
              </div>
            )}

            <div>
              <label
                htmlFor="time-entry-notes"
                className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]"
              >
                Notatka
              </label>
              <textarea
                id="time-entry-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={controlsDisabled}
                rows={2}
                placeholder="Opcjonalna notatka..."
                className="w-full resize-none rounded-md border border-[var(--wd-border)] bg-[var(--wd-off-white)] px-3 py-2 text-sm text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--wd-border)] bg-[var(--wd-off-white)] px-5 py-4">
            {hasEntry && canDelete && (
              <button
                type="button"
                aria-label="Usuń wpis"
                title="Usuń wpis"
                onClick={() => void handleDelete()}
                disabled={controlsDisabled}
                className="group rounded-md p-2 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4 text-red-500 group-hover:text-red-700" />
              </button>
            )}

            <div className="flex-1" />

            {hasEntry && canApproveReject && entry?.status === 'pending' && (
              <>
                <button
                  type="button"
                  onClick={() => void handleReject()}
                  disabled={controlsDisabled}
                  className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Odrzuć
                </button>
                <button
                  type="button"
                  onClick={() => void handleApprove()}
                  disabled={controlsDisabled}
                  className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  Zatwierdź
                </button>
              </>
            )}

            <button
              type="submit"
              disabled={controlsDisabled || !clockIn}
              className="flex items-center gap-1.5 rounded-md bg-[var(--wd-dark)] px-4 py-1.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {loading ? 'Zapisuję...' : 'Zapisz'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
