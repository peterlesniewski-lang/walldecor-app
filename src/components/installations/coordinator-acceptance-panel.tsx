'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatWarsawDateTime } from '@/lib/installations/visit-time'

export type CoordinatorAcceptanceView = {
  id: string
  revision: number
  workType: string
  visitStartsAt: string | null
  status: string
  clientNote: string | null
  links: Array<{ id: string; recipientEmail: string | null; expiresAt: string; revokedAt: string | null; sentAt: string | null }>
}

const stateName: Record<string, string> = {
  DRAFT: 'Szkic wykonawcy', INSTALLER_SIGNED: 'Czeka na klienta', ACCEPTED: 'Odebrano',
  ACCEPTED_WITH_REMARKS: 'Odebrano z uwagami', REFUSED: 'Odmowa odbioru', UNILATERAL: 'Protokół jednostronny',
}

export function CoordinatorAcceptancePanel({ orderId, protocols }: { orderId: string; protocols: CoordinatorAcceptanceView[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  async function send(protocolId: string) {
    setBusy(protocolId); setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/protocols/${protocolId}/email-link`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się wysłać linku.')
      router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się wysłać linku.') }
    finally { setBusy(null) }
  }
  async function revoke(protocolId: string, linkId: string) {
    setBusy(protocolId); setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/protocols/${protocolId}/email-link`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkId }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się cofnąć linku.')
      router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się cofnąć linku.') }
    finally { setBusy(null) }
  }
  return <section id="acceptance" className="scroll-mt-6 rounded-2xl border border-black/15 bg-white p-5 sm:p-6" aria-labelledby="coordinator-acceptance-heading">
    <p className="text-xs font-extrabold uppercase tracking-[0.2em]" style={{ color: '#8C5718' }}>Po montażu</p>
    <h2 id="coordinator-acceptance-heading" className="mt-2 text-2xl font-extrabold" style={{ color: 'var(--wd-dark)' }}>Protokoły odbioru</h2>
    {protocols.length === 0 && <p className="mt-4 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Wykonawcy nie przygotowali jeszcze protokołów.</p>}
    <div className="mt-4 divide-y divide-black/10">{protocols.map((protocol) => {
      const activeLinks = protocol.links.filter((link) => !link.revokedAt && new Date(link.expiresAt) > new Date())
      return <article key={protocol.id} className="py-4 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-extrabold">{protocol.workType} <span className="text-sm font-medium">· wersja {protocol.revision}</span></h3>
            <p className="mt-1 text-sm">{protocol.visitStartsAt ? formatWarsawDateTime(protocol.visitStartsAt) : 'Wizyta'} · {stateName[protocol.status] ?? protocol.status}</p>
            {protocol.clientNote && <p className="mt-1 text-sm font-semibold text-amber-900">{protocol.clientNote}</p>}
            {activeLinks.map((link) => <p key={link.id} className="mt-1 text-xs">Link aktywny do {formatWarsawDateTime(link.expiresAt)} · {link.recipientEmail}</p>)}
          </div>
          {protocol.status !== 'DRAFT' && <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} onClick={() => send(protocol.id)} className="min-h-10 rounded-full px-4 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'var(--wd-dark)' }}>{busy === protocol.id ? 'Przetwarzanie…' : 'Wyślij nowy link'}</button>
            {activeLinks.map((link) => <button key={link.id} type="button" disabled={busy !== null} onClick={() => revoke(protocol.id, link.id)} className="min-h-10 rounded-full border border-black/30 px-4 text-xs font-bold disabled:opacity-50">Cofnij link</button>)}
          </div>}
        </div>
      </article>
    })}</div>
    {error && <p role="alert" className="mt-4 text-sm font-bold text-red-800">{error}</p>}
  </section>
}
