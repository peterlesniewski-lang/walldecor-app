'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AcceptanceResult, AcceptanceSnapshot, AcceptanceWorkResult } from '@/lib/installations/acceptance-protocol'
import { formatWarsawDateTime } from '@/lib/installations/visit-time'

type Protocol = {
  id: string
  revision: number
  orderId: string
  status: string
  snapshot: AcceptanceSnapshot
  results: AcceptanceResult[]
  installerSignedAt: Date | string | null
}

export function InstallerProtocolEditor({ protocol, initialPhotos, unilateral }: { protocol: Protocol; initialPhotos: Array<{ id: string; name: string }>; unilateral: { id: string; status: string } | null }) {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [results, setResults] = useState<AcceptanceResult[]>(protocol.results.length ? protocol.results : protocol.snapshot.items.map((item) => ({ scopeId: item.scopeId, result: 'DONE', note: '' })))
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const [unilateralBusy, setUnilateralBusy] = useState(false)
  const [emailLinks, setEmailLinks] = useState<Array<{ id: string; recipientEmail: string | null; expiresAt: string; sentAt: string | null; revokedAt: string | null }>>([])
  const [photos, setPhotos] = useState(initialPhotos)
  const [error, setError] = useState('')
  const signed = protocol.status !== 'DRAFT'
  useEffect(() => {
    const refresh = () => router.refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [router])
  useEffect(() => {
    if (!signed) return
    fetch(`/api/installations/${protocol.orderId}/protocols/${protocol.id}/email-link`).then((response) => response.ok ? response.json() : null)
      .then((body) => { if (body?.links) setEmailLinks(body.links) }).catch(() => {})
  }, [protocol.id, protocol.orderId, signed])

  function updateResult(scopeId: string, change: Partial<AcceptanceResult>) {
    setResults((current) => current.map((item) => item.scopeId === scopeId ? { ...item, ...change } : item))
  }

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (signed) return
    const canvas = canvasRef.current!
    canvas.setPointerCapture(event.pointerId)
    const ctx = canvas.getContext('2d')!
    const p = point(event)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x + 0.1, p.y + 0.1)
    ctx.strokeStyle = '#17252b'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.stroke()
    drawing.current = true
    setHasSignature(true)
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const p = point(event)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  function clearSignature() {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }

  async function uploadPhoto(file: File) {
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(`/api/installations/${protocol.orderId}/protocols/${protocol.id}/photos`, { method: 'POST', body: form })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się dodać zdjęcia.')
      setPhotos((current) => [...current, { id: body.photo.id, name: body.photo.originalFilename }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się dodać zdjęcia.')
    } finally {
      setUploading(false)
    }
  }

  async function sign() {
    if (!hasSignature || !canvasRef.current) { setError('Złóż podpis przed zapisaniem.'); return }
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/installations/${protocol.orderId}/protocols/${protocol.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results, signature: canvasRef.current.toDataURL('image/png') }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się podpisać protokołu.')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się podpisać protokołu.')
    } finally {
      setBusy(false)
    }
  }

  async function openClientView() {
    setHandoffBusy(true); setError('')
    try {
      const response = await fetch(`/api/installations/${protocol.orderId}/protocols/${protocol.id}/onsite-link`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się otworzyć widoku klienta.')
      window.location.assign(body.path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się otworzyć widoku klienta.')
      setHandoffBusy(false)
    }
  }

  async function sendEmailLink() {
    setEmailBusy(true); setError('')
    try {
      const response = await fetch(`/api/installations/${protocol.orderId}/protocols/${protocol.id}/email-link`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się wysłać linku.')
      setEmailLinks((current) => [{ id: body.sent.linkId, recipientEmail: body.sent.recipientEmail, expiresAt: body.sent.expiresAt, sentAt: body.sent.sentAt, revokedAt: null }, ...current.map((link) => ({ ...link, revokedAt: link.revokedAt ?? new Date().toISOString() }))])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się wysłać linku.') }
    finally { setEmailBusy(false) }
  }

  async function revokeEmailLink(linkId: string) {
    setEmailBusy(true); setError('')
    try {
      const response = await fetch(`/api/installations/${protocol.orderId}/protocols/${protocol.id}/email-link`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkId }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się cofnąć linku.')
      setEmailLinks((current) => current.map((link) => link.id === linkId ? { ...link, revokedAt: new Date().toISOString() } : link))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się cofnąć linku.') }
    finally { setEmailBusy(false) }
  }

  async function openUnilateral() {
    if (unilateral) { window.location.assign(`/installations/${protocol.orderId}/protocols/${protocol.id}/unilateral`); return }
    setUnilateralBusy(true); setError('')
    try {
      const response = await fetch(`/api/installations/${protocol.orderId}/protocols/${protocol.id}/unilateral`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się przygotować protokołu jednostronnego.')
      window.location.assign(`/installations/${protocol.orderId}/protocols/${protocol.id}/unilateral`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się przygotować protokołu jednostronnego.'); setUnilateralBusy(false) }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12" style={{ color: 'var(--wd-dark)' }}>
      <Link className="text-sm font-bold underline underline-offset-4" href={`/installations/${protocol.orderId}#acceptance`}>← Wróć do karty montażu</Link>
      <header className="mt-8 border-b-2 pb-7" style={{ borderColor: 'var(--wd-dark)' }}>
        <p className="text-xs font-black uppercase tracking-[0.24em]" style={{ color: '#8C5718' }}>{protocol.snapshot.orderNumber} · protokół wykonawcy · wersja {protocol.revision}</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl" style={{ fontFamily: 'var(--font-client-display)' }}>{protocol.snapshot.workType}</h1>
        <p className="mt-3 text-sm">{protocol.snapshot.address} · {protocol.snapshot.installerName}</p>
        <p className="mt-1 text-sm font-semibold">Wizyta: {protocol.snapshot.visitStartsAt ? formatWarsawDateTime(protocol.snapshot.visitStartsAt) : 'data nieustalona'}</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>{protocol.status === 'INSTALLER_SIGNED' ? 'Podpis wykonawcy został zapisany. Protokół oczekuje na decyzję klienta.' : signed ? 'Protokół został utrwalony.' : 'Zaznacz rzeczywisty wynik każdej pracy, a następnie podpisz.'}</p>
      </header>
      <div className="mt-7 space-y-4">
        {protocol.snapshot.items.map((item, index) => {
          const value = results.find((result) => result.scopeId === item.scopeId)!
          return <section key={item.scopeId} className="rounded-xl border border-black/15 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: '#8C5718' }}>{String(index + 1).padStart(2, '0')} / {item.roomName}</p>
            <h2 className="mt-2 text-lg font-extrabold">{item.scopeName}</h2>
            {item.products.length > 0 && <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>{item.products.map((product) => product.name).filter(Boolean).join(' · ')}</p>}
            <label className="mt-5 block text-sm font-bold" htmlFor={`result-${item.scopeId}`}>Wynik pracy</label>
            <select id={`result-${item.scopeId}`} disabled={signed} value={value.result} onChange={(event) => updateResult(item.scopeId, { result: event.target.value as AcceptanceWorkResult })}
              className="mt-2 min-h-11 w-full rounded-lg border border-black/25 bg-white px-3 text-sm">
              <option value="DONE">Wykonano</option><option value="PARTIAL">Wykonano częściowo</option><option value="NOT_DONE">Nie wykonano</option>
            </select>
            <label className="mt-4 block text-sm font-bold" htmlFor={`note-${item.scopeId}`}>{value.result === 'DONE' ? 'Opis (opcjonalnie)' : 'Opis powodu (wymagany)'}</label>
            <textarea id={`note-${item.scopeId}`} disabled={signed} value={value.note} onChange={(event) => updateResult(item.scopeId, { note: event.target.value })}
              maxLength={2000} rows={2} className="mt-2 w-full rounded-lg border border-black/25 bg-white px-3 py-2 text-sm" />
          </section>
        })}
      </div>
      <section className="mt-6 rounded-xl border border-black/15 bg-white p-5">
        <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-client-display)' }}>Zdjęcia prac</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Zdjęcia są opcjonalne. Protokół możesz podpisać bez nich.</p>
        {photos.length > 0 && <ul className="mt-3 list-inside list-disc text-sm">{photos.map((photo) => <li key={photo.id}>{signed ? <a className="underline underline-offset-4" href={`/api/installations/${protocol.orderId}/protocols/${protocol.id}/photos/${photo.id}`} target="_blank" rel="noreferrer">{photo.name}</a> : photo.name}</li>)}</ul>}
        {!signed && <label className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-black/30 px-5 text-sm font-bold">
          {uploading ? 'Przesyłanie zdjęcia…' : 'Dodaj zdjęcie'}
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); event.target.value = '' }} />
        </label>}
      </section>
      {!signed && <section className="mt-8 rounded-xl border border-black/15 bg-white p-5">
        <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-client-display)' }}>Podpis wykonawcy</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Podpisujesz przedstawiony wyżej stan prac.</p>
        <canvas ref={canvasRef} width={650} height={180} aria-label="Pole podpisu wykonawcy" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false }} onPointerCancel={() => { drawing.current = false }}
          className="mt-4 h-40 w-full touch-none rounded-lg border border-dashed border-black/35 bg-white" />
        <button type="button" onClick={clearSignature} className="mt-2 text-sm font-bold underline underline-offset-4">Wyczyść podpis</button>
        {error && <p role="alert" className="mt-3 text-sm font-bold text-red-800">{error}</p>}
        <button type="button" disabled={busy || uploading} onClick={sign} className="mt-6 min-h-12 w-full rounded-full px-6 font-bold text-white disabled:opacity-50" style={{ background: 'var(--wd-dark)' }}>{busy ? 'Zapisywanie…' : 'Podpisz protokół'}</button>
      </section>}
      {protocol.status === 'INSTALLER_SIGNED' && <section className="mt-8 rounded-xl border-2 p-5" style={{ borderColor: 'var(--wd-dark)', background: 'var(--wd-sand-light)' }}>
        <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-client-display)' }}>Przekaż klientowi</h2>
        <p className="mt-2 text-sm">Otwórz oddzielny widok odbioru i przekaż telefon klientowi lub jego przedstawicielowi. Widok pokazuje wyłącznie protokół.</p>
        {error && <p role="alert" className="mt-3 text-sm font-bold text-red-800">{error}</p>}
        <button type="button" disabled={handoffBusy} onClick={openClientView} className="mt-5 min-h-12 w-full rounded-full px-6 font-bold text-white disabled:opacity-50" style={{ background: 'var(--wd-dark)' }}>{handoffBusy ? 'Otwieranie…' : 'Otwórz widok klienta na tym telefonie'}</button>
      </section>}
      {['INSTALLER_SIGNED', 'REFUSED', 'UNILATERAL'].includes(protocol.status) && <section className="mt-6 rounded-xl border border-amber-800 bg-amber-50 p-5">
        <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-client-display)' }}>{protocol.status === 'REFUSED' ? 'Klient odmówił odbioru' : unilateral?.status === 'SIGNED' ? 'Protokół jednostronny podpisany' : 'Klient nie może potwierdzić na miejscu?'}</h2>
        <p className="mt-2 text-sm">{protocol.status === 'REFUSED' ? 'Sporządź osobny protokół jednostronny z opisem odmowy.' : 'Przy nieobecności lub braku odpowiedzi zapisz okoliczności w osobnym protokole. Nie będzie to odbiór klienta.'}</p>
        {error && <p role="alert" className="mt-3 text-sm font-bold text-red-800">{error}</p>}
        <button type="button" disabled={unilateralBusy} onClick={openUnilateral} className="mt-4 min-h-11 rounded-full border border-amber-900 px-5 text-sm font-bold disabled:opacity-50">{unilateralBusy ? 'Otwieranie…' : unilateral ? 'Otwórz protokół jednostronny' : 'Przygotuj protokół jednostronny'}</button>
      </section>}
      {signed && <section className="mt-6 rounded-xl border border-black/15 bg-white p-5">
        <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-client-display)' }}>Link dla klienta</h2>
        <p className="mt-2 text-sm">Wyślij osobny link do tego protokołu na adres e-mail z karty montażu. Jest ważny przez 90 dni.</p>
        {emailLinks.find((link) => !link.revokedAt && new Date(link.expiresAt) > new Date()) && <p className="mt-3 text-sm font-semibold">Aktywny link wysłano do {emailLinks.find((link) => !link.revokedAt && new Date(link.expiresAt) > new Date())?.recipientEmail}.</p>}
        {error && <p role="alert" className="mt-3 text-sm font-bold text-red-800">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={emailBusy} onClick={sendEmailLink} className="min-h-11 rounded-full px-5 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'var(--wd-dark)' }}>{emailBusy ? 'Przetwarzanie…' : 'Wyślij link e-mailem'}</button>
          {emailLinks.filter((link) => !link.revokedAt && new Date(link.expiresAt) > new Date()).map((link) => <button key={link.id} type="button" disabled={emailBusy} onClick={() => revokeEmailLink(link.id)} className="min-h-11 rounded-full border border-black/30 px-5 text-sm font-bold disabled:opacity-50">Cofnij link</button>)}
        </div>
      </section>}
      {['ACCEPTED', 'ACCEPTED_WITH_REMARKS', 'REFUSED', 'UNILATERAL'].includes(protocol.status) && <div className="mt-6 flex flex-wrap gap-3">
        <a href={`/api/installations/${protocol.orderId}/protocols/${protocol.id}/pdf`} className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-bold text-white" style={{ background: 'var(--wd-dark)' }}>Pobierz PDF protokołu</a>
        {unilateral?.status === 'SIGNED' && <a href={`/api/installations/${protocol.orderId}/protocols/${protocol.id}/pdf?kind=UNILATERAL`} className="inline-flex min-h-11 items-center rounded-full border border-black/30 px-5 text-sm font-bold">Pobierz PDF jednostronny</a>}
      </div>}
    </main>
  )
}
