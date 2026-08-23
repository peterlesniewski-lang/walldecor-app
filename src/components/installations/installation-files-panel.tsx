'use client'

import { ChangeEvent, useMemo, useState } from 'react'
import { FileDown, RotateCcw, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

type StoredFile = {
  id: string; purpose: string; questionKey: string | null; roomId: string | null; scopeId: string | null
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

export function InstallationFilesPanel({ orderId, initialFiles, rooms, mismatches, canEdit }: { orderId: string; initialFiles: StoredFile[]; rooms: Room[]; mismatches: OpenMismatch[]; canEdit: boolean }) {
  const [files, setFiles] = useState(initialFiles)
  const [file, setFile] = useState<File | null>(null)
  const [roomId, setRoomId] = useState('')
  const [scopeId, setScopeId] = useState('')
  const [mismatchId, setMismatchId] = useState('')
  const [openMismatches, setOpenMismatches] = useState(mismatches)
  const [mode, setMode] = useState<'project' | 'evidence'>('project')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const scopes = useMemo(() => rooms.find((room) => room.id === roomId)?.scopes ?? [], [roomId, rooms])

  async function refresh() {
    const response = await fetch(`/api/installations/${orderId}/files`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Nie udało się odświeżyć listy plików.')
    const body = await response.json() as { files: StoredFile[] }
    setFiles(body.files)
  }
  async function upload(event: React.FormEvent) {
    event.preventDefault()
    if (!file) { setMessage('Wybierz plik.'); return }
    setBusy(true); setMessage('')
    const body = new FormData()
    body.set('file', file)
    if (mode === 'project') { body.set('purpose', 'INTERNAL_PROJECT'); if (roomId) body.set('roomId', roomId); if (scopeId) body.set('scopeId', scopeId) }
    else body.set('mismatchId', mismatchId)
    try {
      const response = await fetch(`/api/installations/${orderId}/files`, { method: 'POST', body })
      const result = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(result?.error ?? 'Nie udało się dodać pliku.')
      setFile(null)
      if (mode === 'evidence') setOpenMismatches((current) => current.filter((mismatch) => mismatch.id !== mismatchId))
      setMismatchId('')
      await refresh()
      setMessage('Plik został dodany.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się dodać pliku.') } finally { setBusy(false) }
  }
  async function remove(fileId: string) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/installations/${orderId}/files/${fileId}`, { method: 'DELETE' })
      const result = await response.json().catch(() => null) as { error?: string; remoteDeleteStatus?: string } | null
      if (!response.ok) throw new Error(result?.error ?? 'Nie udało się usunąć pliku.')
      await refresh()
      setMessage(result?.remoteDeleteStatus === 'SUCCEEDED' ? 'Plik został bezpiecznie usunięty.' : 'Pobieranie pliku zostało zablokowane. Zdalne usunięcie wymaga ponowienia.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się usunąć pliku.') } finally { setBusy(false) }
  }
  return <section aria-labelledby="installation-files-heading" className="mt-7 rounded-2xl border p-5 sm:p-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30,30,30,.12)', boxShadow: 'var(--card-shadow)' }}>
    <p className="data-label" style={{ color: '#8C5718' }}>Prywatne materiały</p><h2 id="installation-files-heading" className="mt-1 text-xl font-extrabold">Pliki projektu i dowody</h2>
    <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Pliki są przechowywane prywatnie. Pobranie zawsze przechodzi przez kartę montażu.</p>
    {canEdit && <form className="mt-4 grid gap-3 rounded-xl border p-3" onSubmit={upload} style={{ borderColor: 'rgba(30,30,30,.1)', background: 'var(--wd-off-white)' }}>
      <div className="flex flex-wrap gap-2"><Button type="button" variant={mode === 'project' ? 'default' : 'outline'} onClick={() => setMode('project')}>Plik projektu</Button><Button type="button" variant={mode === 'evidence' ? 'default' : 'outline'} onClick={() => setMode('evidence')}>Dowód niezgodności</Button></div>
      {mode === 'project' ? <div className="grid gap-2 sm:grid-cols-2"><select aria-label="Pomieszczenie pliku" value={roomId} onChange={(event) => { setRoomId(event.target.value); setScopeId('') }} className="min-h-11 rounded-lg border px-3 text-sm"><option value="">Całe zlecenie</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select><select aria-label="Zakres pliku" value={scopeId} disabled={!roomId} onChange={(event) => setScopeId(event.target.value)} className="min-h-11 rounded-lg border px-3 text-sm"><option value="">Całe pomieszczenie</option>{scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</select></div> : <div className="grid gap-1"><select aria-label="Niezgodność dla dowodu" value={mismatchId} onChange={(event) => setMismatchId(event.target.value)} className="min-h-11 rounded-lg border px-3 text-sm" required><option value="">Wybierz otwartą niezgodność</option>{openMismatches.map((mismatch) => <option key={mismatch.id} value={mismatch.id}>{mismatchReason[mismatch.reason] ?? 'Niezgodność'} — {mismatch.description}</option>)}</select>{openMismatches.length === 0 && <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>Brak otwartych niezgodności wymagających dowodu.</p>}</div>}
      <label className="text-sm font-semibold">Wybierz plik <input aria-label="Wybierz prywatny plik" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="ml-2 text-sm" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.currentTarget.files?.[0] ?? null)} /></label>
      <Button type="submit" disabled={busy || !file || (mode === 'evidence' && !mismatchId.trim())} className="min-h-11 w-fit" style={{ background: '#A96A20', color: '#fff' }}><Upload />{busy ? 'Dodawanie…' : 'Dodaj prywatny plik'}</Button>
    </form>}
    {message && <p role="status" className="mt-3 text-sm" style={{ color: '#705320' }}>{message}</p>}
    {files.length === 0 ? <p className="mt-4 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak dodanych plików.</p> : <ul className="mt-4 space-y-2">{files.map((stored) => {
      const cleaning = stored.softDeletedAt !== null
      return <li key={stored.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3 text-sm" style={{ borderColor: cleaning ? 'rgba(185, 89, 34, .32)' : 'rgba(30,30,30,.1)', background: cleaning ? '#FFF8F1' : undefined }}><span><strong>{stored.originalFilename}</strong><span className="ml-2 text-xs" style={{ color: 'var(--wd-text-muted)' }}>{stored.purpose === 'INTERNAL_PROJECT' ? 'Projekt' : stored.purpose === 'MISMATCH_EVIDENCE' ? 'Dowód niezgodności' : 'Załącznik klienta'} · {stored.status}</span>{cleaning && <span className="mt-1 block text-xs font-semibold" style={{ color: '#9A481C' }}>{stored.remoteDeleteStatus === 'RETRY' ? 'Nie udało się usunąć z serwera' : 'Usuwanie z serwera w toku'}{stored.remoteDeleteLastError ? ` — ${stored.remoteDeleteLastError}` : ''}</span>}</span><span className="flex gap-2">{!cleaning && <a className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-semibold" href={`/api/installations/${orderId}/files/${stored.id}`}><FileDown className="h-4 w-4" />Pobierz</a>}{canEdit && (cleaning ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void remove(stored.id)} aria-label={`Ponów usuwanie pliku ${stored.originalFilename}`}><RotateCcw className="h-4 w-4" />Ponów usuwanie</Button> : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void remove(stored.id)} aria-label={`Usuń plik ${stored.originalFilename}`}><Trash2 className="h-4 w-4" /></Button>)}</span></li>
    })}</ul>}
  </section>
}
