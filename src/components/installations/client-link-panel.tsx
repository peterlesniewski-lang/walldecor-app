'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export type InstallationClientLinkStatus = {
  id: string
  expiresAt: Date | string
  revokedAt: Date | string | null
  createdAt: Date | string
  lastOpenedAt: Date | string | null
  sentAt: Date | string | null
  sentById: string | null
}

function defaultExpiry() {
  const date = new Date()
  date.setDate(date.getDate() + 21)
  return date.toISOString().slice(0, 16)
}

export function ClientLinkPanel({ orderId, initialLinks, canEdit, canGenerate = true }: {
  orderId: string
  initialLinks: InstallationClientLinkStatus[]
  canEdit: boolean
  canGenerate?: boolean
}) {
  const [links, setLinks] = useState(initialLinks)
  const [expiresAt, setExpiresAt] = useState(defaultExpiry)
  const [oneTimeUrl, setOneTimeUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'copied'>('idle')
  const [error, setError] = useState('')
  const [focusSentStatus, setFocusSentStatus] = useState(false)
  const sentStatusRef = useRef<HTMLParagraphElement>(null)
  const active = useMemo(() => links.find((link) => !link.revokedAt && new Date(link.expiresAt) > new Date()) ?? null, [links])

  useEffect(() => {
    if (focusSentStatus && active?.sentAt) {
      sentStatusRef.current?.focus()
      setFocusSentStatus(false)
    }
  }, [active?.sentAt, focusSentStatus])

  async function request(body: object, method: 'POST' | 'PATCH', focusSentStatusOnSuccess = false) {
    setState('loading'); setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/client-link`, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json() as { error?: string; link?: InstallationClientLinkStatus; url?: string }
      if (!response.ok || !data.link) throw new Error(data.error ?? 'Nie udało się zaktualizować linku.')
      setLinks((current) => [data.link!, ...current.filter((link) => link.id !== data.link!.id)])
      setOneTimeUrl(data.url ?? null)
      setState('idle')
      if (focusSentStatusOnSuccess) setFocusSentStatus(true)
    } catch (caught) {
      setState('error'); setError(caught instanceof Error ? caught.message : 'Nie udało się zaktualizować linku.')
    }
  }

  async function copy() {
    if (!oneTimeUrl) return
    try { await navigator.clipboard.writeText(oneTimeUrl); setState('copied') } catch { setState('error'); setError('Skopiuj link ręcznie z pola powyżej.') }
  }

  function extensionExpiry(days: number) {
    const now = new Date()
    const activeExpiry = active ? new Date(active.expiresAt) : now
    const base = activeExpiry > now ? activeExpiry : now
    base.setDate(base.getDate() + days)
    return base.toISOString()
  }

  return <section className="mt-6 rounded-xl border p-4" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30,30,30,.12)', boxShadow: 'var(--card-shadow)' }}>
    <p className="data-label">Formularz klienta</p>
    <h2 className="mt-1 text-xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>Bezpieczny link do przygotowania montażu</h2>
    {active ? <>
      <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Aktywny do <span className="num">{new Date(active.expiresAt).toLocaleString('pl-PL')}</span>{active.lastOpenedAt ? <> · <span className="num">{`Klient otworzył link: ${new Date(active.lastOpenedAt).toLocaleString('pl-PL')}`}</span></> : ' · jeszcze nieotwarty'}.</p>
      {active.sentAt && <p ref={sentStatusRef} role="status" aria-live="polite" tabIndex={-1} className="mt-1 text-sm font-semibold" style={{ color: 'var(--wd-dark)' }}>{`Wysłano: ${new Date(active.sentAt).toLocaleString('pl-PL')}`}</p>}
    </> : <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak aktywnego linku klienta.</p>}
    {canEdit && !canGenerate && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">Najpierw przypnij dokładnie jeden formularz klienta do zlecenia.</p>}
    {canEdit && <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <label className="grid gap-1 text-sm font-semibold" htmlFor={`client-link-expiry-${orderId}`}>Ważny do
        <input id={`client-link-expiry-${orderId}`} className="min-h-11 rounded-md border px-3" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={state === 'loading' || !canGenerate} />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" className="min-h-11 rounded-md px-4 text-sm font-bold" style={{ background: '#E4DCD1', color: '#1E1E1E' }} onClick={() => void request({ expiresAt: new Date(expiresAt).toISOString() }, 'POST')} disabled={state === 'loading' || !canGenerate}>{active ? 'Wygeneruj nowy link' : 'Wygeneruj link'}</button>
        {active && !active.sentAt && <button type="button" className="min-h-11 rounded-md border px-4 text-sm font-bold" onClick={() => void request({ action: 'MARK_SENT', linkId: active.id }, 'PATCH', true)} disabled={state === 'loading'}>Oznacz jako wysłany</button>}
        {active && <button type="button" className="min-h-11 rounded-md border px-4 text-sm font-bold" onClick={() => void request({ action: 'EXTEND', linkId: active.id, expiresAt: extensionExpiry(14) }, 'PATCH')} disabled={state === 'loading'}>Przedłuż o 14 dni</button>}
        {active && <button type="button" className="min-h-11 rounded-md border px-4 text-sm font-bold" onClick={() => void request({ action: 'REVOKE', linkId: active.id }, 'PATCH')} disabled={state === 'loading'}>Cofnij link</button>}
      </div>
    </div>}
    {oneTimeUrl && <div className="mt-4 rounded-lg border p-3" style={{ borderColor: '#CDA864', background: '#FFF8EA' }}>
      <p className="text-sm font-bold">Skopiuj teraz — po odświeżeniu adres nie będzie ponownie wyświetlany.</p>
      <output className="num mt-2 block break-all rounded bg-white p-2 text-xs">{oneTimeUrl}</output>
      <button type="button" className="mt-2 min-h-11 rounded-md border px-3 text-sm font-bold" onClick={() => void copy()}>{state === 'copied' ? 'Skopiowano' : 'Kopiuj link'}</button>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>
}
