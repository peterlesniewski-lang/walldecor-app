'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { InstallationEmployeeOption } from './order-form'

type Person = InstallationEmployeeOption & { active?: boolean }
type Delegation = {
  id: string
  delegateEmployee: Person
  startsAt: Date | string
  endsAt: Date | string | null
  endedAt: Date | string | null
  reason: string
}
type History = { id: string; action: string; actorId: string; createdAt: Date | string }

function toLocalInput(value: Date | string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function personName(person: Person) {
  return `${person.firstName} ${person.lastName}`
}

export function OwnershipPanel({
  orderId,
  employees,
  owners,
  delegations,
  history,
  canManage,
}: {
  orderId: string
  employees: InstallationEmployeeOption[]
  owners: { primary: Person; backup: Person }
  delegations: Delegation[]
  history: History[]
  canManage: boolean
}) {
  const router = useRouter()
  const [primaryEmployeeId, setPrimaryEmployeeId] = useState(owners.primary.id)
  const [backupEmployeeId, setBackupEmployeeId] = useState(owners.backup.id)
  const [delegateEmployeeId, setDelegateEmployeeId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function send(action: Record<string, unknown>) {
    setSaving(true); setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/ownership`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(result.error ?? 'Nie udało się zapisać odpowiedzialności.')
        return false
      }
      router.refresh()
      return true
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.')
      return false
    } finally { setSaving(false) }
  }

  async function saveOwners(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await send({ action: 'SET_OWNERS', primaryEmployeeId, backupEmployeeId })
  }

  async function createDelegation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await send({ action: 'CREATE_DELEGATION', delegateEmployeeId, startsAt, endsAt, reason })) {
      setDelegateEmployeeId(''); setStartsAt(''); setEndsAt(''); setReason('')
    }
  }

  return <section className="mt-6 rounded-2xl border p-5 sm:p-6" aria-labelledby="ownership-heading" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
    <p className="data-label" style={{ color: '#8C5718' }}>Odpowiedzialność</p>
    <h2 id="ownership-heading" className="mt-1 text-xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>Opiekun, zastępstwo i czasowe przejęcie</h2>
    <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Karta zawsze ma dwóch różnych aktywnych opiekunów. Delegacja nie zależy od urlopów ani ich zatwierdzenia.</p>

    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl p-3" style={{ background: 'var(--wd-sand-light)' }}><dt className="text-xs font-bold uppercase tracking-wide" style={{ color: '#765d42' }}>Główny opiekun</dt><dd className="mt-1 text-sm font-bold">{personName(owners.primary)}</dd></div>
      <div className="rounded-xl p-3" style={{ background: 'var(--wd-sand-light)' }}><dt className="text-xs font-bold uppercase tracking-wide" style={{ color: '#765d42' }}>Zastępca</dt><dd className="mt-1 text-sm font-bold">{personName(owners.backup)}</dd></div>
    </dl>

    {canManage && <>
      <form className="mt-5 grid gap-3 border-t pt-5 sm:grid-cols-3" onSubmit={saveOwners}>
        <div><Label htmlFor="ownership-primary">Nowy opiekun</Label><select id="ownership-primary" value={primaryEmployeeId} onChange={(event) => setPrimaryEmployeeId(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border px-3 text-sm"><option value="">Wybierz osobę</option>{employees.map((employee) => <option value={employee.id} key={employee.id} disabled={employee.id === backupEmployeeId}>{personName(employee)}</option>)}</select></div>
        <div><Label htmlFor="ownership-backup">Nowy zastępca</Label><select id="ownership-backup" value={backupEmployeeId} onChange={(event) => setBackupEmployeeId(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border px-3 text-sm"><option value="">Wybierz osobę</option>{employees.map((employee) => <option value={employee.id} key={employee.id} disabled={employee.id === primaryEmployeeId}>{personName(employee)}</option>)}</select></div>
        <div className="flex items-end"><Button type="submit" disabled={saving || !primaryEmployeeId || !backupEmployeeId} className="min-h-11 w-full">Zapisz opiekunów</Button></div>
      </form>

      <form className="mt-5 grid gap-3 border-t pt-5 sm:grid-cols-2" onSubmit={createDelegation}>
        <div className="sm:col-span-2"><h3 className="text-sm font-bold">Czasowe zastępstwo</h3><p className="mt-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>Osoba dostanie dostęp wyłącznie w podanym okresie; można go zakończyć wcześniej.</p></div>
        <div><Label htmlFor="delegation-person">Osoba przejmująca</Label><select id="delegation-person" aria-label="Osoba przejmująca" value={delegateEmployeeId} onChange={(event) => setDelegateEmployeeId(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border px-3 text-sm"><option value="">Wybierz osobę</option>{employees.filter((employee) => employee.id !== primaryEmployeeId && employee.id !== backupEmployeeId).map((employee) => <option value={employee.id} key={employee.id}>{personName(employee)}</option>)}</select></div>
        <div><Label htmlFor="delegation-reason">Powód delegacji</Label><Input id="delegation-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <div><Label htmlFor="delegation-start">Początek delegacji</Label><Input id="delegation-start" aria-label="Początek delegacji" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></div>
        <div><Label htmlFor="delegation-end">Koniec delegacji</Label><Input id="delegation-end" aria-label="Koniec delegacji" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></div>
        <div className="sm:col-span-2"><Button type="submit" disabled={saving || !delegateEmployeeId || !startsAt || !endsAt || reason.trim().length < 3}>Ustanów czasowe zastępstwo</Button></div>
      </form>
    </>}

    <div className="mt-5 border-t pt-5"><h3 className="text-sm font-bold">Historia zastępstw</h3>{delegations.length === 0 ? <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak czasowych delegacji.</p> : <ul className="mt-3 space-y-2">{delegations.map((delegation) => <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm" key={delegation.id}><span><strong>{personName(delegation.delegateEmployee)}</strong> · {toLocalInput(delegation.startsAt).replace('T', ' ')} – {delegation.endsAt ? toLocalInput(delegation.endsAt).replace('T', ' ') : 'bez końca'}<br /><span style={{ color: 'var(--wd-text-muted)' }}>{delegation.reason}</span></span>{canManage && !delegation.endedAt && <Button variant="outline" type="button" disabled={saving} onClick={() => void send({ action: 'END_DELEGATION', delegationId: delegation.id })}>Zakończ teraz</Button>}</li>)}</ul>}</div>
    {history.length > 0 && <p className="mt-4 text-xs" style={{ color: 'var(--wd-text-muted)' }}>Zdarzenia odpowiedzialności są audytowane z osobą wykonującą zmianę i czasem zapisu.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>
}
