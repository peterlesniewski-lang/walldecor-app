'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2 } from 'lucide-react'

interface ModuleOption {
  id: string
  name: string
  slug: string
}

interface AreaOption {
  id: string
  name: string
  modules: ModuleOption[]
}

interface ProcedureOption {
  id: string
  title: string
  category: string
}

interface UserOption {
  id: string
  name: string
  email: string
  role: string
}

interface TemplateItemFormState {
  id?: string
  title: string
  description: string
  order: number
  procedureId: string
  defaultOwnerId: string
  dueDayOffset: string
}

interface TemplateFormProps {
  mode: 'create' | 'edit'
  areas: AreaOption[]
  procedures: ProcedureOption[]
  users: UserOption[]
  template?: {
    id: string
    moduleId: string
    name: string
    description: string | null
    active: boolean
    items: Array<{
      id: string
      title: string
      description: string | null
      order: number
      procedureId: string | null
      defaultOwnerId: string | null
      dueDayOffset: number | null
    }>
  }
}

function emptyItem(order: number): TemplateItemFormState {
  return {
    title: '',
    description: '',
    order,
    procedureId: '',
    defaultOwnerId: '',
    dueDayOffset: '',
  }
}

function reorder(items: TemplateItemFormState[]) {
  return items.map((item, index) => ({ ...item, order: index + 1 }))
}

export function TemplateForm({ mode, areas, procedures, users, template }: TemplateFormProps) {
  const router = useRouter()
  const moduleOptions = useMemo(
    () => areas.flatMap((area) => area.modules.map((module) => ({ ...module, areaName: area.name }))),
    [areas],
  )

  const [moduleId, setModuleId] = useState(template?.moduleId ?? moduleOptions[0]?.id ?? '')
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [active, setActive] = useState(template?.active ?? true)
  const [items, setItems] = useState<TemplateItemFormState[]>(
    template?.items.length
      ? template.items
          .sort((a, b) => a.order - b.order)
          .map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description ?? '',
            order: item.order,
            procedureId: item.procedureId ?? '',
            defaultOwnerId: item.defaultOwnerId ?? '',
            dueDayOffset: item.dueDayOffset?.toString() ?? '',
          }))
      : [emptyItem(1)],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateItem(index: number, patch: Partial<TemplateItemFormState>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    setItems(reorder(next))
  }

  function removeItem(index: number) {
    setItems((current) => reorder(current.filter((_, i) => i !== index)))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')

    const payload = {
      moduleId,
      name,
      description: description || null,
      active,
      items: reorder(items)
        .filter((item) => item.title.trim().length > 0)
        .map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description || null,
          order: item.order,
          procedureId: item.procedureId || null,
          defaultOwnerId: item.defaultOwnerId || null,
          dueDayOffset: item.dueDayOffset === '' ? null : Number(item.dueDayOffset),
        })),
    }

    try {
      const res = await fetch(mode === 'edit' ? `/api/operations/templates/${template?.id}` : '/api/operations/templates', {
        method: mode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Nie udało się zapisać szablonu')
      }

      const data = await res.json()
      router.push(`/operations/templates/${data.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać szablonu')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(mode === 'edit' && template ? `/operations/templates/${template.id}` : '/operations/templates')}
            className="rounded-lg border p-2 hover:bg-gray-50"
            aria-label="Wróć"
          >
            <ArrowLeft className="h-4 w-4 text-gray-500" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {mode === 'edit' ? 'Edytuj szablon' : 'Nowy szablon checklisty'}
            </h1>
            <p className="text-sm text-gray-500">Lista zadań, którą można uruchamiać cyklicznie jako wykonanie.</p>
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Zapisuję...' : 'Zapisz'}
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <section className="space-y-4 rounded-xl border bg-white p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600">Moduł</label>
            <select
              value={moduleId}
              onChange={(event) => setModuleId(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              required
            >
              {moduleOptions.map((module) => (
                <option key={module.id} value={module.id}>
                  {module.areaName} / {module.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600">Nazwa</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              placeholder="np. Księgowość - koniec miesiąca"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600">Opis</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              placeholder="Kiedy uruchamiać, czego dotyczy, kto odpowiada..."
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Aktywny szablon
          </label>
        </section>

        <section className="rounded-xl border bg-white">
          <div className="flex items-center justify-between border-b p-4">
            <div>
              <h2 className="font-semibold text-gray-900">Zadania w checkliście</h2>
              <p className="text-sm text-gray-500">Każde zadanie może mieć procedurę how-to i domyślnego właściciela.</p>
            </div>
            <button
              type="button"
              onClick={() => setItems((current) => [...current, emptyItem(current.length + 1)])}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" />
              Dodaj
            </button>
          </div>

          <div className="divide-y">
            {items.map((item, index) => (
              <div key={item.id ?? index} className="grid gap-3 p-4 lg:grid-cols-[44px_1fr_150px]">
                <div className="flex flex-col items-center gap-1">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                    {index + 1}
                  </span>
                  <button type="button" onClick={() => moveItem(index, -1)} className="rounded p-1 hover:bg-gray-100" aria-label="Przesuń wyżej">
                    <ArrowUp className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                  <button type="button" onClick={() => moveItem(index, 1)} className="rounded p-1 hover:bg-gray-100" aria-label="Przesuń niżej">
                    <ArrowDown className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                </div>

                <div className="space-y-3">
                  <input
                    value={item.title}
                    onChange={(event) => updateItem(index, { title: event.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gray-400"
                    placeholder="Nazwa zadania"
                    required={index === 0}
                  />
                  <textarea
                    value={item.description}
                    onChange={(event) => updateItem(index, { description: event.target.value })}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    placeholder="Krótki opis lub kryterium ukończenia"
                  />
                  <div className="grid gap-3 md:grid-cols-3">
                    <select
                      value={item.procedureId}
                      onChange={(event) => updateItem(index, { procedureId: event.target.value })}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    >
                      <option value="">Brak procedury</option>
                      {procedures.map((procedure) => (
                        <option key={procedure.id} value={procedure.id}>
                          {procedure.title}
                        </option>
                      ))}
                    </select>
                    <select
                      value={item.defaultOwnerId}
                      onChange={(event) => updateItem(index, { defaultOwnerId: event.target.value })}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    >
                      <option value="">Bez właściciela</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={item.dueDayOffset}
                      onChange={(event) => updateItem(index, { dueDayOffset: event.target.value })}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                      placeholder="Offset dni"
                    />
                  </div>
                </div>

                <div className="flex items-start justify-end">
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-100 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Usuń
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </form>
  )
}
