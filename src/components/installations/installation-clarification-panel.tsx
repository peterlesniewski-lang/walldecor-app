'use client'

import { useState } from 'react'

export type InstallationClarificationView = {
  id: string
  status: string
  isBlocking: boolean
  questionKey: string
  reason: string
  revisionNumber: number
  answer: string | null
  createdAt: Date | string
  resolution: string | null
  resolutionNote: string | null
  evidenceReference: string | null
}

export function InstallationClarificationPanel({ orderId, clarifications: initialClarifications, readiness, canEdit, formRevisions = [] }: {
  orderId: string
  clarifications: InstallationClarificationView[]
  readiness: { isReady: boolean; openBlockingCount: number; submittedCount: number }
  canEdit: boolean
  formRevisions?: Array<{ revisionNumber: number; status: string; submittedAt: Date | string | null; answers: Array<{ questionKey: string; normalizedValue: string; isUnknown: boolean }> }>
}) {
  const [clarifications, setClarifications] = useState(initialClarifications)
  const [forms, setForms] = useState<Record<string, { resolution: string; note: string; evidenceReference: string }>>({})
  const [error, setError] = useState('')
  const [workingId, setWorkingId] = useState<string | null>(null)

  function updateForm(id: string, key: 'resolution' | 'note' | 'evidenceReference', value: string) {
    setForms((current) => {
      const previous = current[id] ?? { resolution: '', note: '', evidenceReference: '' }
      return { ...current, [id]: { ...previous, [key]: value } }
    })
  }

  async function resolve(clarification: InstallationClarificationView, action: 'RESOLVE' | 'WAIVE') {
    const form = forms[clarification.id] ?? { resolution: '', note: '', evidenceReference: '' }
    setWorkingId(clarification.id); setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/clarifications/${clarification.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'RESOLVE'
          ? { action, resolution: form.resolution, note: form.note || undefined, evidenceReference: form.evidenceReference || undefined }
          : { action, note: form.note, evidenceReference: form.evidenceReference || undefined }),
      })
      const data = await response.json() as { error?: string; clarification?: InstallationClarificationView }
      if (!response.ok || !data.clarification) throw new Error(data.error ?? 'Nie udało się zapisać ustalenia.')
      setClarifications((current) => current.map((item) => item.id === clarification.id ? { ...item, ...data.clarification! } : item))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Nie udało się zapisać ustalenia.') } finally { setWorkingId(null) }
  }

  return <section className="mt-6 rounded-xl border p-4" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30,30,30,.12)', boxShadow: 'var(--card-shadow)' }}>
    <p className="data-label">Gotowość do planowania</p>
    <h2 className="mt-1 text-xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>{readiness.openBlockingCount > 0 ? 'Wymaga ustalenia przed terminem montażu' : readiness.isReady ? 'Gotowe do planowania' : 'Czekamy na formularz klienta'}</h2>
    <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>{readiness.openBlockingCount > 0 ? `${readiness.openBlockingCount} otwarta kwestia blokuje przejście do planowania.` : readiness.isReady ? 'Wszystkie blokujące kwestie są zamknięte.' : 'Zlecenie jeszcze nie ma wysłanej wersji formularza.'}</p>
    <div className="mt-4 grid gap-3">{clarifications.length === 0 ? <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak zgłoszonych kwestii.</p> : clarifications.map((clarification) => <article key={clarification.id} className="rounded-lg border p-3" style={{ borderColor: clarification.status === 'OPEN' ? '#D5B46F' : 'rgba(30,30,30,.12)', background: clarification.status === 'OPEN' ? '#FFF9EA' : '#FAFAF8' }}>
      <p className="text-sm font-bold">{clarification.questionKey} · wersja {clarification.revisionNumber}</p>
      <p className="mt-1 text-sm">Odpowiedź: <strong>{clarification.answer ?? 'brak'}</strong> · {clarification.reason}</p>
      {clarification.status === 'OPEN' && canEdit ? <div className="mt-3 grid gap-2">
        <label className="grid gap-1 text-sm font-semibold" htmlFor={`resolution-${clarification.id}`}>Ustalenie dla {clarification.questionKey}<input id={`resolution-${clarification.id}`} className="min-h-11 rounded-md border px-3" value={forms[clarification.id]?.resolution ?? ''} onChange={(event) => updateForm(clarification.id, 'resolution', event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor={`note-${clarification.id}`}>Notatka dla {clarification.questionKey}<textarea id={`note-${clarification.id}`} className="min-h-20 rounded-md border p-3" value={forms[clarification.id]?.note ?? ''} onChange={(event) => updateForm(clarification.id, 'note', event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor={`evidence-${clarification.id}`}>Odwołanie do dowodu (opcjonalnie)<input id={`evidence-${clarification.id}`} className="min-h-11 rounded-md border px-3" value={forms[clarification.id]?.evidenceReference ?? ''} onChange={(event) => updateForm(clarification.id, 'evidenceReference', event.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-md px-4 text-sm font-bold" style={{ background: '#E4DCD1' }} onClick={() => void resolve(clarification, 'RESOLVE')} disabled={workingId === clarification.id}>Oznacz jako ustalone</button><button type="button" className="min-h-11 rounded-md border px-4 text-sm font-bold" onClick={() => void resolve(clarification, 'WAIVE')} disabled={workingId === clarification.id}>Odstąp z uzasadnieniem</button></div>
      </div> : clarification.status !== 'OPEN' ? <p className="mt-2 text-sm"><strong>{clarification.status === 'RESOLVED' ? 'Ustalono' : 'Odstąpiono'}.</strong> {clarification.resolution ?? clarification.resolutionNote}</p> : <p className="mt-2 text-sm">Tylko opiekun, zastępca, aktywny delegat albo administrator/manager może zamknąć tę kwestię.</p>}
    </article>)}</div>
    {formRevisions.length > 0 && <div className="mt-5 border-t pt-4">
      <h3 className="text-base font-extrabold">Wersje odpowiedzi klienta</h3>
      <div className="mt-2 grid gap-2">{formRevisions.map((revision) => <article key={revision.revisionNumber} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'rgba(30,30,30,.12)' }}>
        <strong>Wersja {revision.revisionNumber}</strong> · {revision.status === 'SUBMITTED' ? 'wysłana' : 'szkic'}
        <ul className="mt-1 list-disc pl-5">{revision.answers.map((answer) => <li key={answer.questionKey}><span className="num">{answer.questionKey}</span>: {answer.normalizedValue}</li>)}</ul>
      </article>)}</div>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>
}
