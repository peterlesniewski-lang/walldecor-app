'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Fee = {
  status: string
  grossAmount: string | null
  clauseVersion: number | null
  legalApprovedAt: Date | string | null
  selectedAt: Date | string | null
  overrideReason: string | null
  approvedAt: Date | string | null
  clientAcceptedAt: Date | string | null
}

type DefaultPolicy = { version: number; grossAmount: string; legalApprovedAt: Date | string | null } | null

function money(value: string) { return `${value.replace('.', ',')} zł brutto` }

export function VisitFeePanel({ orderId, fee, defaultPolicy, canEdit, canApprove }: {
  orderId: string
  fee: Fee
  defaultPolicy: DefaultPolicy
  canEdit: boolean
  canApprove: boolean
}) {
  const router = useRouter()
  const [grossAmount, setGrossAmount] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const legallyApprovedDefault = Boolean(defaultPolicy?.legalApprovedAt)

  async function send(action: Record<string, unknown>) {
    setSaving(true); setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/visit-fee`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) })
      const result = await response.json()
      if (!response.ok) { setError(result.error ?? 'Nie udało się zapisać opłaty.'); return false }
      router.refresh()
      return true
    } catch { setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.'); return false } finally { setSaving(false) }
  }

  async function requestOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await send({ action: 'REQUEST_OVERRIDE', grossAmount, reason })) { setGrossAmount(''); setReason('') }
  }

  return <section className="mt-6 rounded-2xl border p-5 sm:p-6" aria-labelledby="visit-fee-heading" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
    <p className="data-label" style={{ color: '#8C5718' }}>Warunek przed montażem</p>
    <h2 id="visit-fee-heading" className="mt-1 text-xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>Opłata za bezskuteczny podjazd</h2>
    <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>To nie jest automatyczne naliczenie. Potrzebne są: zatwierdzona prawnie klauzula, zgoda klienta, dowód niezgodności i decyzja koordynatora.</p>

    {fee.status === 'APPROVED' ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm"><strong>Zatwierdzona kwota: {fee.grossAmount ? money(fee.grossAmount) : '—'}</strong><br />Wersja klauzuli: {fee.clauseVersion ?? '—'} · {fee.clientAcceptedAt ? 'klient potwierdził informację' : 'oczekuje na potwierdzenie klienta'}.</div> : fee.status === 'PENDING_APPROVAL' ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><strong>Kwota oczekuje na akceptację: {fee.grossAmount ? money(fee.grossAmount) : '—'}</strong><br />{fee.overrideReason}{canApprove && <span className="mt-3 flex flex-wrap gap-2"><Button type="button" disabled={saving} onClick={() => void send({ action: 'APPROVE_OVERRIDE' })}>Zatwierdź kwotę</Button><Button type="button" variant="outline" disabled={saving} onClick={() => void send({ action: 'REJECT_OVERRIDE', reason: 'Odrzucono przez administratora lub managera.' })}>Odrzuć</Button></span>}</div> : <div className="mt-4 rounded-xl border p-3 text-sm" style={{ background: 'var(--wd-sand-light)' }}>Nie wybrano opłaty dla tej karty.</div>}

    {canEdit && <div className="mt-5 border-t pt-5">
      {defaultPolicy ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl p-3" style={{ background: 'var(--wd-sand-light)' }}><span className="text-sm"><strong>Domyślna polityka v{defaultPolicy.version}: {money(defaultPolicy.grossAmount)}</strong><br />{legallyApprovedDefault ? 'Data zatwierdzenia prawnego jest zapisana.' : 'Nieaktywna: brak daty zatwierdzenia prawnego.'}</span><Button type="button" disabled={saving || !legallyApprovedDefault} onClick={() => void send({ action: 'USE_DEFAULT' })}>Użyj domyślnej kwoty</Button></div> : <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak firmowej polityki. Administrator dodaje ją w Ustawieniach.</p>}
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={requestOverride}>
        <div><Label htmlFor="visit-fee-amount">Inna kwota brutto</Label><Input id="visit-fee-amount" inputMode="decimal" placeholder="np. 249,90" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} /></div>
        <div><Label htmlFor="visit-fee-reason">Uzasadnienie</Label><Input id="visit-fee-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <div className="sm:col-span-2"><Button type="submit" variant="outline" disabled={saving || !legallyApprovedDefault || !grossAmount || reason.trim().length < 3}>Wyślij inną kwotę do akceptacji</Button></div>
      </form>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>
}
