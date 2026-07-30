'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { currentMonthParam, parseMonthParam } from '@/lib/hr/time-tracking/month'
import { MonthlyTimesheet } from './monthly-timesheet'
import { WeeklyTimesheet } from './weekly-timesheet'

interface Division {
  id: string
  name: string
}

interface ManagerTimesheetProps {
  userRole: 'ADMIN' | 'MANAGER'
  divisions: Division[]
  initialView: 'week' | 'month'
  initialMode: 'team' | 'employee'
  initialWeek: string | null
  initialMonth: string | null
  initialEmployeeId: string | null
  saturdayWorkable: boolean
}

type TimesheetView = ManagerTimesheetProps['initialView']
type MonthlyMode = ManagerTimesheetProps['initialMode']

const MONTH_KEY_ORDER = ['view', 'mode', 'month', 'divisionId', 'employeeId', 'week']
const WEEK_KEY_ORDER = ['view', 'week', 'divisionId', 'mode', 'month', 'employeeId']

function buildTimesheetHref(
  searchParams: URLSearchParams,
  updates: Record<string, string | null>,
  view: TimesheetView
): string {
  const next = new URLSearchParams(searchParams.toString())
  Object.entries(updates).forEach(([key, value]) => {
    if (value) next.set(key, value)
    else next.delete(key)
  })

  const ordered = new URLSearchParams()
  const keyOrder = view === 'month' ? MONTH_KEY_ORDER : WEEK_KEY_ORDER
  keyOrder.forEach((key) => {
    next.getAll(key).forEach((value) => ordered.append(key, value))
    next.delete(key)
  })
  next.forEach((value, key) => ordered.append(key, value))

  return `?${ordered.toString()}`
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid h-9 grid-flow-col auto-cols-fr rounded-md border border-[var(--wd-border)] bg-[var(--wd-surface-2)] p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`min-w-[5.5rem] rounded px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 ${
              selected
                ? 'bg-white text-[var(--wd-text-primary)] shadow-sm'
                : 'text-[var(--muted-foreground)] hover:text-[var(--wd-text-primary)]'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function ManagerTimesheet({
  userRole,
  divisions,
  initialView,
  initialMode,
  initialWeek,
  initialMonth,
  initialEmployeeId,
  saturdayWorkable,
}: ManagerTimesheetProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [hasMonthlyDirtyRows, setHasMonthlyDirtyRows] = useState(false)

  const viewParam = searchParams.get('view')
  const view: TimesheetView = viewParam === 'week' || viewParam === 'month'
    ? viewParam
    : initialView
  const modeParam = searchParams.get('mode')
  const mode: MonthlyMode = modeParam === 'team' || modeParam === 'employee'
    ? modeParam
    : initialMode
  const monthParam = searchParams.get('month') ?? initialMonth
  const month = monthParam && parseMonthParam(monthParam) ? monthParam : currentMonthParam()
  const week = searchParams.get('week') ?? initialWeek

  const changeView = (nextView: TimesheetView) => {
    if (nextView === view) return
    if (
      hasMonthlyDirtyRows &&
      !window.confirm('Masz niezapisane zmiany. Odrzucić je?')
    ) {
      return
    }
    if (nextView === 'month') {
      router.push(buildTimesheetHref(
        new URLSearchParams(searchParams.toString()),
        { view: 'month', mode, month },
        'month'
      ))
      return
    }

    router.push(buildTimesheetHref(
      new URLSearchParams(searchParams.toString()),
      { view: 'week', week },
      'week'
    ))
  }

  const changeMode = (nextMode: MonthlyMode) => {
    if (nextMode === mode) return
    if (
      hasMonthlyDirtyRows &&
      !window.confirm('Masz niezapisane zmiany. Odrzucić je?')
    ) {
      return
    }
    router.push(buildTimesheetHref(
      new URLSearchParams(searchParams.toString()),
      { view: 'month', mode: nextMode, month },
      'month'
    ))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Zakres ewidencji"
          value={view}
          options={[
            { value: 'week', label: 'Tydzień' },
            { value: 'month', label: 'Miesiąc' },
          ]}
          onChange={changeView}
        />

        {view === 'month' && (
          <SegmentedControl
            label="Tryb widoku miesięcznego"
            value={mode}
            options={[
              { value: 'team', label: 'Zespół' },
              { value: 'employee', label: 'Pracownik' },
            ]}
            onChange={changeMode}
          />
        )}
      </div>

      {view === 'week' ? (
        <WeeklyTimesheet
          userRole={userRole}
          divisions={divisions}
          initialWeek={week}
          saturdayWorkable={saturdayWorkable}
        />
      ) : (
        <MonthlyTimesheet
          userRole={userRole}
          divisions={divisions}
          initialMonth={month}
          initialMode={mode}
          initialEmployeeId={searchParams.get('employeeId') ?? initialEmployeeId}
          saturdayWorkable={saturdayWorkable}
          onDirtyChange={setHasMonthlyDirtyRows}
        />
      )}
    </div>
  )
}
