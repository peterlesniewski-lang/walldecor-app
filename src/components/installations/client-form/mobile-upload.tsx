'use client'

import { useEffect, useRef, useState } from 'react'

type State = 'redeeming' | 'ready' | 'uploading' | 'done' | 'unavailable' | 'error'

export function MobileUpload({ code }: { code: string }) {
  const [state, setState] = useState<State>('redeeming')
  const [message, setMessage] = useState('Przygotowujemy bezpieczne dodanie pliku…')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let alive = true
    void fetch(`/api/public/mobile-upload/${encodeURIComponent(code)}/redeem`, { method: 'POST', cache: 'no-store' })
      .then(async (response) => {
        if (!alive) return
        if (!response.ok) { setState('unavailable'); setMessage('Ten kod został już wykorzystany, wygasł albo został wycofany.'); return }
        setState('ready'); setMessage('Dodaj zdjęcie lub plik dotyczący wskazanego miejsca.')
      })
      .catch(() => { if (alive) { setState('error'); setMessage('Nie udało się otworzyć bezpiecznego przekazania. Spróbuj ponownie.') } })
    return () => { alive = false }
  }, [code])

  async function upload(file: File | undefined) {
    if (!file || state === 'uploading' || state === 'done') return
    setState('uploading'); setMessage('Dodajemy plik…')
    const data = new FormData()
    data.set('file', file)
    try {
      const response = await fetch('/api/public/mobile-upload/session/files', { method: 'POST', body: data })
      if (!response.ok) throw new Error('upload')
      setState('done'); setMessage('Plik został dodany. Możesz bezpiecznie wrócić do formularza na drugim urządzeniu.')
    } catch {
      setState('error'); setMessage('Nie udało się dodać pliku. Sprawdź połączenie i spróbuj ponownie.')
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return <main className="min-h-screen px-5 py-10" style={{ background: '#f5f4f0', color: '#21211e' }}>
    <section className="mx-auto max-w-md rounded-3xl border p-6 shadow-sm" style={{ background: '#fffdf9', borderColor: 'rgba(33,33,30,.14)' }}>
      <p className="text-xs font-bold uppercase tracking-[.18em]" style={{ color: '#8c5718' }}>WallDecor · przekazanie pliku</p>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight">Dodaj plik z telefonu</h1>
      <p className="mt-3 text-sm leading-6" style={{ color: '#63635d' }}>{message}</p>
      {state === 'ready' && <div className="mt-7 grid gap-3">
        <label className="block cursor-pointer rounded-2xl px-4 py-4 text-center text-sm font-bold" style={{ background: '#25251f', color: '#fffdf9' }}>
          Zrób zdjęcie
          <input ref={inputRef} aria-label="Zrób zdjęcie" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(event) => void upload(event.currentTarget.files?.[0])} />
        </label>
        <label className="block cursor-pointer rounded-2xl border px-4 py-4 text-center text-sm font-bold" style={{ borderColor: 'rgba(33,33,30,.18)' }}>
          Wybierz z urządzenia
          <input aria-label="Wybierz z urządzenia" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => void upload(event.currentTarget.files?.[0])} />
        </label>
      </div>}
      {(state === 'redeeming' || state === 'uploading') && <div className="mt-7 h-1 overflow-hidden rounded-full" style={{ background: '#e8e4dc' }}><div className="h-full w-2/3 animate-pulse rounded-full" style={{ background: '#8c5718' }} /></div>}
    </section>
  </main>
}
