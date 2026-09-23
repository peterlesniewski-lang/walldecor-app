'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { getUnilateralProtocol, UnilateralReason } from '@/lib/installations/acceptance-unilateral'
import { formatWarsawDateTime } from '@/lib/installations/visit-time'

type Document = Awaited<ReturnType<typeof getUnilateralProtocol>>
const labels = { REFUSAL: 'Klient odmówił odbioru', ABSENT: 'Klient był nieobecny', NO_RESPONSE: 'Brak odpowiedzi klienta na miejscu' }

export function UnilateralProtocolEditor({ unilateral, photos: initialPhotos }: { unilateral: Document; photos: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [reason, setReason] = useState<UnilateralReason>(unilateral.reason ?? (unilateral.clientDecision === 'REFUSED' ? 'REFUSAL' : 'ABSENT'))
  const [circumstances, setCircumstances] = useState(unilateral.circumstances ?? '')
  const [photos, setPhotos] = useState(initialPhotos)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signed = unilateral.status === 'SIGNED'

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }
  }
  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    canvas.setPointerCapture(event.pointerId)
    const p = point(event)
    const ctx = canvas.getContext('2d')!
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1)
    ctx.strokeStyle = '#17252b'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke()
    drawing.current = true; setHasSignature(true)
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const p = point(event)
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.lineTo(p.x, p.y); ctx.stroke()
  }
  function clearSignature() { const canvas = canvasRef.current!; canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height); setHasSignature(false) }
  async function upload(file: File) {
    setUploading(true); setError('')
    try {
      const form = new FormData(); form.append('file', file)
      const response = await fetch(`/api/installations/${unilateral.orderId}/protocols/${unilateral.protocolId}/unilateral/photos`, { method: 'POST', body: form })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się przesłać zdjęcia.')
      setPhotos((current) => [...current, { id: body.photo.id, name: body.photo.originalFilename }])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się przesłać zdjęcia.') }
    finally { setUploading(false) }
  }
  async function sign() {
    if (!hasSignature) { setError('Złóż podpis wykonawcy.'); return }
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/installations/${unilateral.orderId}/protocols/${unilateral.protocolId}/unilateral`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: unilateral.id, reason, circumstances, signature: canvasRef.current!.toDataURL('image/png') }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się podpisać protokołu jednostronnego.')
      router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się podpisać protokołu jednostronnego.') }
    finally { setBusy(false) }
  }
  return <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12" style={{ color: 'var(--wd-dark)' }}>
    <Link href={`/installations/${unilateral.orderId}/protocols/${unilateral.protocolId}`} className="text-sm font-bold underline underline-offset-4">← Wróć do protokołu prac</Link>
    <header className="mt-8 border-b-2 pb-7" style={{ borderColor: 'var(--wd-dark)' }}>
      <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-900">Oddzielny dokument wykonawcy</p>
      <h1 className="mt-3 text-4xl font-bold" style={{ fontFamily: 'var(--font-acceptance-display)' }}>Protokół jednostronny</h1>
      <p className="mt-3 text-sm">{unilateral.snapshot.orderNumber} · {unilateral.snapshot.workType} · {unilateral.snapshot.address}</p>
      <p className="mt-1 text-sm">Wizyta: {unilateral.snapshot.visitStartsAt ? formatWarsawDateTime(unilateral.snapshot.visitStartsAt) : 'data nieustalona'}</p>
      <p className="mt-3 max-w-xl text-sm font-semibold">To zapis wykonawcy. Nie potwierdza odbioru przez klienta i pozostawia sprawę otwartą.</p>
    </header>
    {signed ? <section className="mt-8 border-2 border-amber-800 bg-amber-50 p-5"><h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-acceptance-display)' }}>Dokument podpisany</h2><p className="mt-2 text-sm">{labels[reason]} · {circumstances}</p>{photos.length > 0 && <ul className="mt-3 list-inside list-disc text-sm">{photos.map((photo) => <li key={photo.id}><a className="underline underline-offset-4" href={`/api/installations/${unilateral.orderId}/protocols/${unilateral.protocolId}/photos/${photo.id}`} target="_blank" rel="noreferrer">{photo.name}</a></li>)}</ul>}<a href={`/api/installations/${unilateral.orderId}/protocols/${unilateral.protocolId}/pdf?kind=UNILATERAL`} className="mt-5 inline-flex min-h-11 items-center rounded-full bg-amber-900 px-5 text-sm font-bold text-white">Pobierz PDF jednostronny</a></section> : <div className="mt-8 space-y-6">
      <section className="rounded-xl border border-black/15 bg-white p-5">
        <label htmlFor="unilateral-reason" className="text-sm font-bold">Przyczyna</label>
        <select id="unilateral-reason" value={reason} onChange={(event) => setReason(event.target.value as UnilateralReason)} disabled={unilateral.clientDecision === 'REFUSED'} className="mt-2 min-h-12 w-full border border-black/25 bg-white px-3">
          {unilateral.clientDecision === 'REFUSED' ? <option value="REFUSAL">{labels.REFUSAL}</option> : <><option value="ABSENT">{labels.ABSENT}</option><option value="NO_RESPONSE">{labels.NO_RESPONSE}</option></>}
        </select>
        <label htmlFor="unilateral-circumstances" className="mt-5 block text-sm font-bold">Opis okoliczności (wymagany)</label>
        <textarea id="unilateral-circumstances" value={circumstances} onChange={(event) => setCircumstances(event.target.value)} maxLength={3000} rows={4} className="mt-2 w-full border border-black/25 bg-white p-3" />
      </section>
      <section className="rounded-xl border border-black/15 bg-white p-5">
        <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-acceptance-display)' }}>Zdjęcia (opcjonalnie)</h2>
        {photos.length > 0 && <ul className="mt-3 list-inside list-disc text-sm">{photos.map((photo) => <li key={photo.id}>{photo.name}</li>)}</ul>}
        <label className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-black/30 px-5 text-sm font-bold">{uploading ? 'Przesyłanie…' : 'Dodaj zdjęcie'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '' }} /></label>
      </section>
      <section className="rounded-xl border border-black/15 bg-white p-5">
        <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-acceptance-display)' }}>Podpis wykonawcy</h2>
        <canvas ref={canvasRef} width={650} height={180} aria-label="Pole podpisu protokołu jednostronnego" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false }} onPointerCancel={() => { drawing.current = false }} className="mt-4 h-40 w-full touch-none border border-dashed border-black/35 bg-white" />
        <button type="button" onClick={clearSignature} className="mt-2 text-sm font-bold underline underline-offset-4">Wyczyść podpis</button>
        {error && <p role="alert" className="mt-3 text-sm font-bold text-red-800">{error}</p>}
        <button type="button" disabled={busy || uploading} onClick={sign} className="mt-6 min-h-12 w-full rounded-full px-6 font-bold text-white disabled:opacity-50" style={{ background: 'var(--wd-dark)' }}>{busy ? 'Zapisywanie…' : 'Podpisz protokół jednostronny'}</button>
      </section>
    </div>}
  </main>
}
