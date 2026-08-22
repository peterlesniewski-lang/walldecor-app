'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Policy = {
  id: string
  version: number
  grossAmount: string
  clauseText: string
  legalApprovedAt: string | null
  isDefault: boolean
}

export function VisitFeeSettingsPanel() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [grossAmount, setGrossAmount] = useState('')
  const [clauseText, setClauseText] = useState('')
  const [legalApprovedAt, setLegalApprovedAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/settings/installation-visit-fee', { cache: 'no-store' })
        if (!response.ok) throw new Error('load')
        const result = await response.json() as { policies?: Policy[] }
        setPolicies(result.policies ?? [])
      } catch { setError('Nie udało się wczytać wersji klauzuli.') } finally { setLoading(false) }
    })()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/settings/installation-visit-fee', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grossAmount, clauseText, legalApprovedAt: legalApprovedAt || null }),
      })
      const result = await response.json() as { policy?: Policy; error?: string }
      if (!response.ok || !result.policy) { setError(result.error ?? 'Nie udało się zapisać wersji klauzuli.'); return }
      const policy: Policy = result.policy
      setPolicies((current) => [{ ...policy, isDefault: true }, ...current.map((currentPolicy) => ({ ...currentPolicy, isDefault: false }))])
      setGrossAmount(''); setClauseText(''); setLegalApprovedAt('')
    } catch { setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.') } finally { setSaving(false) }
  }

  return <div className="rounded-xl border p-5" style={{ background: 'var(--wd-white)', borderColor: 'var(--wd-border)' }}>
    <p className="data-label" style={{ color: '#8C5718' }}>Montaże</p>
    <h3 className="mt-1 text-lg font-bold" style={{ color: 'var(--wd-dark)' }}>Wersje klauzuli opłaty za podjazd</h3>
    <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Nie wpisujemy gotowej treści prawnej automatycznie. Wersja bez daty zatwierdzenia prawnego pozostaje nieaktywna i nie pojawi się klientowi.</p>
    {loading ? <p className="mt-4 text-sm">Wczytywanie…</p> : <ul className="mt-4 space-y-2">{policies.length === 0 ? <li className="rounded-lg p-3 text-sm" style={{ background: 'var(--wd-sand-light)' }}>Brak zatwierdzenia prawnego i brak aktywnej klauzuli.</li> : policies.map((policy) => <li className="rounded-lg border p-3 text-sm" key={policy.id}><strong>v{policy.version} · {policy.grossAmount.replace('.', ',')} zł brutto</strong>{policy.isDefault && <span className="ml-2 text-xs font-bold" style={{ color: '#8C5718' }}>DOMYŚLNA</span>}<br /><span style={{ color: 'var(--wd-text-muted)' }}>{policy.legalApprovedAt ? `zatwierdzenie prawne: ${new Date(policy.legalApprovedAt).toLocaleDateString('pl-PL')}` : 'Brak zatwierdzenia prawnego — nieaktywna'}</span></li>)}</ul>}
    <form className="mt-5 grid gap-3 border-t pt-5" onSubmit={submit}>
      <div><Label htmlFor="visit-fee-setting-amount">Domyślna kwota brutto</Label><Input id="visit-fee-setting-amount" inputMode="decimal" placeholder="np. 249,90" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} /></div>
      <div><Label htmlFor="visit-fee-setting-clause">Treść klauzuli</Label><textarea id="visit-fee-setting-clause" className="mt-2 min-h-28 w-full rounded-lg border p-3 text-sm" value={clauseText} onChange={(event) => setClauseText(event.target.value)} /></div>
      <div><Label htmlFor="visit-fee-setting-legal">Data zatwierdzenia prawnego (opcjonalnie)</Label><Input id="visit-fee-setting-legal" type="date" value={legalApprovedAt} onChange={(event) => setLegalApprovedAt(event.target.value)} /></div>
      <div><Button type="submit" disabled={saving || !grossAmount || clauseText.trim().length < 20}>{saving ? 'Zapisywanie…' : 'Dodaj nową wersję'}</Button></div>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </div>
}
