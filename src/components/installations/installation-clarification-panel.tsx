'use client'

import { useEffect, useState } from 'react'

export type InstallationClarificationView = {
  id: string
  status: string
  isBlocking: boolean
  questionLabel: string
  reason: string
  revisionNumber: number
  answer: string | null
  createdAt: Date | string
  resolution: string | null
  resolutionNote: string | null
  evidenceReference: string | null
}

export function InstallationClarificationPanel({ orderId, clarifications: initialClarifications, readiness, canEdit, hasSnapshot = true, onChanged }: {
  orderId: string
  clarifications: InstallationClarificationView[]
  readiness: { isReady: boolean; openBlockingCount: number; submittedCount: number; visitFeeAcceptanceRequired?: boolean }
  canEdit: boolean
  hasSnapshot?: boolean
  onChanged?: () => void
}) {
  const [clarifications, setClarifications] = useState(initialClarifications)
  const [forms, setForms] = useState<Record<string, { resolution: string; note: string; evidenceReference: string }>>({})
  const [error, setError] = useState('')
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  useEffect(() => { setClarifications(initialClarifications) }, [initialClarifications])

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
      const data = await response.json().catch(() => ({})) as { error?: string; clarification?: InstallationClarificationView }
      if (!response.ok || !data.clarification) throw new Error(data.error ?? 'Nie udało się zapisać ustalenia.')
      setClarifications((current) => current.map((item) => item.id === clarification.id ? { ...item, ...data.clarification! } : item))
      setEditingId(null)
      onChanged?.()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Nie udało się zapisać ustalenia.') } finally { setWorkingId(null) }
  }

  const open = clarifications.filter((item) => item.status === 'OPEN')
  const closed = clarifications.filter((item) => item.status !== 'OPEN')
  return <section className="rounded-xl border p-4" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30,30,30,.12)', boxShadow: 'var(--card-shadow)' }}>
    <h2 id="preparation-heading" className="text-xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>Do ustalenia przed montażem</h2>
    {!hasSnapshot ? <p className="mt-2 text-sm"><a href="#client-form" className="font-semibold underline">Wybierz formularz dla tego zlecenia.</a></p>
      : readiness.submittedCount === 0 && <p className="mt-2 text-sm"><a href="#client-form" className="font-semibold underline">Czekamy na formularz klienta — sprawdź link i wysyłkę.</a></p>}
    {readiness.visitFeeAcceptanceRequired && <p className="mt-2 text-sm"><a href="#visit-fee" className="font-semibold underline">Wymagane potwierdzenie informacji o opłacie przez klienta.</a></p>}
    <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }} aria-live="polite">{open.length ? `Otwarte kwestie: ${open.length}` : 'Brak otwartych kwestii w systemie.'}</p>
    <div className="mt-3 grid gap-3">{open.map((clarification) => <article key={clarification.id} className="rounded-lg border p-3" style={{ borderColor: '#D5B46F', background: '#FFF9EA' }}>
      <p className="text-sm font-bold">{clarification.questionLabel} · wersja {clarification.revisionNumber}</p>
      <p className="mt-1 text-sm">Odpowiedź: <strong>{clarification.answer ?? 'brak'}</strong> · {clarification.reason}</p>
      {canEdit && <button type="button" className="mt-2 min-h-11 font-bold underline underline-offset-4" aria-expanded={editingId === clarification.id} onClick={() => setEditingId(editingId === clarification.id ? null : clarification.id)}>Zapisz ustalenie</button>}
      {canEdit ? <div hidden={editingId !== clarification.id} className={editingId === clarification.id ? 'mt-3 grid gap-2' : 'hidden'}>
        <label className="grid gap-1 text-sm font-semibold" htmlFor={`resolution-${clarification.id}`}>Ustalenie dla {clarification.questionLabel}<input id={`resolution-${clarification.id}`} className="min-h-11 rounded-md border px-3" value={forms[clarification.id]?.resolution ?? ''} onChange={(event) => updateForm(clarification.id, 'resolution', event.target.value)} /></label>
        <details><summary className="cursor-pointer text-sm font-semibold">Notatka i materiały (opcjonalnie)</summary>
        <p className="my-2 text-sm">Przy odstąpieniu notatka z uzasadnieniem jest wymagana.</p>
        <label className="grid gap-1 text-sm font-semibold" htmlFor={`note-${clarification.id}`}>Notatka dla {clarification.questionLabel}<textarea id={`note-${clarification.id}`} className="min-h-20 rounded-md border p-3" value={forms[clarification.id]?.note ?? ''} onChange={(event) => updateForm(clarification.id, 'note', event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor={`evidence-${clarification.id}`}>Odwołanie do dowodu (opcjonalnie)<input id={`evidence-${clarification.id}`} className="min-h-11 rounded-md border px-3" value={forms[clarification.id]?.evidenceReference ?? ''} onChange={(event) => updateForm(clarification.id, 'evidenceReference', event.target.value)} /></label>
        </details>
        <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-md px-4 text-sm font-bold" style={{ background: '#E4DCD1' }} onClick={() => void resolve(clarification, 'RESOLVE')} disabled={workingId === clarification.id}>Oznacz jako ustalone</button><button type="button" className="min-h-11 rounded-md border px-4 text-sm font-bold" onClick={() => {
          if (!formNote(clarification.id)) { setError('Aby odstąpić, wpisz uzasadnienie w polu „Notatka” w szczegółach ustalenia.'); return }
          void resolve(clarification, 'WAIVE')
        }} disabled={workingId === clarification.id}>Odstąp z uzasadnieniem</button></div>
      </div> : <p className="mt-2 text-sm">Tylko opiekun, zastępca, aktywny delegat albo administrator/manager może zamknąć tę kwestię.</p>}
    </article>)}</div>
    {closed.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Historia ustaleń ({closed.length})</summary><div className="mt-2 grid gap-2">{closed.map((item) => <article key={item.id} className="rounded-lg border p-3 text-sm"><p className="font-bold">{item.questionLabel} · wersja {item.revisionNumber}</p><p>Odpowiedź: {item.answer ?? 'brak'}</p><p><strong>{item.status === 'RESOLVED' ? 'Ustalono' : 'Odstąpiono'}.</strong> {item.resolution ?? item.resolutionNote}</p>{item.resolution && item.resolutionNote && <p>{item.resolutionNote}</p>}{item.evidenceReference && <p>Materiał: {item.evidenceReference}</p>}</article>)}</div></details>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>

  function formNote(id: string) { return forms[id]?.note.trim() }
}
