'use client'

import { useRef, useState } from 'react'
import type { publicAcceptanceProjection, ClientDecision } from '@/lib/installations/acceptance-client'
import { formatWarsawDateTime } from '@/lib/installations/visit-time'

type Projection = Awaited<ReturnType<typeof publicAcceptanceProjection>>
const resultNames = { DONE: 'Wykonano', PARTIAL: 'Wykonano częściowo', NOT_DONE: 'Nie wykonano' }
const decisionNames = { ACCEPTED: 'Odebrano', ACCEPTED_WITH_REMARKS: 'Odebrano z uwagami', REFUSED: 'Odmowa odbioru' }

export function ClientAcceptancePage({ token, protocol }: { token: string; protocol: Projection }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [decision, setDecision] = useState<ClientDecision>('ACCEPTED')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [relationship, setRelationship] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<ClientDecision | null>(protocol.clientDecision)
  const canRespond = protocol.status === 'INSTALLER_SIGNED' && protocol.isLatest && !saved
  const canDownload = Boolean(saved || ['ACCEPTED', 'ACCEPTED_WITH_REMARKS', 'REFUSED', 'UNILATERAL'].includes(protocol.status))

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }
  }
  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    canvas.setPointerCapture(event.pointerId)
    const p = point(event)
    const context = canvas.getContext('2d')!
    context.beginPath()
    context.moveTo(p.x, p.y)
    context.lineTo(p.x + 0.1, p.y + 0.1)
    context.strokeStyle = '#18352e'
    context.lineWidth = 3
    context.lineCap = 'round'
    context.stroke()
    drawing.current = true
    setHasSignature(true)
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const p = point(event)
    const context = canvasRef.current!.getContext('2d')!
    context.lineTo(p.x, p.y)
    context.stroke()
  }
  function clearSignature() {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (decision !== 'REFUSED' && !hasSignature) { setError('Złóż podpis w polu podpisu.'); return }
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/public/acceptance/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, firstName, lastName, relationship, note, signature: hasSignature ? canvasRef.current!.toDataURL('image/png') : null }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się zapisać odpowiedzi.')
      setSaved(decision)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać odpowiedzi.') }
    finally { setBusy(false) }
  }

  return <main className="min-h-screen px-4 py-6 sm:py-10" style={{ background: 'radial-gradient(circle at 90% 0%, #e4ddc8 0, transparent 30%), repeating-linear-gradient(0deg, transparent 0, transparent 39px, rgba(28,64,50,.035) 40px), #f7f5ee', color: '#1b3029', fontFamily: 'var(--font-client-sans)' }}>
    <div className="mx-auto max-w-2xl">
      <header className="border-b-2 border-[#1b3029] pb-6">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-extrabold uppercase tracking-[0.25em]">WallDecor / odbiór prac</span>
          <span className="rounded-full border border-[#1b3029] px-3 py-1 text-xs font-bold">Wersja {protocol.revision}</span>
        </div>
        <h1 className="mt-9 text-4xl font-extrabold leading-tight sm:text-5xl" style={{ fontFamily: 'var(--font-client-display)' }}>{protocol.snapshot.workType}</h1>
        <p className="mt-3 text-sm leading-6">Protokół {protocol.snapshot.orderNumber} · {protocol.snapshot.address}</p>
        <p className="text-sm">Wizyta: {protocol.snapshot.visitStartsAt ? formatWarsawDateTime(protocol.snapshot.visitStartsAt) : 'data nieustalona'}</p>
        <p className="text-sm">Wykonawca: {protocol.snapshot.installerName}</p>
      </header>
      <section className="mt-8">
        <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-[#9a5b22]">01 / zakres i wynik</p>
        <h2 className="mt-2 text-2xl font-extrabold" style={{ fontFamily: 'var(--font-client-display)' }}>Sprawdź wykonane prace</h2>
        <div className="mt-5 space-y-3">{protocol.snapshot.items.map((item) => {
          const result = protocol.results.find((entry) => entry.scopeId === item.scopeId)
          return <article key={item.scopeId} className="border-l-4 border-[#1b3029] bg-white/90 px-5 py-4 shadow-[3px_3px_0_#d4cbb6]">
            <p className="text-xs font-extrabold uppercase tracking-widest text-[#9a5b22]">{item.roomName}</p>
            <h3 className="mt-1 font-bold">{item.scopeName}</h3>
            {item.products.length > 0 && <p className="mt-1 text-sm text-[#4d6157]">{item.products.map((product) => product.name).filter(Boolean).join(' · ')}</p>}
            <p className="mt-3 text-sm"><span className="font-extrabold">Wynik:</span> {result ? resultNames[result.result] : 'brak'}</p>
            {result?.note && <p className="mt-1 text-sm">{result.note}</p>}
          </article>
        })}</div>
      </section>
      {protocol.unilateral && <section className="mt-8 border-2 border-[#8a4e21] bg-[#fff0da] p-5">
        <p className="text-xs font-extrabold uppercase tracking-[0.2em]">Oddzielny zapis wykonawcy</p>
        <h2 className="mt-2 text-xl font-extrabold" style={{ fontFamily: 'var(--font-client-display)' }}>Protokół jednostronny</h2>
        <p className="mt-2 text-sm">{protocol.unilateral.circumstances}</p>
        <p className="mt-2 text-sm font-bold">Ten zapis nie oznacza odbioru przez klienta.</p>
      </section>}
      {protocol.photos.length > 0 && <section className="mt-8"><h2 className="text-xl font-extrabold" style={{ fontFamily: 'var(--font-client-display)' }}>Zdjęcia dokumentacyjne</h2><ul className="mt-3 space-y-2 text-sm">{protocol.photos.map((photo) => <li key={photo.id}><a className="font-bold underline underline-offset-4" href={`/api/public/acceptance/${token}/photos/${photo.id}`} target="_blank" rel="noreferrer">{photo.name}</a></li>)}</ul></section>}
      {!protocol.isLatest && <p className="mt-8 border border-[#8a4e21] bg-[#fff0da] p-5 text-sm font-bold">To wcześniejsza wersja. Poproś o nowy link, aby potwierdzić aktualny zakres.</p>}
      {saved ? <section className="mt-8 border-2 border-[#1b3029] bg-[#e6eee4] p-6" role="status">
        <p className="text-xs font-extrabold uppercase tracking-[0.22em]">Odpowiedź zapisana</p>
        <h2 className="mt-2 text-2xl font-extrabold" style={{ fontFamily: 'var(--font-client-display)' }}>{decisionNames[saved]}</h2>
        <p className="mt-2 text-sm">Dziękujemy. Treść protokołu i odpowiedź zostały utrwalone.</p>
      </section> : canRespond ? <form className="mt-9 border-t-2 border-[#1b3029] pt-8" onSubmit={submit}>
        <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-[#9a5b22]">02 / decyzja klienta</p>
        <h2 className="mt-2 text-2xl font-extrabold" style={{ fontFamily: 'var(--font-client-display)' }}>Potwierdzenie odbioru</h2>
        <fieldset className="mt-5 space-y-2"><legend className="mb-2 text-sm font-bold">Wybierz odpowiedź</legend>
          {([['ACCEPTED', 'Odbieram'], ['ACCEPTED_WITH_REMARKS', 'Odbieram z uwagami'], ['REFUSED', 'Nie odbieram']] as const).map(([value, label]) =>
            <label key={value} className={`flex min-h-14 cursor-pointer items-center gap-3 border px-4 py-3 text-sm font-bold ${decision === value ? 'border-[#1b3029] bg-[#dfebe2]' : 'border-[#9eaa9e] bg-white'}`}>
              <input type="radio" name="decision" value={value} checked={decision === value} onChange={() => setDecision(value)} />{label}
            </label>)}</fieldset>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">Imię<input required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} className="mt-1 block min-h-12 w-full border border-[#9eaa9e] bg-white px-3" /></label>
          <label className="text-sm font-bold">Nazwisko<input required maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} className="mt-1 block min-h-12 w-full border border-[#9eaa9e] bg-white px-3" /></label>
        </div>
        <label className="mt-4 block text-sm font-bold">Kim jesteś wobec zlecenia?<input required maxLength={120} value={relationship} onChange={(event) => setRelationship(event.target.value)} placeholder="np. klient, domownik, pełnomocnik" className="mt-1 block min-h-12 w-full border border-[#9eaa9e] bg-white px-3" /></label>
        {decision !== 'ACCEPTED' && <label className="mt-4 block text-sm font-bold">{decision === 'REFUSED' ? 'Powód odmowy' : 'Uwagi'}<textarea required maxLength={3000} rows={3} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 block w-full border border-[#9eaa9e] bg-white p-3" /></label>}
        <div className="mt-6">
          <p className="text-sm font-bold">Podpis {decision === 'REFUSED' ? '(opcjonalnie)' : '(wymagany)'}</p>
          <canvas ref={canvasRef} width={650} height={180} aria-label="Pole podpisu klienta" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false }} onPointerCancel={() => { drawing.current = false }} className="mt-2 h-40 w-full touch-none border border-dashed border-[#9eaa9e] bg-white" />
          <button type="button" onClick={clearSignature} className="mt-2 text-sm font-bold underline underline-offset-4">Wyczyść podpis</button>
        </div>
        {error && <p role="alert" className="mt-4 text-sm font-bold text-red-800">{error}</p>}
        <button type="submit" disabled={busy} className="mt-5 min-h-13 w-full bg-[#1b3029] px-6 py-3 font-bold text-white disabled:opacity-50">{busy ? 'Zapisywanie…' : 'Potwierdź decyzję'}</button>
      </form> : <p className="mt-8 border border-[#9eaa9e] bg-white p-5 text-sm">Ten protokół nie oczekuje już na odpowiedź.</p>}
      {canDownload && <div className="mt-6 flex flex-wrap gap-3">
        <a href={`/api/public/acceptance/${token}/pdf`} className="inline-flex min-h-12 items-center bg-[#1b3029] px-5 text-sm font-bold text-white">Pobierz PDF protokołu</a>
        {protocol.unilateral && <a href={`/api/public/acceptance/${token}/pdf?kind=UNILATERAL`} className="inline-flex min-h-12 items-center border border-[#1b3029] px-5 text-sm font-bold">Pobierz PDF jednostronny</a>}
      </div>}
      <footer className="mt-12 border-t border-[#9eaa9e] pt-4 text-xs text-[#4d6157]">WallDecor · Protokół odbioru prac</footer>
    </div>
  </main>
}
