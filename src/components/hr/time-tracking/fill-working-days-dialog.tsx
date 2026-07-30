'use client'

import { useEffect, useState } from 'react'
import { CalendarRange, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { warsawWallClockToIso } from '@/lib/hr/time-tracking/batch-policy'

interface FillWorkingDaysDialogProps {
  employeeId: string
  employeeName: string
  monthStart: string
  monthEnd: string
  standardClockIn: string
  standardClockOut: string
  onClose: () => void
  onApplied: () => Promise<void>
  onBusyChange: (busy: boolean) => void
}

interface FillRequestRow {
  date: string
  clockIn: string
  clockOut: string
  breakMinutes: number
}

interface FillResponse {
  preview: boolean
  counts: {
    eligible: number
    existing: number
    weekends: number
    holidays: number
    approvedLeave: number
    invalid: number
  }
  rows: Array<{
    date: string
    action: 'create' | 'update' | 'skip'
    reason?: 'existing' | 'weekend' | 'holiday' | 'approved_leave' | 'invalid'
  }>
  saved: Array<{ date: string; entryId: string }>
}

interface PreviewPayload {
  rows: FillRequestRow[]
  overwrite: boolean
}

const COUNT_LABELS: Array<{
  key: keyof FillResponse['counts']
  label: string
}> = [
  { key: 'eligible', label: 'Do zapisania' },
  { key: 'existing', label: 'Istniejące' },
  { key: 'weekends', label: 'Weekendy' },
  { key: 'holidays', label: 'Święta' },
  { key: 'approvedLeave', label: 'Urlopy' },
  { key: 'invalid', label: 'Nieprawidłowe' },
]

function buildDateRange(from: string, to: string): string[] {
  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T00:00:00.000Z`)
  if (
    !Number.isFinite(fromDate.getTime()) ||
    !Number.isFinite(toDate.getTime()) ||
    fromDate > toDate
  ) {
    throw new RangeError('Zakres dat jest nieprawidłowy')
  }

  const result: string[] = []
  const current = new Date(fromDate)
  while (current <= toDate && result.length <= 31) {
    result.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  if (result.length > 31) {
    throw new RangeError('Zakres może obejmować maksymalnie 31 dni')
  }
  return result
}

export function FillWorkingDaysDialog({
  employeeId,
  employeeName,
  monthStart,
  monthEnd,
  standardClockIn,
  standardClockOut,
  onClose,
  onApplied,
  onBusyChange,
}: FillWorkingDaysDialogProps) {
  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(monthEnd)
  const [clockIn, setClockIn] = useState(standardClockIn)
  const [clockOut, setClockOut] = useState(standardClockOut)
  const [breakMinutes, setBreakMinutes] = useState('0')
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<FillResponse | null>(null)
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | null>(null)
  const [refreshPending, setRefreshPending] = useState(false)

  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])

  const invalidatePreview = () => {
    if (refreshPending) return
    setPreview(null)
    setPreviewPayload(null)
    setError(null)
  }

  const requestFill = async (
    payload: PreviewPayload,
    previewOnly: boolean
  ): Promise<FillResponse> => {
    const response = await fetch('/api/hr/time-tracking/monthly/fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId,
        rows: payload.rows,
        overwrite: payload.overwrite,
        preview: previewOnly,
      }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? 'Nie udało się sprawdzić dni roboczych')
    }
    return response.json() as Promise<FillResponse>
  }

  const handlePreview = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (
        dateFrom < monthStart ||
        dateTo > monthEnd
      ) {
        throw new RangeError('Wybierz daty z widocznego miesiąca')
      }
      if (!clockIn || !clockOut) {
        throw new RangeError('Uzupełnij godzinę wejścia i wyjścia')
      }
      const parsedBreakMinutes = Number(breakMinutes)
      if (
        !Number.isInteger(parsedBreakMinutes) ||
        parsedBreakMinutes < 0 ||
        parsedBreakMinutes > 1440
      ) {
        throw new RangeError('Przerwa musi mieć od 0 do 1440 minut')
      }

      const rows = buildDateRange(dateFrom, dateTo).map((date) => ({
        date,
        clockIn: warsawWallClockToIso(date, clockIn),
        clockOut: warsawWallClockToIso(date, clockOut),
        breakMinutes: parsedBreakMinutes,
      }))
      const payload = { rows, overwrite }
      const result = await requestFill(payload, true)
      setPreviewPayload(payload)
      setPreview(result)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Nie udało się sprawdzić dni roboczych'
      )
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async () => {
    if (busy || !previewPayload || refreshPending) return
    setBusy(true)
    setError(null)
    try {
      const result = await requestFill(previewPayload, false)
      setPreview(result)
      try {
        await onApplied()
        onClose()
      } catch {
        setRefreshPending(true)
        setError('Wpisy zapisano, ale nie udało się odświeżyć widoku.')
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Nie udało się zastosować zmian'
      )
    } finally {
      setBusy(false)
    }
  }

  const handleRefreshRetry = async () => {
    if (busy || !refreshPending) return
    setBusy(true)
    setError(null)
    try {
      await onApplied()
      onClose()
    } catch {
      setError('Wpisy zapisano, ale nie udało się odświeżyć widoku.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        aria-modal="true"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault()
        }}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 overflow-hidden border-[var(--wd-border)] bg-white p-0 shadow-2xl"
      >
        <DialogHeader className="shrink-0 border-b border-[var(--wd-border)] px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-[var(--wd-text-primary)]">
            <CalendarRange className="h-4 w-4" aria-hidden="true" />
            Wypełnij dni robocze
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--muted-foreground)]">
            {employeeName}
          </DialogDescription>
        </DialogHeader>

        <form
          className="min-h-0 flex-1 overflow-y-auto"
          onSubmit={(event) => {
            event.preventDefault()
            if (refreshPending) void handleRefreshRetry()
            else if (previewPayload) void handleApply()
            else void handlePreview()
          }}
        >
          <div className="space-y-5 px-5 py-4">
            <fieldset disabled={busy || refreshPending} className="space-y-4">
              <legend className="sr-only">Zakres i godziny pracy</legend>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="fill-date-from"
                    className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]"
                  >
                    Od
                  </label>
                  <input
                    id="fill-date-from"
                    type="date"
                    min={monthStart}
                    max={monthEnd}
                    value={dateFrom}
                    onChange={(event) => {
                      setDateFrom(event.target.value)
                      invalidatePreview()
                    }}
                    className="num h-11 w-full rounded-md border border-[var(--wd-border)] bg-white px-3 text-sm text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60"
                  />
                </div>
                <div>
                  <label
                    htmlFor="fill-date-to"
                    className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]"
                  >
                    Do
                  </label>
                  <input
                    id="fill-date-to"
                    type="date"
                    min={monthStart}
                    max={monthEnd}
                    value={dateTo}
                    onChange={(event) => {
                      setDateTo(event.target.value)
                      invalidatePreview()
                    }}
                    className="num h-11 w-full rounded-md border border-[var(--wd-border)] bg-white px-3 text-sm text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="fill-clock-in"
                    className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]"
                  >
                    Godzina wejścia
                  </label>
                  <input
                    id="fill-clock-in"
                    type="time"
                    value={clockIn}
                    onChange={(event) => {
                      setClockIn(event.target.value)
                      invalidatePreview()
                    }}
                    className="num h-11 w-full rounded-md border border-[var(--wd-border)] bg-white px-3 text-sm text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60"
                  />
                </div>
                <div>
                  <label
                    htmlFor="fill-clock-out"
                    className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]"
                  >
                    Godzina wyjścia
                  </label>
                  <input
                    id="fill-clock-out"
                    type="time"
                    value={clockOut}
                    onChange={(event) => {
                      setClockOut(event.target.value)
                      invalidatePreview()
                    }}
                    className="num h-11 w-full rounded-md border border-[var(--wd-border)] bg-white px-3 text-sm text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60"
                  />
                </div>
                <div>
                  <label
                    htmlFor="fill-break-minutes"
                    className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]"
                  >
                    Przerwa w minutach
                  </label>
                  <input
                    id="fill-break-minutes"
                    type="number"
                    min={0}
                    max={1440}
                    step={1}
                    value={breakMinutes}
                    onChange={(event) => {
                      setBreakMinutes(event.target.value)
                      invalidatePreview()
                    }}
                    className="num h-11 w-full rounded-md border border-[var(--wd-border)] bg-white px-3 text-sm text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60"
                  />
                </div>
              </div>

              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[var(--wd-text-primary)]">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(event) => {
                    setOverwrite(event.target.checked)
                    invalidatePreview()
                  }}
                  className="h-4 w-4 rounded border-[var(--wd-border)] text-[var(--wd-dark)] focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-2"
                />
                Nadpisz istniejące wpisy
              </label>
            </fieldset>

            {preview && (
              <section aria-label="Podsumowanie podglądu" className="border-y border-[var(--wd-border)] py-3">
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
                  {COUNT_LABELS.map(({ key, label }) => (
                    <div key={key} className="min-w-0">
                      <dt className="truncate text-xs text-[var(--muted-foreground)]" title={label}>
                        {label}
                      </dt>
                      <dd className="num mt-0.5 text-base font-semibold text-[var(--wd-text-primary)]">
                        {preview.counts[key]}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {error && (
              <p role="alert" className="break-words text-sm text-red-700">
                {error}
              </p>
            )}
          </div>

          <div className="sticky bottom-0 flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--wd-border)] bg-white px-5 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="h-11 rounded-md px-4 text-sm font-medium text-[var(--wd-text-primary)] transition-colors hover:bg-[var(--wd-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-50"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--wd-dark)] px-4 text-sm font-medium text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {refreshPending
                ? 'Ponów odświeżenie'
                : previewPayload
                  ? 'Zastosuj'
                  : 'Sprawdź'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
