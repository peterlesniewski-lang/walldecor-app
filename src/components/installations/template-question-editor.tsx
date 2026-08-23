'use client'

import { useMemo, useState } from 'react'
import type { FormQuestion } from '@/lib/installations/form-visibility'
import type { QuestionPlacement } from '@/lib/installations/question-tree'

export type TemplateQuestionEditorProps = {
  initial?: FormQuestion
  placement: QuestionPlacement
  nextKey?: string
  onCancel: () => void
  onSave: (question: FormQuestion) => void | Promise<void>
}

const typeLabels: Record<FormQuestion['type'], string> = {
  YES_NO_UNKNOWN: 'Tak / Nie / Nie wiem',
  NUMBER: 'Liczba',
  DIMENSION: 'Wymiar',
  TEXT: 'Tekst',
  SINGLE: 'Jedna odpowiedź',
  MULTI: 'Wiele odpowiedzi',
  FILE: 'Plik',
}

const riskLabels: Record<NonNullable<FormQuestion['riskLevel']>, string> = {
  LOW: 'Niskie',
  MEDIUM: 'Średnie',
  HIGH: 'Wysokie',
}

const questionTypes = Object.keys(typeLabels) as FormQuestion['type'][]
const riskLevels = Object.keys(riskLabels) as NonNullable<FormQuestion['riskLevel']>[]

function initialState(initial: FormQuestion | undefined, nextKey: string) {
  return {
    key: initial?.key ?? nextKey,
    label: initial?.label ?? '',
    type: initial?.type ?? 'YES_NO_UNKNOWN' as FormQuestion['type'],
    help: initial?.help ?? '',
    riskLevel: initial?.riskLevel ?? 'LOW' as NonNullable<FormQuestion['riskLevel']>,
    required: initial?.required ?? false,
    options: (initial?.options ?? []).join('\n'),
  }
}

export function TemplateQuestionEditor({ initial, placement, nextKey = 'question-1', onCancel, onSave }: TemplateQuestionEditorProps) {
  const [draft, setDraft] = useState(() => initialState(initial, nextKey))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const isChoice = draft.type === 'SINGLE' || draft.type === 'MULTI'
  const optionValues = useMemo(() => draft.options.split(/[\n,]/).map((item) => item.trim()).filter(Boolean), [draft.options])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const label = draft.label.trim()
    if (!label) {
      setError('Wpisz treść pytania.')
      return
    }
    if (isChoice && optionValues.length === 0) {
      setError('Dodaj co najmniej jedną odpowiedź.')
      return
    }
    if (isChoice && new Set(optionValues).size !== optionValues.length) {
      setError('Odpowiedzi nie mogą się powtarzać.')
      return
    }

    const question: FormQuestion = {
      key: draft.key,
      type: draft.type,
      label,
      ...(draft.help.trim() ? { help: draft.help.trim() } : {}),
      ...(draft.required ? { required: true } : {}),
      ...(draft.riskLevel === 'LOW' ? {} : { riskLevel: draft.riskLevel }),
      ...(isChoice ? { options: optionValues } : {}),
      ...(placement.parentKey ? { condition: { questionKey: placement.parentKey, equals: placement.equals ?? '' } } : {}),
    }

    setSaving(true)
    setError('')
    try {
      await onSave(question)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Nie udało się zapisać pytania.')
    } finally {
      setSaving(false)
    }
  }

  return <form className="wd-template-editor" onSubmit={submit} aria-label={initial ? `Edytuj pytanie ${initial.label}` : 'Dodaj pytanie'}>
    <div className="wd-template-editor__heading">
      <div>
        <p className="data-label">{initial ? 'Edycja pytania' : 'Nowe pytanie'}</p>
        <h3>{initial ? 'Dopracuj treść dla klienta' : 'Dodaj pytanie do ścieżki'}</h3>
      </div>
      <p className="wd-template-editor__hint">Połączenie z poprzednim pytaniem prowadzi mapa ścieżek.</p>
    </div>

    <div className="wd-template-editor__grid">
      <label>Treść pytania
        <input autoFocus aria-label="Treść pytania" value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} />
      </label>
      <label>Typ odpowiedzi
        <select aria-label="Typ odpowiedzi" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as FormQuestion['type'] }))}>
          {questionTypes.map((type) => <option value={type} key={type}>{typeLabels[type]}</option>)}
        </select>
      </label>
      <label>Pomoc dla klienta
        <textarea aria-label="Pomoc dla klienta" value={draft.help} onChange={(event) => setDraft((current) => ({ ...current, help: event.target.value }))} rows={3} />
      </label>
      <label>Poziom ryzyka
        <select aria-label="Poziom ryzyka" value={draft.riskLevel} onChange={(event) => setDraft((current) => ({ ...current, riskLevel: event.target.value as NonNullable<FormQuestion['riskLevel']> }))}>
          {riskLevels.map((level) => <option value={level} key={level}>{riskLabels[level]}</option>)}
        </select>
      </label>
      <label className="wd-template-editor__check"><input type="checkbox" checked={draft.required} onChange={(event) => setDraft((current) => ({ ...current, required: event.target.checked }))} /> Odpowiedź obowiązkowa</label>
      {isChoice && <label className="wd-template-editor__wide">Opcje odpowiedzi
        <textarea aria-label="Opcje odpowiedzi" value={draft.options} onChange={(event) => setDraft((current) => ({ ...current, options: event.target.value }))} placeholder={'Jedna odpowiedź w wierszu'} rows={4} />
      </label>}
    </div>

    {error && <p className="wd-template-editor__error" role="alert">{error}</p>}
    <div className="wd-template-editor__actions">
      <button type="button" className="wd-template-button wd-template-button--quiet" onClick={onCancel} disabled={saving}>Anuluj</button>
      <button type="submit" className="wd-template-button wd-template-button--primary" disabled={saving}>{saving ? 'Zapisywanie…' : 'Zapisz pytanie'}</button>
    </div>
  </form>
}

export { typeLabels as templateQuestionTypeLabels, riskLabels as templateQuestionRiskLabels }
