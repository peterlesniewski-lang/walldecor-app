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

type ClientLinkPanelProps = {
  orderId: string
  initialLinks: InstallationClientLinkStatus[]
  canEdit: boolean
  canGenerate?: boolean
}

export function ClientLinkPanel(props: ClientLinkPanelProps) {
  // Remount immediately on identity/permission changes, clearing secret state.
  return <ClientLinkPanelContent key={`${props.orderId}:${props.canEdit}`} {...props} />
}

function ClientLinkPanelContent({ orderId, initialLinks, canEdit, canGenerate = true }: ClientLinkPanelProps) {
  const [links, setLinks] = useState(initialLinks)
  const [expiresAt, setExpiresAt] = useState(defaultExpiry)
  const [generatedLink, setGeneratedLink] = useState<{ id: string; url: string; createdAt: Date | string } | null>(null)
  const requestVersion = useRef(0)
  const mutationVersion = useRef(0)
  const mutationPending = useRef(false)
  const [legacyLink, setLegacyLink] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'copied'>('idle')
  const [error, setError] = useState('')
  const [focusSentStatus, setFocusSentStatus] = useState(false)
  const sentStatusRef = useRef<HTMLParagraphElement>(null)
  const active = useMemo(() => links.find((link) => !link.revokedAt && new Date(link.expiresAt) > new Date()) ?? null, [links])
  const savedUrl = canEdit && generatedLink?.id === active?.id ? generatedLink?.url ?? null : null
  useEffect(() => () => { mutationVersion.current++; mutationPending.current = false }, [])
  useEffect(() => {
    setLinks(initialLinks)
    setGeneratedLink((current) => {
      if (!current) return null
      const saved = initialLinks.find((link) => link.id === current.id)
      const replaced = initialLinks.some((link) => link.id !== current.id && !link.revokedAt && new Date(link.createdAt) >= new Date(current.createdAt))
      // An older in-flight refresh may not know the freshly generated link yet.
      // Only discard its secret URL when the server confirms invalidation.
      return saved?.revokedAt || (saved && new Date(saved.expiresAt) <= new Date()) || replaced ? null : current
    })
  }, [initialLinks])

  useEffect(() => {
    const version = ++requestVersion.current
    const controller = new AbortController()
    const expected = initialLinks.find((link) => !link.revokedAt && new Date(link.expiresAt) > new Date())
    setLegacyLink(false)
    if (canEdit && expected && !mutationPending.current) {
      void (async () => {
        try {
          const response = await fetch(`/api/installations/${orderId}/client-link`, { method: 'GET', cache: 'no-store', signal: controller.signal })
          const data = await response.json() as { error?: string; link?: InstallationClientLinkStatus | null; url?: string | null; reason?: string }
          if (controller.signal.aborted || version !== requestVersion.current) return
          if (!response.ok) {
            setGeneratedLink(null)
            throw new Error(data.error ?? 'Nie udało się odczytać linku klienta.')
          }
          if (!data.link || data.link.revokedAt || new Date(data.link.expiresAt) <= new Date()) {
            setGeneratedLink(null)
            setLinks((current) => current.map((link) => !link.revokedAt ? { ...link, revokedAt: new Date().toISOString() } : link))
            return
          }
          // The epoch rejected reads predating a mutation. This fresh server
          // result is authoritative even when RSC props or timestamps are stale.
          setLinks((current) => [data.link!, ...current.filter((link) => link.id !== data.link!.id).map((link) => !link.revokedAt ? { ...link, revokedAt: new Date().toISOString() } : link)])
          setLegacyLink(data.reason === 'LEGACY_HASH_ONLY')
          setGeneratedLink(data.url ? { id: data.link.id, url: data.url, createdAt: data.link.createdAt } : null)
        } catch (caught) {
          if (controller.signal.aborted || version !== requestVersion.current) return
          setError(caught instanceof Error ? caught.message : 'Nie udało się odczytać linku klienta.')
        }
      })()
    }
    return () => { controller.abort(); requestVersion.current++ }
  }, [orderId, canEdit, initialLinks])

  useEffect(() => {
    if (focusSentStatus && active?.sentAt) {
      sentStatusRef.current?.focus()
      setFocusSentStatus(false)
    }
  }, [active?.sentAt, focusSentStatus])

  async function request(body: object, method: 'POST' | 'PATCH', focusSentStatusOnSuccess = false) {
    requestVersion.current++
    const version = ++mutationVersion.current
    mutationPending.current = true
    setState('loading'); setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/client-link`, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json() as { error?: string; link?: InstallationClientLinkStatus; url?: string }
      if (version !== mutationVersion.current) return
      if (response.status === 401 || response.status === 403) setGeneratedLink(null)
      if (!response.ok || !data.link) throw new Error(data.error ?? 'Nie udało się zaktualizować linku.')
      setLinks((current) => [data.link!, ...current.filter((link) => link.id !== data.link!.id).map((link) => data.url && !link.revokedAt ? { ...link, revokedAt: new Date().toISOString() } : link)])
      if (data.url) setGeneratedLink({ id: data.link.id, url: data.url, createdAt: data.link.createdAt })
      else if (data.link.revokedAt) setGeneratedLink(null)
      if (data.url || data.link.revokedAt) setLegacyLink(false)
      setState('idle')
      if (focusSentStatusOnSuccess) setFocusSentStatus(true)
    } catch (caught) {
      if (version !== mutationVersion.current) return
      setState('error'); setError(caught instanceof Error ? caught.message : 'Nie udało się zaktualizować linku.')
    } finally {
      if (version === mutationVersion.current) mutationPending.current = false
    }
  }

  async function copy() {
    if (!savedUrl) return
    try { await navigator.clipboard.writeText(savedUrl); setState('copied') } catch { setState('error'); setError('Skopiuj link ręcznie z pola powyżej.') }
  }

  function extensionExpiry(days: number) {
    const now = new Date()
    const activeExpiry = active ? new Date(active.expiresAt) : now
    const base = activeExpiry > now ? activeExpiry : now
    base.setDate(base.getDate() + days)
    return base.toISOString()
  }

  function generate() {
    if (active && !window.confirm('Wygenerować nowy link? Dotychczasowy link klienta przestanie działać.')) return
    const expiry = new Date(expiresAt)
    if (!Number.isFinite(expiry.getTime())) { setError('Podaj poprawny termin ważności linku.'); return }
    void request({ expiresAt: expiry.toISOString() }, 'POST')
  }

  const generation = <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
    <label className="grid gap-1 text-sm font-semibold" htmlFor={`client-link-expiry-${orderId}`}>Ważny do
      <input id={`client-link-expiry-${orderId}`} className="min-h-11 min-w-0 rounded-md border px-3" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={state === 'loading' || !canGenerate} />
    </label>
    <button type="button" className="min-h-11 self-end rounded-md px-4 text-sm font-bold" style={{ background: '#E4DCD1', color: '#1E1E1E' }} onClick={generate} disabled={state === 'loading' || !canGenerate}>{active ? 'Wygeneruj nowy link' : 'Wygeneruj link'}</button>
  </div>

  return <section className="mt-6 rounded-xl border p-4" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30,30,30,.12)', boxShadow: 'var(--card-shadow)' }}>
    <h3 className="font-bold" style={{ color: 'var(--wd-dark)' }}>Link dla klienta</h3>
    {active ? <>
      <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Aktywny do <span className="num">{new Date(active.expiresAt).toLocaleString('pl-PL')}</span>{active.lastOpenedAt ? <> · <span className="num">{`Klient otworzył link: ${new Date(active.lastOpenedAt).toLocaleString('pl-PL')}`}</span></> : ' · jeszcze nieotwarty'}.</p>
      {active.sentAt && <p ref={sentStatusRef} role="status" aria-live="polite" tabIndex={-1} className="mt-1 text-sm font-semibold" style={{ color: 'var(--wd-dark)' }}>{`Wysłano: ${new Date(active.sentAt).toLocaleString('pl-PL')}`}</p>}
    </> : <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak aktywnego linku klienta.</p>}
    {canEdit && !canGenerate && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">Najpierw wybierz formularz dla tego zlecenia.</p>}
    {canEdit && !active && generation}
    {canEdit && active && <>
      {!active.sentAt && <div className="mt-3"><p className="mb-2 text-sm">Wyślij link klientowi ze swojej poczty, a następnie oznacz wysyłkę tutaj.</p><button type="button" className="min-h-11 rounded-md border px-4 text-sm font-bold" onClick={() => void request({ action: 'MARK_SENT', linkId: active.id }, 'PATCH', true)} disabled={state === 'loading'}>Oznacz jako wysłany</button></div>}
      <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Zarządzaj linkiem</summary>
        {generation}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded-md border px-4 text-sm font-bold" onClick={() => void request({ action: 'EXTEND', linkId: active.id, expiresAt: extensionExpiry(14) }, 'PATCH')} disabled={state === 'loading'}>Przedłuż o 14 dni</button>
          <button type="button" className="min-h-11 rounded-md border px-4 text-sm font-bold" onClick={() => { if (window.confirm('Cofnąć link? Klient straci możliwość otwarcia formularza pod tym adresem.')) void request({ action: 'REVOKE', linkId: active.id }, 'PATCH') }} disabled={state === 'loading'}>Cofnij link</button>
        </div>
      </details>
    </>}
    {canEdit && active && legacyLink && <p className="mt-3 text-sm">Adresu tego starszego linku nie można ponownie odczytać. Dotychczasowy link nadal działa. Jeśli nie masz jego kopii, możesz świadomie wygenerować nowy w sekcji zarządzania.</p>}
    {savedUrl && <div className="mt-4 rounded-lg border p-3" style={{ borderColor: '#CDA864', background: '#FFF8EA' }}>
      <p className="text-sm font-bold">Link do formularza klienta</p>
      <output className="num mt-2 block break-all rounded bg-white p-2 text-xs">{savedUrl}</output>
      <button type="button" className="mt-2 min-h-11 rounded-md border px-3 text-sm font-bold" onClick={() => void copy()}>{state === 'copied' ? 'Skopiowano' : 'Kopiuj link'}</button>
      <a className="ml-2 inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-bold" href={savedUrl} target="_blank" rel="noopener noreferrer">Otwórz formularz</a>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>
}
