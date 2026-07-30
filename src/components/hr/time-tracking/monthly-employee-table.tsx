'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarRange, Loader2, MoreHorizontal, Save } from 'lucide-react'
import { FillWorkingDaysDialog } from './fill-working-days-dialog'
import { dateKeyToLocalNoon } from '@/lib/hr/time-tracking/month'
import { warsawWallClockToIso } from '@/lib/hr/time-tracking/batch-policy'
import type {
  TimeTrackingDayEntry,
  TimeTrackingEmployeeRow,
  TimeTrackingRangeData,
} from '@/lib/hr/time-tracking/types'
import { formatDuration, isPublicHoliday } from '@/lib/hr/utils'

interface MonthlyEmployeeTableProps {
  employee: TimeTrackingEmployeeRow
  days: string[]
  holidays: TimeTrackingRangeData['holidays']
  saturdayWorkable: boolean
  standardClockIn: string
  standardClockOut: string
  onSaved: () => Promise<void>
  onOpenEntry: (date: string, entry: TimeTrackingDayEntry | null) => void
  dirtyRows: Map<string, MonthlyEmployeeDraftRow>
  onDirtyRowsChange: (rows: Map<string, MonthlyEmployeeDraftRow>) => void
  onBusyChange: (busy: boolean) => void
}

export interface MonthlyEmployeeDraftRow {
  clockIn: string
  clockOut: string
  breakMinutes: number
  error: string | null
}

interface BatchResponse {
  saved: Array<{ date: string; entryId: string }>
  failed: Array<{ date: string; error: string }>
}

const WARSAW_TIME_ZONE = 'Europe/Warsaw'
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
})
const WARSAW_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: WARSAW_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function toWarsawTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? WARSAW_TIME_FORMATTER.format(date) : ''
}

function getInitialRow(entry: TimeTrackingDayEntry | undefined): MonthlyEmployeeDraftRow {
  return {
    clockIn: toWarsawTime(entry?.clockIn),
    clockOut: toWarsawTime(entry?.clockOut),
    breakMinutes: entry?.breakMinutes ?? 0,
    error: null,
  }
}

function rowsMatch(
  left: MonthlyEmployeeDraftRow,
  right: MonthlyEmployeeDraftRow
): boolean {
  return (
    left.clockIn === right.clockIn &&
    left.clockOut === right.clockOut &&
    left.breakMinutes === right.breakMinutes
  )
}

function getHolidayName(
  day: string,
  employee: TimeTrackingEmployeeRow,
  holidays: TimeTrackingRangeData['holidays']
): string | null {
  const configuredHoliday = holidays.find((holiday) => (
    holiday.date === day &&
    (holiday.divisionId === null || holiday.divisionId === employee.divisionId)
  ))
  if (configuredHoliday) return configuredHoliday.name
  return isPublicHoliday(dateKeyToLocalNoon(day)) ? 'Święto państwowe' : null
}

function getBlockedReason(
  day: string,
  employee: TimeTrackingEmployeeRow,
  holidays: TimeTrackingRangeData['holidays'],
  saturdayWorkable: boolean
): string | null {
  const entry = employee.entries[day]
  if (entry?.leaveCode || entry?.leaveType) {
    return entry.leaveCode
      ? `Urlop ${entry.leaveCode}`
      : entry.leaveType ?? 'Urlop'
  }

  const holidayName = getHolidayName(day, employee, holidays)
  if (holidayName) return holidayName

  const weekday = dateKeyToLocalNoon(day).getDay()
  if (weekday === 0) return 'Niedziela'
  if (weekday === 6 && !saturdayWorkable) return 'Dzień wolny'
  return null
}

function calculateNetMinutes(row: MonthlyEmployeeDraftRow): number | null {
  if (!row.clockIn || !row.clockOut) return null
  const [inHour, inMinute] = row.clockIn.split(':').map(Number)
  const [outHour, outMinute] = row.clockOut.split(':').map(Number)
  const grossMinutes = outHour * 60 + outMinute - inHour * 60 - inMinute
  if (grossMinutes <= 0 || row.breakMinutes > grossMinutes) return null
  return grossMinutes - row.breakMinutes
}

function statusLabel(entry: TimeTrackingDayEntry | undefined): string {
  if (!entry?.id) return 'Brak wpisu'
  if (entry.status === 'approved') return 'Zatwierdzony'
  if (entry.status === 'rejected') return 'Odrzucony'
  return 'Oczekujący'
}

export function MonthlyEmployeeTable({
  employee,
  days,
  holidays,
  saturdayWorkable,
  standardClockIn,
  standardClockOut,
  onSaved,
  onOpenEntry,
  dirtyRows,
  onDirtyRowsChange,
  onBusyChange,
}: MonthlyEmployeeTableProps) {
  const [saving, setSaving] = useState(false)
  const [fillOpen, setFillOpen] = useState(false)
  const [fillBusy, setFillBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const busy = saving || fillBusy

  const initialRows = useMemo(() => new Map(
    days.map((day) => [day, getInitialRow(employee.entries[day])])
  ), [days, employee.entries])

  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])

  const updateRow = (
    day: string,
    field: 'clockIn' | 'clockOut',
    value: string
  ) => {
    setSaveError(null)
    const next = new Map(dirtyRows)
    const initial = initialRows.get(day) ?? getInitialRow(undefined)
    const updated = {
      ...(dirtyRows.get(day) ?? initial),
      [field]: value,
      error: null,
    }
    if (rowsMatch(updated, initial)) next.delete(day)
    else next.set(day, updated)
    onDirtyRowsChange(next)
  }

  const saveChanges = async () => {
    if (busy || dirtyRows.size === 0) return

    const invalidDates: string[] = []
    const rows = Array.from(dirtyRows, ([date, draft]) => {
      if (!draft.clockIn || !draft.clockOut) invalidDates.push(date)
      return {
        entryId: employee.entries[date]?.id,
        date,
        clockIn: draft.clockIn ? warsawWallClockToIso(date, draft.clockIn) : '',
        clockOut: draft.clockOut ? warsawWallClockToIso(date, draft.clockOut) : '',
        breakMinutes: draft.breakMinutes,
      }
    })

    if (invalidDates.length > 0) {
      const next = new Map(dirtyRows)
      invalidDates.forEach((date) => {
        const row = next.get(date)
        if (row) {
          next.set(date, {
            ...row,
            error: 'Uzupełnij godzinę wejścia i wyjścia',
          })
        }
      })
      onDirtyRowsChange(next)
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const response = await fetch('/api/hr/time-tracking/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee.id, rows }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error ?? 'Nie udało się zapisać zmian')
      }

      const result = await response.json() as BatchResponse
      const savedDates = new Set(result.saved.map((row) => row.date))
      const failedByDate = new Map(
        result.failed.map((row) => [row.date, row.error])
      )

      const next = new Map(dirtyRows)
      savedDates.forEach((date) => next.delete(date))
      failedByDate.forEach((error, date) => {
        const row = next.get(date)
        if (row) next.set(date, { ...row, error })
      })
      onDirtyRowsChange(next)

      if (result.saved.length > 0) {
        try {
          await onSaved()
        } catch {
          setSaveError('Zmiany zapisano, ale nie udało się odświeżyć widoku.')
        }
      }
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Nie udało się zapisać zmian'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      data-testid="monthly-employee-mode"
      aria-label={`Miesięczna ewidencja: ${employee.firstName} ${employee.lastName}`}
      className="space-y-3"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[var(--wd-text-primary)]">
            {employee.firstName} {employee.lastName}
          </h2>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {employee.divisionName ?? 'Bez przypisanego oddziału'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || dirtyRows.size > 0}
            title={dirtyRows.size > 0
              ? 'Najpierw zapisz albo odrzuć zmiany w tabeli'
              : 'Wypełnij dni robocze'}
            onClick={() => setFillOpen(true)}
            className="flex h-11 items-center gap-1.5 rounded-md border border-[var(--wd-border)] bg-white px-3 text-sm font-medium text-[var(--wd-text-primary)] transition-colors hover:bg-[var(--wd-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarRange className="h-4 w-4" aria-hidden="true" />
            Wypełnij dni robocze
          </button>
          <button
            type="button"
            disabled={busy || dirtyRows.size === 0}
            onClick={() => void saveChanges()}
            className="flex h-11 items-center gap-1.5 rounded-md bg-[var(--wd-dark)] px-3 text-sm font-medium text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Zapisz zmiany ({dirtyRows.size})
          </button>
        </div>
      </div>

      {saveError && (
        <p role="alert" className="text-sm text-red-700">{saveError}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--wd-border)] bg-white">
        <table
          aria-label="Miesięczna ewidencja wybranego pracownika"
          className="w-full min-w-[920px] table-fixed border-collapse text-xs"
        >
          <colgroup>
            <col className="w-[128px]" />
            <col className="w-[108px]" />
            <col className="w-[112px]" />
            <col className="w-[112px]" />
            <col className="w-[76px]" />
            <col className="w-[88px]" />
            <col className="w-[240px]" />
            <col className="w-[48px]" />
          </colgroup>
          <thead>
            <tr className="h-11 border-b-2 border-[var(--wd-border)] bg-[var(--wd-surface-2)] text-left text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">
              <th scope="col" className="px-3">Dzień</th>
              <th scope="col" className="px-3">Stan</th>
              <th scope="col" className="px-2">Wejście</th>
              <th scope="col" className="px-2">Wyjście</th>
              <th scope="col" className="px-2 text-right">Przerwa</th>
              <th scope="col" className="px-2 text-right">Netto</th>
              <th scope="col" className="px-3">Walidacja</th>
              <th scope="col"><span className="sr-only">Akcje</span></th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const entry = employee.entries[day]
              const initial = initialRows.get(day) ?? getInitialRow(entry)
              const draft = dirtyRows.get(day) ?? initial
              const blockedReason = getBlockedReason(
                day,
                employee,
                holidays,
                saturdayWorkable
              )
              const readOnly = Boolean(blockedReason)
              const netMinutes = calculateNetMinutes(draft)

              return (
                <tr
                  key={day}
                  data-testid={`monthly-employee-row-${day}`}
                  className="h-24 border-b border-[var(--wd-border)] last:border-b-0"
                >
                  <th scope="row" className="px-3 text-left">
                    <span className="block font-medium text-[var(--wd-text-primary)]">
                      {WEEKDAY_FORMATTER.format(dateKeyToLocalNoon(day))}
                    </span>
                    <span className="num block text-[10px] text-[var(--muted-foreground)]">
                      {day}
                    </span>
                  </th>
                  <td className="px-3">
                    <span
                      className={`inline-flex max-w-full truncate rounded px-1.5 py-1 text-[10px] font-medium ${
                        readOnly
                          ? 'bg-[var(--wd-surface-2)] text-[var(--muted-foreground)]'
                          : entry?.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700'
                            : entry?.status === 'rejected'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-amber-50 text-amber-800'
                      }`}
                      title={blockedReason ?? statusLabel(entry)}
                    >
                      {blockedReason ?? statusLabel(entry)}
                    </span>
                  </td>
                  <td className="px-2">
                    <input
                      type="time"
                      aria-label={`Wejście ${day}`}
                      aria-invalid={Boolean(draft.error)}
                      aria-describedby={draft.error
                        ? `monthly-employee-error-${day}`
                        : undefined}
                      value={draft.clockIn}
                      disabled={readOnly || busy}
                      onChange={(event) => updateRow(day, 'clockIn', event.target.value)}
                      className="h-9 w-full rounded-md border border-[var(--wd-border)] bg-white px-2 text-sm text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-[var(--wd-surface-2)] disabled:text-[var(--muted-foreground)]"
                    />
                  </td>
                  <td className="px-2">
                    <input
                      type="time"
                      aria-label={`Wyjście ${day}`}
                      aria-invalid={Boolean(draft.error)}
                      aria-describedby={draft.error
                        ? `monthly-employee-error-${day}`
                        : undefined}
                      value={draft.clockOut}
                      disabled={readOnly || busy}
                      onChange={(event) => updateRow(day, 'clockOut', event.target.value)}
                      className="h-9 w-full rounded-md border border-[var(--wd-border)] bg-white px-2 text-sm text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-[var(--wd-surface-2)] disabled:text-[var(--muted-foreground)]"
                    />
                  </td>
                  <td className="num px-2 text-right text-[var(--muted-foreground)]">
                    {draft.breakMinutes} min
                  </td>
                  <td className="num px-2 text-right font-medium text-[var(--wd-text-primary)]">
                    {netMinutes === null ? '—' : formatDuration(netMinutes)}
                  </td>
                  <td className="px-3">
                    <p
                      id={`monthly-employee-error-${day}`}
                      aria-live="polite"
                      title={draft.error ?? undefined}
                      className="line-clamp-2 min-h-8 break-words text-xs leading-4 text-red-700"
                    >
                      {draft.error}
                    </p>
                  </td>
                  <td className="px-1 text-center">
                    {entry?.id && (
                      <button
                        type="button"
                        aria-label={`Szczegóły wpisu ${day}`}
                        title="Szczegóły wpisu"
                        disabled={busy}
                        onClick={() => onOpenEntry(day, entry)}
                        className="inline-grid h-9 w-9 place-items-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--wd-surface-2)] hover:text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {fillOpen && days[0] && days.at(-1) && (
        <FillWorkingDaysDialog
          employeeId={employee.id}
          employeeName={`${employee.firstName} ${employee.lastName}`}
          monthStart={days[0]}
          monthEnd={days.at(-1)!}
          standardClockIn={standardClockIn}
          standardClockOut={standardClockOut}
          onBusyChange={setFillBusy}
          onApplied={onSaved}
          onClose={() => setFillOpen(false)}
        />
      )}
    </section>
  )
}
