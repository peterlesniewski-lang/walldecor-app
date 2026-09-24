'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatWarsawDateTime } from '@/lib/installations/visit-time'

export type CoordinatorAcceptanceView = {
  id: string
  revision: number
  isLatest: boolean
  resolvedByProtocolId: string | null
  hasIncompleteWorks: boolean
  invoiceTask: { id: string; title: string; status: string } | null
  workType: string
  visitStartsAt: string | null
  status: string
  unilateralStatus: string | null
  failedAlerts: number
  clientNote: string | null
  links: Array<{ id: string; recipientEmail: string | null; expiresAt: string; revokedAt: string | null; sentAt: string | null }>
}

const stateName: Record<string, string> = {
  DRAFT: 'Szkic wykonawcy', INSTALLER_SIGNED: 'Czeka na klienta', ACCEPTED: 'Odebrano',
  ACCEPTED_WITH_REMARKS: 'Odebrano z uwagami', REFUSED: 'Odmowa odbioru', UNILATERAL: 'Protokół jednostronny',
}

export function CoordinatorAcceptancePanel({ orderId, protocols, canManage }: { orderId: string; protocols: CoordinatorAcceptanceView[]; canManage: boolean }) {
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
  async function retryAlerts() {
    setBusy('alerts'); setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/acceptance-alerts/retry`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się ponowić powiadomień.')
      router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się ponowić powiadomień.') }
    finally { setBusy(null) }
  }
  async function revise(protocolId: string) {
    setBusy(protocolId); setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/protocols/${protocolId}/revision`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się utworzyć nowej wersji.')
      router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się utworzyć nowej wersji.') }
    finally { setBusy(null) }
  }
  async function setInvoiceTask(taskId: string, status: 'PENDING' | 'DONE') {
    setBusy(taskId); setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/acceptance-invoice-tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się zmienić zadania.')
      router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zmienić zadania.') }
    finally { setBusy(null) }
  }
  return <section id="acceptance" className="scroll-mt-6 rounded-2xl border border-black/15 bg-white p-5 sm:p-6" aria-labelledby="coordinator-acceptance-heading">
    <p className="text-xs font-extrabold uppercase tracking-[0.2em]" style={{ color: '#8C5718' }}>Po montażu</p>
    <h2 id="coordinator-acceptance-heading" className="mt-2 text-2xl font-extrabold" style={{ color: 'var(--wd-dark)', fontFamily: 'var(--font-client-display)' }}>Protokoły odbioru</h2>
    {protocols.length === 0 && <p className="mt-4 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Wykonawcy nie przygotowali jeszcze protokołów.</p>}
    <div className="mt-4 divide-y divide-black/10">{protocols.map((protocol) => {
      const activeLinks = protocol.links.filter((link) => !link.revokedAt && new Date(link.expiresAt) > new Date())
      return <article key={protocol.id} className="py-4 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-extrabold">{protocol.workType} <span className="text-sm font-medium">· wersja {protocol.revision}</span></h3>
            <p className="mt-1 text-sm">{protocol.visitStartsAt ? formatWarsawDateTime(protocol.visitStartsAt) : 'Wizyta'} · {stateName[protocol.status] ?? protocol.status}</p>
            {protocol.resolvedByProtocolId && <p className="mt-1 text-sm font-bold text-emerald-900">Etap zamknięty po poprawkach i ponownym odbiorze podczas kolejnej wizyty.</p>}
            {protocol.unilateralStatus === 'SIGNED' && !protocol.resolvedByProtocolId && <p className="mt-1 text-sm font-bold text-amber-900">Osobny protokół jednostronny. Etap pozostaje otwarty.</p>}
            {protocol.isLatest && !protocol.resolvedByProtocolId && ['ACCEPTED_WITH_REMARKS', 'REFUSED', 'UNILATERAL'].includes(protocol.status) && <p className="mt-1 text-sm font-bold text-amber-900">Etap otwarty: po poprawkach wymagany nowy podpis wykonawcy i klienta.</p>}
            {protocol.isLatest && protocol.status === 'ACCEPTED' && protocol.hasIncompleteWorks && <p className="mt-1 text-sm font-bold text-amber-900">Część prac pozostaje niewykonana. Zadanie fakturowania nie powstało.</p>}
            {protocol.clientNote && <p className="mt-1 text-sm font-semibold text-amber-900">{protocol.clientNote}</p>}
            {protocol.isLatest && protocol.invoiceTask && <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950">Zadanie: {protocol.invoiceTask.title} · {protocol.invoiceTask.status === 'PENDING' ? 'do wykonania' : protocol.invoiceTask.status === 'DONE' ? 'wykonane' : 'wstrzymane'}</p>}
            {protocol.failedAlerts > 0 && <p className="mt-1 text-sm font-bold text-red-800">E-mail z powiadomieniem wymaga ponowienia ({protocol.failedAlerts}).</p>}
            {activeLinks.map((link) => <p key={link.id} className="mt-1 text-xs">Link aktywny do {formatWarsawDateTime(link.expiresAt)} · {link.recipientEmail}</p>)}
          </div>
          {protocol.status !== 'DRAFT' && <div className="flex flex-wrap gap-2">
            {protocol.status !== 'INSTALLER_SIGNED' && <a href={`/api/installations/${orderId}/protocols/${protocol.id}/pdf`} className="inline-flex min-h-10 items-center rounded-full border border-black/30 px-4 text-xs font-bold">PDF</a>}
            {protocol.unilateralStatus === 'SIGNED' && <a href={`/api/installations/${orderId}/protocols/${protocol.id}/pdf?kind=UNILATERAL`} className="inline-flex min-h-10 items-center rounded-full border border-black/30 px-4 text-xs font-bold">PDF jednostronny</a>}
            {canManage && protocol.isLatest && !protocol.resolvedByProtocolId && <button type="button" disabled={busy !== null} onClick={() => revise(protocol.id)} className="min-h-10 rounded-full border border-black/30 px-4 text-xs font-bold disabled:opacity-50">Nowa wersja</button>}
            {canManage && protocol.isLatest && protocol.invoiceTask?.status === 'PENDING' && <button type="button" disabled={busy !== null} onClick={() => setInvoiceTask(protocol.invoiceTask!.id, 'DONE')} className="min-h-10 rounded-full border border-emerald-800 px-4 text-xs font-bold text-emerald-950 disabled:opacity-50">Oznacz zadanie jako wykonane</button>}
            {canManage && <button type="button" disabled={busy !== null} onClick={() => send(protocol.id)} className="min-h-10 rounded-full px-4 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'var(--wd-dark)' }}>{busy === protocol.id ? 'Przetwarzanie…' : 'Wyślij nowy link'}</button>}
            {canManage && activeLinks.map((link) => <button key={link.id} type="button" disabled={busy !== null} onClick={() => revoke(protocol.id, link.id)} className="min-h-10 rounded-full border border-black/30 px-4 text-xs font-bold disabled:opacity-50">Cofnij link</button>)}
          </div>}
        </div>
      </article>
    })}</div>
    {canManage && protocols.some((protocol) => protocol.failedAlerts > 0) && <button type="button" onClick={retryAlerts} disabled={busy !== null} className="mt-4 min-h-10 rounded-full border border-red-800 px-4 text-xs font-bold text-red-800 disabled:opacity-50">Ponów e-maile z powiadomieniami</button>}
    {error && <p role="alert" className="mt-4 text-sm font-bold text-red-800">{error}</p>}
  </section>
}
