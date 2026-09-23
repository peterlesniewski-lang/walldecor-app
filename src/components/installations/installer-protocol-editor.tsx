'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AcceptanceResult, AcceptanceSnapshot, AcceptanceWorkResult } from '@/lib/installations/acceptance-protocol'
import { formatWarsawDateTime } from '@/lib/installations/visit-time'

type Protocol = {
  id: string
  orderId: string
  status: string
  snapshot: AcceptanceSnapshot
  results: AcceptanceResult[]
  installerSignedAt: Date | string | null
}

export function InstallerProtocolEditor({ protocol, initialPhotos }: { protocol: Protocol; initialPhotos: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [results, setResults] = useState<AcceptanceResult[]>(protocol.results.length ? protocol.results : protocol.snapshot.items.map((item) => ({ scopeId: item.scopeId, result: 'DONE', note: '' })))
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [photos, setPhotos] = useState(initialPhotos)
  const [error, setError] = useState('')
  const signed = protocol.status !== 'DRAFT'

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

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12" style={{ color: 'var(--wd-dark)' }}>
      <Link className="text-sm font-bold underline underline-offset-4" href={`/installations/${protocol.orderId}#acceptance`}>← Wróć do karty montażu</Link>
      <header className="mt-8 border-b-2 pb-7" style={{ borderColor: 'var(--wd-dark)' }}>
        <p className="text-xs font-black uppercase tracking-[0.24em]" style={{ color: '#8C5718' }}>{protocol.snapshot.orderNumber} · protokół wykonawcy</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl" style={{ fontFamily: 'var(--font-acceptance-display)' }}>{protocol.snapshot.workType}</h1>
        <p className="mt-3 text-sm">{protocol.snapshot.address} · {protocol.snapshot.installerName}</p>
        <p className="mt-1 text-sm font-semibold">Wizyta: {protocol.snapshot.visitStartsAt ? formatWarsawDateTime(protocol.snapshot.visitStartsAt) : 'data nieustalona'}</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>{signed ? 'Podpis wykonawcy został zapisany. Protokół oczekuje na odbiór klienta.' : 'Zaznacz rzeczywisty wynik każdej pracy, a następnie podpisz.'}</p>
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
        <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-acceptance-display)' }}>Zdjęcia prac</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Zdjęcia są opcjonalne. Protokół możesz podpisać bez nich.</p>
        {photos.length > 0 && <ul className="mt-3 list-inside list-disc text-sm">{photos.map((photo) => <li key={photo.id}>{photo.name}</li>)}</ul>}
        {!signed && <label className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-black/30 px-5 text-sm font-bold">
          {uploading ? 'Przesyłanie zdjęcia…' : 'Dodaj zdjęcie'}
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); event.target.value = '' }} />
        </label>}
      </section>
      {!signed && <section className="mt-8 rounded-xl border border-black/15 bg-white p-5">
        <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-acceptance-display)' }}>Podpis wykonawcy</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Podpisujesz przedstawiony wyżej stan prac.</p>
        <canvas ref={canvasRef} width={650} height={180} aria-label="Pole podpisu wykonawcy" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false }} onPointerCancel={() => { drawing.current = false }}
          className="mt-4 h-40 w-full touch-none rounded-lg border border-dashed border-black/35 bg-white" />
        <button type="button" onClick={clearSignature} className="mt-2 text-sm font-bold underline underline-offset-4">Wyczyść podpis</button>
        {error && <p role="alert" className="mt-3 text-sm font-bold text-red-800">{error}</p>}
        <button type="button" disabled={busy || uploading} onClick={sign} className="mt-6 min-h-12 w-full rounded-full px-6 font-bold text-white disabled:opacity-50" style={{ background: 'var(--wd-dark)' }}>{busy ? 'Zapisywanie…' : 'Podpisz protokół'}</button>
      </section>}
    </main>
  )
}
