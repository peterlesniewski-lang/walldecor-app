'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Circle, CircleAlert, Loader2, Play } from 'lucide-react'
import { ArticleViewer } from '@/components/wikipedia/ArticleViewer'
import { ProgressBar } from './progress-bar'
import { RunTaskForm, type ProcedureOption, type TaskFormValues } from './run-task-form'
import { RunTaskList } from './run-task-list'
import { StatusBadge } from './status-badge'
import {
  calculateRunProgress,
  formatClosingPeriod,
  isReadyToClose,
  MONTHS,
} from '@/lib/operations/run-factory'

interface RunItem {
  id: string
  title: string
  description: string | null
  order: number
  procedureId: string | null
  ownerId: string | null
  status: string
  note: string | null
  recurring: boolean
}

interface Procedure {
  id: string
  title: string
  content: string
}

type ItemResponse = RunItem & { procedure: Procedure | null }

interface RunDetail {
  id: string
  name: string
  status: string
  periodYear: number
  periodMonth: number | null
  canManage: boolean
  template: {
    module: {
      name: string
      area: { name: string }
    }
  }
  items: RunItem[]
  procedures: Procedure[]
  procedureOptions: ProcedureOption[]
}

type FormState = { mode: 'add' } | { mode: 'edit'; itemId: string } | null

const STATUS_OPTIONS = [
  { id: 'todo', label: 'Do zrobienia', icon: Circle },
  { id: 'in_progress', label: 'W toku', icon: Play },
  { id: 'blocked', label: 'Bloker', icon: CircleAlert },
  { id: 'done', label: 'Gotowe', icon: Check },
]

const SAVE_ERROR = 'Nie udało się zapisać zmiany. Odśwież stronę i spróbuj ponownie.'

// Returns null for any failure (network error, non-2xx status, unreadable body) so callers show SAVE_ERROR
// instead of throwing inside a transition, which would reach the React error boundary.
async function requestJson<T>(url: string, method: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function RunDetailClient({ initialRun }: { initialRun: RunDetail }) {
  const router = useRouter()
  const [runName, setRunName] = useState(initialRun.name)
  const [runStatus, setRunStatus] = useState(initialRun.status)
  // The saved closing period is what the header shows; the draft is only what the period inputs currently hold.
  const [periodYear, setPeriodYear] = useState(initialRun.periodYear)
  const [periodMonth, setPeriodMonth] = useState(initialRun.periodMonth ?? 1)
  const [draftPeriodYear, setDraftPeriodYear] = useState(initialRun.periodYear)
  const [draftPeriodMonth, setDraftPeriodMonth] = useState(initialRun.periodMonth ?? 1)
  const [items, setItems] = useState(initialRun.items)
  const [procedures, setProcedures] = useState(initialRun.procedures)
  const [selectedId, setSelectedId] = useState(initialRun.items[0]?.id ?? '')
  const [form, setForm] = useState<FormState>(null)
  const [error, setError] = useState<string | null>(null)
  const [periodSaving, setPeriodSaving] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [isPending, startTransition] = useTransition()
  // Latest PATCH request number per item, so a response that arrives after a newer request was sent is not merged.
  const patchRequests = useRef<Record<string, number>>({})
  // Number of the latest reorder request, so a failure of an older one does not undo a newer order.
  const reorderRequests = useRef(0)

  const { canManage } = initialRun
  const isOpen = runStatus === 'open'
  const canEditList = canManage && isOpen
  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0]
  const editedItem = form?.mode === 'edit' ? items.find((item) => item.id === form.itemId) : undefined
  const progress = calculateRunProgress(items)
  // Only managers see every task of the run; an employee's own tasks being done does not mean the run is ready.
  const displayStatus = runStatus === 'open' && canManage && isReadyToClose(items) ? 'ready' : runStatus
  const procedureById = useMemo(
    () => new Map(procedures.map((procedure) => [procedure.id, procedure])),
    [procedures]
  )
  const selectedProcedure = selectedItem?.procedureId ? procedureById.get(selectedItem.procedureId) : null

  function registerProcedure(procedure: Procedure | null) {
    if (!procedure) return
    setProcedures((current) => (current.some((entry) => entry.id === procedure.id) ? current : [...current, procedure]))
  }

  function selectItem(id: string) {
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    setSelectedId(item.id)
    setForm(null)
  }

  function patchItem(itemId: string, data: object, onDone?: () => void) {
    const requestNumber = (patchRequests.current[itemId] ?? 0) + 1
    patchRequests.current[itemId] = requestNumber
    startTransition(async () => {
      const updated = await requestJson<ItemResponse>(
        `/api/operations/runs/${initialRun.id}/items/${itemId}`,
        'PATCH',
        data
      )
      if (!updated) {
        setError(SAVE_ERROR)
        return
      }
      const { procedure, ...item } = updated
      registerProcedure(procedure)
      // A superseded response must not merge into the list, nor clear the alert of a newer failure.
      if (patchRequests.current[itemId] === requestNumber) {
        setError(null)
        setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, ...item } : entry)))
      }
      onDone?.()
    })
  }

  function toggleDone(itemId: string) {
    const item = items.find((entry) => entry.id === itemId)
    if (!item) return
    patchItem(itemId, { status: item.status === 'done' ? 'todo' : 'done' })
  }

  function addTask(values: TaskFormValues) {
    startTransition(async () => {
      const created = await requestJson<ItemResponse>(`/api/operations/runs/${initialRun.id}/items`, 'POST', values)
      if (!created) {
        setError(SAVE_ERROR)
        return
      }
      setError(null)
      const { procedure, ...item } = created
      registerProcedure(procedure)
      setItems((current) => [...current, item])
      setSelectedId(item.id)
      setForm(null)
    })
  }

  function deleteTask(itemId: string) {
    const firstRemainingId = items.find((item) => item.id !== itemId)?.id ?? ''
    startTransition(async () => {
      const result = await requestJson<{ ok: boolean }>(
        `/api/operations/runs/${initialRun.id}/items/${itemId}`,
        'DELETE'
      )
      if (!result) {
        setError(SAVE_ERROR)
        return
      }
      setError(null)
      // Functional updates: other saves may have landed while the DELETE was in flight.
      setItems((current) =>
        current.filter((item) => item.id !== itemId).map((item, index) => ({ ...item, order: index + 1 }))
      )
      setSelectedId((current) => (current === itemId ? firstRemainingId : current))
      setForm((current) => (current?.mode === 'edit' && current.itemId === itemId ? null : current))
    })
  }

  function reorderTasks(orderedIds: string[]) {
    const previous = new Map(items.map((item, index) => [item.id, { index, order: item.order }]))
    const requestNumber = reorderRequests.current + 1
    reorderRequests.current = requestNumber
    const byId = new Map(items.map((item) => [item.id, item]))
    setItems(
      orderedIds.flatMap((id, index) => {
        const item = byId.get(id)
        return item ? [{ ...item, order: index + 1 }] : []
      })
    )
    startTransition(async () => {
      const result = await requestJson<{ ok: boolean }>(
        `/api/operations/runs/${initialRun.id}/items/order`,
        'PUT',
        { itemIds: orderedIds }
      )
      if (!result) {
        // A newer reorder was sent meanwhile; the server holds that one, so there is nothing to roll back.
        if (reorderRequests.current !== requestNumber) return
        // Put back only the ordering, so saves that landed in the meantime (status, notes, new tasks) survive.
        const positionOf = (id: string) => previous.get(id)?.index ?? previous.size
        setItems((current) =>
          current
            .map((item) => ({ ...item, order: previous.get(item.id)?.order ?? item.order }))
            .sort((a, b) => positionOf(a.id) - positionOf(b.id))
        )
        setError(SAVE_ERROR)
        return
      }
      setError(null)
    })
  }

  function changeRunStatus(next: 'open' | 'closed') {
    setStatusSaving(true)
    startTransition(async () => {
      const updated = await requestJson<{ status: string }>(`/api/operations/runs/${initialRun.id}`, 'PATCH', {
        status: next,
      })
      setStatusSaving(false)
      if (!updated) {
        setError(SAVE_ERROR)
        return
      }
      setError(null)
      setRunStatus(updated.status)
      setForm(null)
      router.refresh()
    })
  }

  async function updatePeriod() {
    setPeriodSaving(true)
    const updated = await requestJson<{ name: string; periodYear: number; periodMonth: number | null }>(
      `/api/operations/runs/${initialRun.id}`,
      'PATCH',
      { periodYear: draftPeriodYear, periodMonth: draftPeriodMonth }
    )
    setPeriodSaving(false)
    if (!updated) {
      setError(SAVE_ERROR)
      return
    }
    setError(null)
    setRunName(updated.name)
    setPeriodYear(updated.periodYear)
    setPeriodMonth(updated.periodMonth ?? 1)
    setDraftPeriodYear(updated.periodYear)
    setDraftPeriodMonth(updated.periodMonth ?? 1)
  }

  return (
    <div>
      <div className="mb-6 rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{runName}</h1>
              <StatusBadge status={displayStatus} />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {initialRun.template.module.area.name} / {initialRun.template.module.name}
            </p>
            <div className="mt-3">
              {canEditList ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Zamykany miesiąc
                    </label>
                    <select
                      value={draftPeriodMonth}
                      onChange={(event) => setDraftPeriodMonth(Number(event.target.value))}
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
                      value={draftPeriodYear}
                      onChange={(event) => setDraftPeriodYear(Number(event.target.value))}
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
          <div className="flex min-w-52 flex-col items-end gap-3">
            <div className="w-full">
              <div className="mb-2 flex justify-between text-xs font-medium text-gray-500">
                <span>Postęp</span>
                <span>
                  {progress.done}/{progress.total}
                </span>
              </div>
              <ProgressBar percent={progress.percent} />
            </div>
            {canManage && isOpen && (
              <button
                type="button"
                onClick={() => changeRunStatus('closed')}
                disabled={statusSaving}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
                  displayStatus === 'ready'
                    ? 'bg-gray-900 text-white hover:bg-gray-800'
                    : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                }`}
              >
                Zamknij miesiąc
              </button>
            )}
            {canManage && !isOpen && (
              <button
                type="button"
                onClick={() => changeRunStatus('open')}
                disabled={statusSaving}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Otwórz ponownie
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[440px_1fr]">
        <div className="rounded-xl border bg-white">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 className="font-semibold text-gray-900">Checklista</h2>
              <p className="text-xs text-gray-500">{progress.blocked} blokerów</p>
            </div>
            {canEditList && (
              <button
                type="button"
                onClick={() => setForm({ mode: 'add' })}
                className="rounded-lg border border-gray-900 px-3 py-1.5 text-sm font-semibold hover:bg-gray-50"
              >
                + Dodaj zadanie
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="p-5 text-sm text-gray-500">
              Brak zadań w tym wykonaniu.{canEditList ? ' Dodaj pierwsze zadanie przyciskiem powyżej.' : ''}
            </p>
          ) : (
            <RunTaskList
              items={items}
              selectedId={selectedItem?.id ?? ''}
              canToggle={isOpen}
              canEdit={canEditList}
              onSelect={selectItem}
              onToggleDone={toggleDone}
              onReorder={reorderTasks}
              onEdit={(itemId) => setForm({ mode: 'edit', itemId })}
              onDelete={deleteTask}
            />
          )}
        </div>

        <div className="rounded-xl border bg-white">
          {form ? (
            <RunTaskForm
              key={form.mode === 'edit' ? form.itemId : 'new'}
              mode={form.mode}
              initial={
                editedItem
                  ? {
                      title: editedItem.title,
                      description: editedItem.description,
                      procedureId: editedItem.procedureId,
                      recurring: editedItem.recurring,
                    }
                  : undefined
              }
              procedureOptions={initialRun.procedureOptions}
              saving={isPending}
              onSubmit={(values) =>
                form.mode === 'edit' ? patchItem(form.itemId, values, () => setForm(null)) : addTask(values)
              }
              onCancel={() => setForm(null)}
            />
          ) : selectedItem ? (
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
                        onClick={() => patchItem(selectedItem.id, { status: option.id })}
                        disabled={!isOpen}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${
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
                    key={selectedItem.id}
                    defaultValue={selectedItem.note ?? ''}
                    onBlur={(event) => {
                      if (isOpen && event.target.value !== (selectedItem.note ?? '')) {
                        patchItem(selectedItem.id, { note: event.target.value })
                      }
                    }}
                    readOnly={!isOpen}
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
                    To zadanie nie ma jeszcze podpiętej procedury.
                    {canEditList ? ' Możesz ją dodać w menu „⋯” → Edytuj.' : ''}
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
