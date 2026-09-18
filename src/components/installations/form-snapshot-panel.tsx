'use client'

import { useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

type PublishedTemplate = { id: string; name: string; version: number }
type FormSnapshot = { id: string; templateId: string; templateVersion: number; schemaJson: string }
type SnapshotSchema = { name?: unknown; version?: unknown; questions?: unknown }

function readSnapshotSummary(snapshot: FormSnapshot) {
  try {
    const schema = JSON.parse(snapshot.schemaJson) as SnapshotSchema
    return {
      name: typeof schema.name === 'string' ? schema.name : 'Formularz',
      version: typeof schema.version === 'number' ? schema.version : snapshot.templateVersion,
      questions: Array.isArray(schema.questions)
        ? schema.questions.flatMap((question) => typeof question === 'object' && question && typeof (question as { label?: unknown }).label === 'string'
          ? [(question as { label: string }).label]
          : [])
        : [],
    }
  } catch {
    return { name: 'Formularz', version: snapshot.templateVersion, questions: [] }
  }
}

export function InstallationFormSnapshotPanel({
  orderId,
  publishedTemplates,
  initialSnapshot,
  canEdit,
  isArchived,
  canReplace = true,
  onSelected,
}: {
  orderId: string
  publishedTemplates: PublishedTemplate[]
  initialSnapshot: FormSnapshot | null
  canEdit: boolean
  isArchived: boolean
  canReplace?: boolean
  onSelected?: (snapshot: FormSnapshot) => void
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [previousSnapshot, setPreviousSnapshot] = useState(initialSnapshot)
  if (previousSnapshot !== initialSnapshot) {
    setPreviousSnapshot(initialSnapshot)
    setSnapshot(initialSnapshot)
  }
  const [templateId, setTemplateId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [changing, setChanging] = useState(false)

  async function pinSnapshot() {
    if (!templateId) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/form-snapshot`, {
        method: snapshot ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId, ...(snapshot ? { expectedSnapshotId: snapshot.id } : {}) }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error ?? 'Nie udało się przypiąć formularza.')
      setSnapshot(result as FormSnapshot)
      onSelected?.(result as FormSnapshot)
      setTemplateId('')
      setChanging(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się połączyć z serwerem.')
    } finally {
      setBusy(false)
    }
  }

  const panelStyle = { background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }
  if (snapshot && !changing) {
    const summary = readSnapshotSummary(snapshot)
    return <section aria-labelledby="form-snapshot-heading" className="mb-7 rounded-2xl border p-5 sm:p-6" style={panelStyle}>
      <h3 id="form-snapshot-heading" className="font-bold">Formularz dla tego zlecenia</h3>
      <p className="mt-4 font-bold" style={{ color: 'var(--wd-dark)' }}>{summary.name} · wersja {summary.version}</p>
      <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Ta wersja pytań pozostaje zachowana w historii zlecenia.</p>
      {summary.questions.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Pokaż pytania</summary><ul className="mt-3 list-disc space-y-1 pl-5 text-sm" style={{ color: 'var(--wd-text-muted)' }}>{summary.questions.map((label, index) => <li key={`${label}-${index}`}>{label}</li>)}</ul></details>}
      {canEdit && !isArchived && canReplace && <button type="button" className="mt-3 min-h-11 rounded-lg border px-4 text-sm font-semibold" onClick={() => setChanging(true)}>Zmień formularz</button>}
    </section>
  }

  return <section aria-labelledby="form-snapshot-heading" className="mb-7 rounded-2xl border p-5 sm:p-6" style={panelStyle}>
    <div className="flex items-start gap-3"><ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0" style={{ color: '#8C5718' }} /><h3 id="form-snapshot-heading" className="font-bold">Formularz dla tego zlecenia</h3></div>
    {changing && <p className="mt-3 text-sm">Zmiana jest możliwa wyłącznie przed utworzeniem linku i rozpoczęciem odpowiedzi klienta. Poprzedni wybór zostanie zapisany w historii.</p>}
    {isArchived ? <p className="mt-4 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Karta jest zarchiwizowana — nie można wybrać nowego formularza.</p>
      : !canEdit ? <p className="mt-4 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Nie wybrano formularza. Tylko osoba uprawniona do edycji karty może to zrobić.</p>
        : publishedTemplates.length === 0 ? <p className="mt-4 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak opublikowanych formularzy. Administrator może opublikować wersję w katalogu montaży.</p>
          : <div className="mt-4 flex flex-wrap items-end gap-3" aria-busy={busy}>
            <label className="grid min-w-0 max-w-full flex-1 basis-64 gap-1 text-sm font-bold" style={{ color: 'var(--wd-dark)' }}>Wersja formularza dla zlecenia
              <select aria-label="Wersja formularza dla zlecenia" value={templateId} disabled={busy} onChange={(event) => setTemplateId(event.target.value)} className="min-h-11 w-full min-w-0 max-w-full rounded-lg border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ background: 'var(--wd-sand-light)', borderColor: 'rgba(30, 30, 30, 0.14)' }}>
                <option value="">Wybierz opublikowaną wersję</option>
                {publishedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · wersja {template.version}</option>)}
              </select>
            </label>
            <Button type="button" disabled={!templateId || busy} onClick={pinSnapshot} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}>{busy ? 'Zapisywanie…' : changing ? 'Zapisz wybór formularza' : 'Wybierz formularz'}</Button>
            {changing && <Button type="button" disabled={busy} onClick={() => { setChanging(false); setTemplateId(''); setError('') }}>Anuluj</Button>}
          </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>
}
