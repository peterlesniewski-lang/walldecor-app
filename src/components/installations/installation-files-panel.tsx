'use client'

import { FormEvent, useId, useRef, useState } from 'react'
import { ChevronDown, FileDown, Paperclip, RotateCcw, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

type StoredFile = {
  id: string; formSubmissionId: string | null; purpose: string; questionKey: string | null; roomId: string | null; scopeId: string | null
  originalFilename: string; status: string; byteSize: number | null; softDeletedAt: Date | string | null
  remoteDeleteStatus: string; remoteDeleteAttemptCount: number; remoteDeleteLastError: string | null
  remoteDeleteNextAttemptAt: Date | string | null; remoteDeletedAt: Date | string | null
}
type Room = { id: string; name: string; scopes: Array<{ id: string; name: string }> }
type OpenMismatch = { id: string; reason: string; description: string }

const mismatchReason: Record<string, string> = {
  CANNOT_PERFORM: 'Brak możliwości wykonania',
  EXECUTION_RISK: 'Ryzyko wykonania',
}
const fileStatus: Record<string, string> = { READY: 'Gotowy', PENDING: 'Przetwarzanie', FAILED: 'Nie udało się dodać' }

function AttachmentUpload({ rooms, mismatch, busy, onUpload }: {
  rooms: Room[]; mismatch?: OpenMismatch; busy: boolean; onUpload: (body: FormData) => Promise<boolean>
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [assign, setAssign] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [scopeId, setScopeId] = useState('')
  const scopes = rooms.find((room) => room.id === roomId)?.scopes ?? []

  function reset() {
    setFile(null); setRoomId(''); setScopeId(''); setAssign(false)
    if (input.current) input.current.value = ''
  }
  function cancel() {
    if (file && !window.confirm('Wybrany plik nie został zapisany. Odrzucić go?')) return
    reset(); setOpen(false)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || busy) return
    const body = new FormData()
    body.set('file', file)
    if (mismatch) body.set('mismatchId', mismatch.id)
    else {
      body.set('purpose', 'INTERNAL_PROJECT')
      if (roomId) body.set('roomId', roomId)
      if (roomId && scopeId) body.set('scopeId', scopeId)
    }
    if (await onUpload(body)) reset()
  }
  return <div className="mt-4">
    <Button type="button" variant="outline" aria-expanded={open} aria-controls={id}
      aria-label={mismatch ? (open ? 'Zwiń dodawanie zdjęcia problemu: ' : 'Dodaj zdjęcie problemu: ') + mismatch.description : undefined}
      onClick={() => setOpen(!open)} className="min-h-11">
      <Paperclip className="h-4 w-4" />{mismatch ? (open ? 'Zwiń dodawanie zdjęcia' : 'Dodaj zdjęcie problemu') : (open ? 'Zwiń dodawanie załącznika' : 'Dodaj załącznik')}
    </Button>
    <div id={id} hidden={!open}>
      <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl border p-4" style={{ borderColor: 'rgba(30,30,30,.1)', background: 'var(--wd-off-white)' }}>
        <fieldset disabled={busy} className="grid min-w-0 gap-3">
          {!mismatch && <>
            <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>{roomId ? 'Przypisanie: ' + rooms.find((room) => room.id === roomId)?.name + (scopeId ? ' · ' + scopes.find((scope) => scope.id === scopeId)?.name : '') : 'Całe zlecenie'}</p>
            <Button type="button" variant="ghost" className="h-auto min-h-11 w-fit max-w-full whitespace-normal text-left" aria-expanded={assign} aria-controls={id + '-assignment'} onClick={() => setAssign(!assign)}>Przypisz do pomieszczenia lub zakresu</Button>
            <div id={id + '-assignment'} hidden={!assign}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">Pomieszczenie<select aria-label="Pomieszczenie pliku" value={roomId} onChange={(event) => { setRoomId(event.target.value); setScopeId('') }} className="min-h-11 min-w-0 rounded-lg border px-3 text-sm"><option value="">Całe zlecenie</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
                {roomId && <label className="grid gap-1 text-sm">Zakres<select aria-label="Zakres pliku" value={scopeId} onChange={(event) => setScopeId(event.target.value)} className="min-h-11 min-w-0 rounded-lg border px-3 text-sm"><option value="">Całe pomieszczenie</option>{scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</select></label>}
              </div>
            </div>
          </>}
          <label className="grid gap-2 text-sm font-semibold">Wybierz plik<input ref={input} aria-label={mismatch ? 'Wybierz plik dokumentacji problemu' : 'Wybierz prywatny plik'} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="min-h-11 w-full min-w-0 text-sm" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} /></label>
          <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>Plik prywatny, dostępny przez kartę montażu. JPG, PNG, WebP lub PDF.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !file} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Upload />{busy ? 'Dodawanie…' : mismatch ? 'Zapisz dokumentację problemu' : 'Zapisz załącznik'}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={cancel} aria-label={mismatch ? 'Anuluj dodawanie dokumentacji problemu' : 'Anuluj dodawanie załącznika'}>Anuluj</Button>
          </div>
        </fieldset>
      </form>
    </div>
  </div>
}

export function InstallationFilesPanel({ orderId, initialFiles, rooms, mismatches, canEdit, onChanged }: {
  orderId: string; initialFiles: StoredFile[]; rooms: Room[]; mismatches: OpenMismatch[]; canEdit: boolean; onChanged?: () => void
}) {
  const [files, setFiles] = useState(initialFiles)
  const [previousInitialFiles, setPreviousInitialFiles] = useState(initialFiles)
  const [completedMismatches, setCompletedMismatches] = useState<string[]>([])
  const [documentationOpen, setDocumentationOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const documentationId = useId()
  // Reconcile a refreshed server list without remounting the upload drafts.
  if (previousInitialFiles !== initialFiles) {
    setPreviousInitialFiles(initialFiles)
    setFiles(initialFiles)
  }
  const attachments = files.filter((file) => file.purpose !== 'MISMATCH_EVIDENCE')
  const evidence = files.filter((file) => file.purpose === 'MISMATCH_EVIDENCE')

  async function refresh() {
    const response = await fetch(`/api/installations/${orderId}/files`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Nie udało się odświeżyć listy plików.')
    const body = await response.json() as { files: StoredFile[] }
    setFiles(body.files)
  }
  async function upload(body: FormData) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/installations/${orderId}/files`, { method: 'POST', body })
      const result = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(result?.error ?? 'Nie udało się dodać pliku.')
      const mismatchId = body.get('mismatchId')
      if (typeof mismatchId === 'string') setCompletedMismatches((current) => [...current, mismatchId])
      try { await refresh(); setMessage('Plik został dodany.') }
      catch { setMessage('Plik został dodany, ale nie udało się odświeżyć listy. Odśwież kartę montażu.') }
      onChanged?.()
      return true
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się dodać pliku.'); return false }
    finally { setBusy(false) }
  }
  async function remove(fileId: string) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/installations/${orderId}/files/${fileId}`, { method: 'DELETE' })
      const result = await response.json().catch(() => null) as { error?: string; remoteDeleteStatus?: string } | null
      if (!response.ok) throw new Error(result?.error ?? 'Nie udało się usunąć pliku.')
      await refresh()
      setMessage(result?.remoteDeleteStatus === 'SUCCEEDED' ? 'Plik został bezpiecznie usunięty.' : 'Pobieranie pliku zostało zablokowane. Zdalne usunięcie wymaga ponowienia.')
      onChanged?.()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się usunąć pliku.') } finally { setBusy(false) }
  }
  function fileList(list: StoredFile[]) {
    return <ul className="mt-4 space-y-2">{list.map((stored) => {
      const cleaning = stored.softDeletedAt !== null
      const room = rooms.find((room) => room.id === stored.roomId)
      const scope = room?.scopes.find((scope) => scope.id === stored.scopeId)
      const assignment = stored.roomId ? (room?.name ?? 'Usunięte pomieszczenie') + (stored.scopeId ? ' · ' + (scope?.name ?? 'Usunięty zakres') : '') : 'Całe zlecenie'
      return <li key={stored.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3 text-sm" style={{ borderColor: cleaning ? 'rgba(185, 89, 34, .32)' : 'rgba(30,30,30,.1)', background: cleaning ? '#FFF8F1' : undefined }}>
        <div className="min-w-0 flex-1"><strong className="break-words [overflow-wrap:anywhere]">{stored.originalFilename}</strong><p className="mt-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>{stored.purpose === 'INTERNAL_PROJECT' ? 'Załącznik' : stored.purpose === 'MISMATCH_EVIDENCE' ? 'Dokumentacja problemu' : 'Załącznik klienta'} · {fileStatus[stored.status] ?? 'Status do sprawdzenia'}</p><p className="mt-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>{assignment}</p>{cleaning && <p className="mt-1 text-xs font-semibold" style={{ color: '#9A481C' }}>{stored.remoteDeleteStatus === 'RETRY' ? 'Nie udało się usunąć z serwera' : 'Usuwanie z serwera w toku'}{stored.remoteDeleteLastError ? ' — ' + stored.remoteDeleteLastError : ''}</p>}</div>
        <span className="flex flex-wrap gap-2">{!cleaning && stored.status === 'READY' && <a className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 py-2 font-semibold" href={`/api/installations/${orderId}/files/${stored.id}`}><FileDown className="h-4 w-4" />Pobierz</a>}{canEdit && (cleaning ? <Button type="button" variant="outline" disabled={busy} onClick={() => void remove(stored.id)} aria-label={'Ponów usuwanie pliku ' + stored.originalFilename}><RotateCcw className="h-4 w-4" />Ponów usuwanie</Button> : <Button type="button" variant="outline" className="min-h-11 min-w-11" disabled={busy} onClick={() => void remove(stored.id)} aria-label={'Usuń plik ' + stored.originalFilename}><Trash2 className="h-4 w-4" /></Button>)}</span>
      </li>
    })}</ul>
  }
  return <section aria-labelledby="installation-files-heading" className="mt-7 rounded-2xl border p-5 sm:p-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30,30,30,.12)', boxShadow: 'var(--card-shadow)' }}>
    <h2 id="installation-files-heading" className="text-xl font-extrabold">Załączniki</h2>
    <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Projekty, rzuty i zdjęcia pomocne przy montażu.</p>
    {attachments.length === 0 ? <p className="mt-4 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak dodanych plików.</p> : fileList(attachments)}
    {canEdit && <AttachmentUpload rooms={rooms} busy={busy} onUpload={upload} />}
    {message && <p role="status" className="mt-3 text-sm" style={{ color: '#705320' }}>{message}</p>}
    {(mismatches.length > 0 || evidence.length > 0) && <div className="mt-5 border-t pt-4" style={{ borderColor: 'rgba(30,30,30,.1)' }}>
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold" aria-expanded={documentationOpen} aria-controls={documentationId} onClick={() => setDocumentationOpen(!documentationOpen)}>Dokumentacja zgłoszonych problemów<ChevronDown className={'h-4 w-4 shrink-0 ' + (documentationOpen ? 'rotate-180' : '')} /></button>
      <div id={documentationId} hidden={!documentationOpen}>
        {evidence.length > 0 && fileList(evidence)}
        {canEdit && mismatches.filter((mismatch) => !completedMismatches.includes(mismatch.id)).map((mismatch) => <div key={mismatch.id} className="mt-3 rounded-lg border p-3" style={{ borderColor: 'rgba(30,30,30,.1)' }}><p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>{mismatchReason[mismatch.reason] ?? 'Zgłoszony problem'}</p><p className="mt-1 text-sm font-semibold [overflow-wrap:anywhere]">{mismatch.description}</p><AttachmentUpload rooms={rooms} mismatch={mismatch} busy={busy} onUpload={upload} /></div>)}
      </div>
    </div>}
  </section>
}
