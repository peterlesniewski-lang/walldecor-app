'use client'

import { useState, type FormEvent } from 'react'

export interface TaskFormValues {
  title: string
  description: string | null
  procedureId: string | null
  recurring: boolean
}

export interface ProcedureOption {
  id: string
  title: string
}

const INPUT_CLASS = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400'
const LABEL_CLASS = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500'

export function RunTaskForm({
  mode,
  initial,
  procedureOptions,
  saving,
  onSubmit,
  onCancel,
}: {
  mode: 'add' | 'edit'
  initial?: TaskFormValues
  procedureOptions: ProcedureOption[]
  saving: boolean
  onSubmit: (values: TaskFormValues) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [procedureId, setProcedureId] = useState(initial?.procedureId ?? '')
  const [recurring, setRecurring] = useState(initial?.recurring ?? true)
  const [titleError, setTitleError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (title.trim().length < 3) {
      setTitleError('Tytuł musi mieć co najmniej 3 znaki.')
      return
    }
    onSubmit({
      title: title.trim(),
      description: description.trim() || null,
      procedureId: procedureId || null,
      recurring,
    })
  }

  return (
    <form onSubmit={submit} className="p-5">
      <h2 className="mb-4 text-lg font-bold text-gray-900">{mode === 'add' ? 'Nowe zadanie' : 'Edytuj zadanie'}</h2>

      <div className="mb-3">
        <label htmlFor="task-title" className={LABEL_CLASS}>
          Tytuł zadania
        </label>
        <input
          id="task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={INPUT_CLASS}
          autoFocus
        />
        {titleError && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {titleError}
          </p>
        )}
      </div>

      <div className="mb-3">
        <label htmlFor="task-description" className={LABEL_CLASS}>
          Opis (opcjonalnie)
        </label>
        <textarea
          id="task-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          className={`${INPUT_CLASS} resize-none`}
        />
      </div>

      <div className="mb-4">
        <label htmlFor="task-procedure" className={LABEL_CLASS}>
          Procedura „jak to zrobić” (opcjonalnie)
        </label>
        <select
          id="task-procedure"
          value={procedureId}
          onChange={(event) => setProcedureId(event.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">Bez procedury</option>
          {procedureOptions.map((procedure) => (
            <option key={procedure.id} value={procedure.id}>
              {procedure.title}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={recurring}
          aria-label="Powtarzaj co miesiąc"
          onClick={() => setRecurring((current) => !current)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${recurring ? 'bg-green-600' : 'bg-gray-300'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${recurring ? 'left-[18px]' : 'left-0.5'}`}
          />
        </button>
        <span className="text-sm text-gray-700">
          Powtarzaj co miesiąc
          {!recurring && <span className="ml-1 text-gray-500">(tylko ten miesiąc)</span>}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {mode === 'add' ? 'Dodaj' : 'Zapisz'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50">
          Anuluj
        </button>
      </div>
    </form>
  )
}
