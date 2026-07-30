'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { MonthlyTeamGrid } from './monthly-team-grid'
import { TimeEntryEditModal } from './time-entry-edit-modal'
import {
  buildMonthDateKeys,
  currentMonthParam,
  getAdjacentMonth,
  parseMonthParam,
} from '@/lib/hr/time-tracking/month'
import type {
  TimeTrackingDayEntry,
  TimeTrackingEmployeeRow,
  TimeTrackingRangeData,
} from '@/lib/hr/time-tracking/types'

interface Division {
  id: string
  name: string
}

interface MonthlyTimesheetProps {
  userRole: 'ADMIN' | 'MANAGER'
  divisions: Division[]
  initialMonth: string | null
  initialMode: 'team' | 'employee'
  initialEmployeeId: string | null
  saturdayWorkable: boolean
}

interface MonthlyTimesheetData {
  month: string
  monthStart: string
  monthEnd: string
  days: string[]
  employees: TimeTrackingEmployeeRow[]
  dailyTotals: Record<string, number>
  holidays: TimeTrackingRangeData['holidays']
  saturdayWorkable: boolean
  standardClockIn: string
  standardClockOut: string
}

interface EditModalState {
  employeeId: string
  employeeName: string
  date: string
  entry: TimeTrackingDayEntry | null
}

const MONTH_KEY_ORDER = ['view', 'mode', 'month', 'divisionId', 'employeeId', 'week']

function buildMonthlyHref(
  searchParams: URLSearchParams,
  updates: Record<string, string | null>
): string {
  const next = new URLSearchParams(searchParams.toString())
  Object.entries(updates).forEach(([key, value]) => {
    if (value) next.set(key, value)
    else next.delete(key)
  })

  const ordered = new URLSearchParams()
  MONTH_KEY_ORDER.forEach((key) => {
    next.getAll(key).forEach((value) => ordered.append(key, value))
    next.delete(key)
  })
  next.forEach((value, key) => ordered.append(key, value))
  return `?${ordered.toString()}`
}

function formatMonthLabel(month: string): string {
  const parsed = parseMonthParam(month)
  if (!parsed) return month

  const date = new Date(0)
  date.setFullYear(parsed.year, parsed.month - 1, 1)
  date.setHours(12, 0, 0, 0)
  const label = date.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function MonthlyTimesheet({
  userRole,
  divisions,
  initialMonth,
  initialMode,
  initialEmployeeId,
  saturdayWorkable,
}: MonthlyTimesheetProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const monthParam = searchParams.get('month') ?? initialMonth
  const month = monthParam && parseMonthParam(monthParam) ? monthParam : currentMonthParam()
  const modeParam = searchParams.get('mode')
  const mode = modeParam === 'team' || modeParam === 'employee' ? modeParam : initialMode
  const divisionId = searchParams.get('divisionId') ?? ''
  const employeeId = searchParams.get('employeeId') ?? initialEmployeeId ?? ''

  const [data, setData] = useState<MonthlyTimesheetData | null>(null)
  const [dataScopeKey, setDataScopeKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editModal, setEditModal] = useState<EditModalState | null>(null)
  const requestSequenceRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)

  const refreshData = useCallback(async (): Promise<boolean> => {
    const requestScopeKey = `${month}|${divisionId}`
    const requestSequence = requestSequenceRef.current + 1
    requestSequenceRef.current = requestSequence
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller

    setLoading(true)
    setError(null)

    const isCurrentRequest = () => (
      !controller.signal.aborted && requestSequenceRef.current === requestSequence
    )

    try {
      const params = new URLSearchParams({ month })
      if (divisionId) params.set('divisionId', divisionId)

      const response = await fetch(`/api/hr/time-tracking/monthly?${params.toString()}`, {
        signal: controller.signal,
      })
      if (!isCurrentRequest()) return false
      if (!response.ok) throw new Error('Monthly time tracking request failed')
      const nextData = await response.json() as MonthlyTimesheetData
      if (!isCurrentRequest()) return false
      setData(nextData)
      setDataScopeKey(requestScopeKey)
      return true
    } catch {
      if (!isCurrentRequest()) return false
      setError('Nie udało się pobrać ewidencji. Spróbuj ponownie.')
      return false
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null
        }
      }
    }
  }, [divisionId, month])

  const refreshAfterMutation = useCallback(async () => {
    const refreshed = await refreshData()
    if (!refreshed) {
      throw new Error('Monthly time tracking refresh failed')
    }
  }, [refreshData])

  useEffect(() => {
    void refreshData()
    return () => {
      requestSequenceRef.current += 1
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
    }
  }, [refreshData])

  const pushState = (updates: Record<string, string | null>) => {
    router.push(buildMonthlyHref(
      new URLSearchParams(searchParams.toString()),
      { view: 'month', mode, month, ...updates }
    ))
  }

  const changeDivision = (nextDivisionId: string) => {
    pushState({
      divisionId: nextDivisionId || null,
      employeeId: nextDivisionId === divisionId ? employeeId || null : null,
    })
  }

  const currentScopeKey = `${month}|${divisionId}`
  const visibleData = dataScopeKey === currentScopeKey ? data : null
  const employees = visibleData?.employees ?? []
  const selectedEmployee = employeeId
    ? employees.find((employee) => employee.id === employeeId) ?? null
    : null
  const employeeUnavailable = (
    mode === 'employee' &&
    !!employeeId &&
    !loading &&
    !error &&
    !!visibleData &&
    !selectedEmployee
  )
  const effectiveSaturdayWorkable = visibleData?.saturdayWorkable ?? saturdayWorkable
  const teamDays = visibleData?.days ?? buildMonthDateKeys(month)

  return (
    <div
      data-testid="monthly-mode-shell"
      data-saturday-workable={effectiveSaturdayWorkable}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Oddział"
          value={divisionId}
          onChange={(event) => changeDivision(event.target.value)}
          className="h-9 min-w-44 rounded-md border border-[var(--wd-border)] bg-white px-3 text-sm text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1"
        >
          <option value="">Wszystkie oddziały</option>
          {divisions.map((division) => (
            <option key={division.id} value={division.id}>{division.name}</option>
          ))}
        </select>

        {mode === 'employee' && (
          <select
            aria-label="Pracownik"
            value={selectedEmployee?.id ?? ''}
            onChange={(event) => pushState({ employeeId: event.target.value || null })}
            className="h-9 min-w-52 rounded-md border border-[var(--wd-border)] bg-white px-3 text-sm text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1"
          >
            <option value="">Wybierz pracownika</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName}
              </option>
            ))}
          </select>
        )}

        <div className="flex h-9 items-center overflow-hidden rounded-md border border-[var(--wd-border)] bg-white">
          <button
            type="button"
            aria-label="Poprzedni miesiąc"
            title="Poprzedni miesiąc"
            onClick={() => pushState({ month: getAdjacentMonth(month, -1) })}
            className="grid h-full w-9 place-items-center text-[var(--muted-foreground)] transition-colors hover:bg-[var(--wd-surface-2)] hover:text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wd-dark)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="grid h-full min-w-44 place-items-center border-x border-[var(--wd-border)] px-4 text-sm font-medium text-[var(--wd-text-primary)]">
            {formatMonthLabel(month)}
          </div>
          <button
            type="button"
            aria-label="Następny miesiąc"
            title="Następny miesiąc"
            onClick={() => pushState({ month: getAdjacentMonth(month, 1) })}
            className="grid h-full w-9 place-items-center text-[var(--muted-foreground)] transition-colors hover:bg-[var(--wd-surface-2)] hover:text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wd-dark)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => pushState({ month: currentMonthParam() })}
          className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--wd-border)] px-3 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--wd-surface-2)] hover:text-[var(--wd-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Bieżący miesiąc
        </button>
      </div>

      {employeeUnavailable && (
        <p role="alert" className="text-sm text-[var(--muted-foreground)]">
          Pracownik nie jest dostępny w bieżącym zakresie
        </p>
      )}

      {mode === 'team' ? (
        <div className="relative" aria-busy={loading}>
          <MonthlyTeamGrid
            days={teamDays}
            employees={visibleData?.employees ?? []}
            holidays={visibleData?.holidays ?? []}
            saturdayWorkable={effectiveSaturdayWorkable}
            onEditCell={setEditModal}
          />

          {loading && (
            <div className="absolute inset-0 z-40 flex min-h-80 items-center justify-center rounded-lg bg-white/75">
              <div role="status" aria-label="Ładowanie ewidencji miesięcznej">
                <div
                  className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
                  style={{ borderColor: 'var(--wd-sand)', borderTopColor: 'transparent' }}
                />
              </div>
            </div>
          )}

          {!loading && error && (
            <div
              role="alert"
              className="absolute inset-0 z-40 flex min-h-80 flex-col items-center justify-center gap-3 rounded-lg bg-white/90 px-6 text-center"
            >
              <p className="text-sm text-red-700">{error}</p>
              <button
                type="button"
                onClick={() => void refreshData()}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--wd-border)] px-3 text-sm font-medium text-[var(--wd-text-primary)] transition-colors hover:bg-[var(--wd-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Spróbuj ponownie
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-80 items-center justify-center overflow-hidden rounded-lg border border-[var(--wd-border)] bg-white">
          {loading && (
            <div role="status" aria-label="Ładowanie ewidencji miesięcznej">
              <div
                className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: 'var(--wd-sand)', borderTopColor: 'transparent' }}
              />
            </div>
          )}

          {!loading && error && (
            <div role="alert" className="flex flex-col items-center gap-3 px-6 text-center">
              <p className="text-sm text-red-700">{error}</p>
              <button
                type="button"
                onClick={() => void refreshData()}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--wd-border)] px-3 text-sm font-medium text-[var(--wd-text-primary)] transition-colors hover:bg-[var(--wd-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Spróbuj ponownie
              </button>
            </div>
          )}
        </div>
      )}

      {editModal && (
        <TimeEntryEditModal
          employeeId={editModal.employeeId}
          employeeName={editModal.employeeName}
          date={editModal.date}
          entry={editModal.entry}
          userRole={userRole}
          onClose={() => setEditModal(null)}
          onSaved={refreshAfterMutation}
        />
      )}
    </div>
  )
}
