'use client'

import { useMemo, useState, useTransition } from 'react'
import { Check, Circle, CircleAlert, Loader2, Play } from 'lucide-react'
import { ArticleViewer } from '@/components/wikipedia/ArticleViewer'
import { ProgressBar } from './progress-bar'
import { StatusBadge } from './status-badge'
import { formatClosingPeriod, MONTHS } from '@/lib/operations/run-factory'

interface RunItem {
  id: string
  title: string
  description: string | null
  order: number
  procedureId: string | null
  ownerId: string | null
  status: string
  note: string | null
}

interface Procedure {
  id: string
  title: string
  content: string
}

interface RunDetail {
  id: string
  name: string
  status: string
  periodYear: number
  periodMonth: number | null
  canEditPeriod: boolean
  template: {
    module: {
      name: string
      area: { name: string }
    }
  }
  progress: {
    total: number
    done: number
    blocked: number
    percent: number
  }
  items: RunItem[]
  procedures: Procedure[]
}

const STATUS_OPTIONS = [
  { id: 'todo', label: 'Do zrobienia', icon: Circle },
  { id: 'in_progress', label: 'W toku', icon: Play },
  { id: 'blocked', label: 'Bloker', icon: CircleAlert },
  { id: 'done', label: 'Gotowe', icon: Check },
]

function recalculateProgress(items: RunItem[]) {
  const total = items.length
  const done = items.filter((item) => item.status === 'done').length
  const blocked = items.filter((item) => item.status === 'blocked').length
  return {
    total,
    done,
    blocked,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  }
}

export function RunDetailClient({ initialRun }: { initialRun: RunDetail }) {
  const [runName, setRunName] = useState(initialRun.name)
  const [periodYear, setPeriodYear] = useState(initialRun.periodYear)
  const [periodMonth, setPeriodMonth] = useState(initialRun.periodMonth ?? 1)
  const [items, setItems] = useState(initialRun.items)
  const [selectedId, setSelectedId] = useState(initialRun.items[0]?.id ?? '')
  const [note, setNote] = useState(initialRun.items[0]?.note ?? '')
  const [periodSaving, setPeriodSaving] = useState(false)
  const [isPending, startTransition] = useTransition()

  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0]
  const progress = recalculateProgress(items)
  const procedureById = useMemo(
    () => new Map(initialRun.procedures.map((procedure) => [procedure.id, procedure])),
    [initialRun.procedures]
  )
  const selectedProcedure = selectedItem?.procedureId ? procedureById.get(selectedItem.procedureId) : null

  function selectItem(item: RunItem) {
    setSelectedId(item.id)
    setNote(item.note ?? '')
  }

  function updateItem(data: { status?: string; note?: string | null }) {
    if (!selectedItem) return

    startTransition(async () => {
      const res = await fetch(`/api/operations/runs/${initialRun.id}/items/${selectedItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) return
      const updated = (await res.json()) as RunItem
      setItems((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)))
      setNote(updated.note ?? '')
    })
  }

  async function updatePeriod() {
    setPeriodSaving(true)
    const res = await fetch(`/api/operations/runs/${initialRun.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodYear, periodMonth }),
    })
    setPeriodSaving(false)
    if (!res.ok) return
    const updated = (await res.json()) as { name: string; periodYear: number; periodMonth: number | null }
    setRunName(updated.name)
    setPeriodYear(updated.periodYear)
    setPeriodMonth(updated.periodMonth ?? 1)
  }

  return (
    <div>
      <div className="mb-6 rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{runName}</h1>
              <StatusBadge status={initialRun.status} />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {initialRun.template.module.area.name} / {initialRun.template.module.name}
            </p>
            <div className="mt-3">
              {initialRun.canEditPeriod ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Zamykany miesiąc
                    </label>
                    <select
                      value={periodMonth}
                      onChange={(event) => setPeriodMonth(Number(event.target.value))}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    >
                      {MONTHS.map((month, index) => (
                        <option key={month} value={index + 1}>
                          {month}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Rok
                    </label>
                    <input
                      type="number"
                      min={2020}
                      max={2100}
                      value={periodYear}
                      onChange={(event) => setPeriodYear(Number(event.target.value))}
                      className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={updatePeriod}
                    disabled={periodSaving}
                    className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                  >
                    {periodSaving ? 'Zapisuję...' : 'Zapisz okres'}
                  </button>
                </div>
              ) : (
                <p className="text-sm font-medium text-gray-700">
                  Zamykany okres: {formatClosingPeriod(periodYear, periodMonth)}
                </p>
              )}
            </div>
          </div>
          <div className="min-w-52">
            <div className="mb-2 flex justify-between text-xs font-medium text-gray-500">
              <span>Postęp</span>
              <span>
                {progress.done}/{progress.total}
              </span>
            </div>
            <ProgressBar percent={progress.percent} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[440px_1fr]">
        <div className="rounded-xl border bg-white">
          <div className="border-b p-4">
            <h2 className="font-semibold text-gray-900">Checklist</h2>
            <p className="text-xs text-gray-500">{progress.blocked} blokerów</p>
          </div>
          <div className="divide-y">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => selectItem(item)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-gray-50 ${
                  item.id === selectedItem?.id ? 'bg-gray-50' : ''
                }`}
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                  {item.order}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-gray-900">{item.title}</span>
                  {item.description && <span className="mt-0.5 block text-xs text-gray-500">{item.description}</span>}
                </span>
                <StatusBadge status={item.status} />
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-white">
          {selectedItem ? (
            <div>
              <div className="border-b p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Zadanie</p>
                    <h2 className="mt-1 text-lg font-bold text-gray-900">{selectedItem.title}</h2>
                    {selectedItem.description && <p className="mt-1 text-sm text-gray-500">{selectedItem.description}</p>}
                  </div>
                  <StatusBadge status={selectedItem.status} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.id}
                        onClick={() => updateItem({ status: option.id })}
                        disabled={isPending}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                          selectedItem.status === option.id
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {option.label}
                      </button>
                    )
                  })}
                  {isPending && <Loader2 className="h-5 w-5 animate-spin text-gray-400" />}
                </div>

                <div className="mt-4">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Notatka / bloker
                  </label>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    onBlur={() => updateItem({ note })}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                    placeholder="Co blokuje zadanie albo co trzeba zapamiętać?"
                  />
                </div>
              </div>

              <div className="p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">How-to</p>
                {selectedProcedure ? (
                  <ArticleViewer content={selectedProcedure.content} />
                ) : (
                  <div className="rounded-lg bg-gray-50 p-5 text-sm text-gray-500">
                    To zadanie nie ma jeszcze podpiętej procedury. Można ją dodać w szablonie.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-sm text-gray-500">Brak zadań w tym wykonaniu.</div>
          )}
        </div>
      </div>
    </div>
  )
}
