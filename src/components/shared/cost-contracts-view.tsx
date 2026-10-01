'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { formatGrosze } from '@/lib/payroll/money'

type Row = { id: string; effectiveFrom: string; revokedAt: string | null; createdAt: string }
type Contract = {
  id: string
  counterparty: string
  description: string
  startMonth: string
  endMonth: string | null
  isConfidential: boolean
  amounts: Array<Row & { amountGrosze: number }>
  splits: Array<Row & { jagPercent: number }>
}

const input = 'rounded border border-[var(--wd-border)] px-3 py-2 text-sm'
const primary = 'rounded bg-[var(--wd-dark)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50'
const ghost = 'rounded border border-[var(--wd-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50'

function currentMonthKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit' }).format(new Date())
}

function current<T extends Row>(rows: T[]) {
  const month = currentMonthKey()
  return rows.filter((row) => row.revokedAt === null && row.effectiveFrom <= month).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
}

function errorMessage(json: { error?: string; details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } }) {
  const field = json.details?.fieldErrors ? Object.values(json.details.fieldErrors).flat()[0] : undefined
  return field ?? json.details?.formErrors?.[0] ?? json.error ?? 'Nie udało się zapisać.'
}

export function CostContractsView() {
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/finance/cost-contracts', { cache: 'no-store' })
      .then(async (res) => { if (active) setContracts(res.ok ? await res.json() : []) })
      .catch(() => active && setError('Błąd połączenia.'))
    return () => { active = false }
  }, [])

  async function send(url: string, method: 'POST' | 'PATCH', body: unknown) {
    setPending(true)
    setError(null)
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) { setError(errorMessage(json)); return false }
    if (method === 'PATCH') setContracts(json)
    else setContracts(await fetch('/api/finance/cost-contracts', { cache: 'no-store' }).then((r) => r.json()))
    return true
  }

  function act(id: string, body: Record<string, unknown>) {
    return send(`/api/finance/cost-contracts/${id}`, 'PATCH', body)
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const ok = await send('/api/finance/cost-contracts', 'POST', {
      counterparty: form.get('counterparty'),
      description: form.get('description'),
      startMonth: form.get('startMonth'),
      endMonth: form.get('endMonth') || null,
      amount: form.get('amount'),
      jagPercent: Number(form.get('jagPercent')),
      isConfidential: form.get('isConfidential') === 'on',
    })
    if (ok) { formElement.reset(); setAdding(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="data-label">Koszty bez faktury</p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>Umowy kosztowe</h1>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Stałe miesięczne koszty bez faktury VAT, np. najem od osoby prywatnej. Kwota liczy się sama jako koszt stały
            w każdym miesiącu obowiązywania (od kwietnia 2026), bez VAT i składek.
          </p>
        </div>
        <button type="button" onClick={() => setAdding((value) => !value)} className={`inline-flex items-center gap-2 ${primary}`}>
          <Plus size={16} /> Dodaj umowę
        </button>
      </div>

      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {adding && (
        <form onSubmit={create} className="grid gap-3 rounded-lg border border-[var(--wd-border)] bg-white p-4 md:grid-cols-4">
          <label className="grid gap-1 text-xs font-semibold md:col-span-2">Strona umowy<input name="counterparty" required className={input} placeholder="np. Jan Kowalski — wynajmujący" /></label>
          <label className="grid gap-1 text-xs font-semibold md:col-span-2">Czego dotyczy<input name="description" required className={input} placeholder="np. najem placu pod magazyn" /></label>
          <label className="grid gap-1 text-xs font-semibold">Od miesiąca<input name="startMonth" type="month" required className={input} defaultValue="2026-04" /></label>
          <label className="grid gap-1 text-xs font-semibold">Do miesiąca (opcjonalnie)<input name="endMonth" type="month" className={input} /></label>
          <label className="grid gap-1 text-xs font-semibold">Kwota miesięczna (PLN)<input name="amount" inputMode="decimal" required className={input} placeholder="0,00" /></label>
          <label className="grid gap-1 text-xs font-semibold">JAG % (reszta PUL)<input name="jagPercent" type="number" min={0} max={100} step={1} required defaultValue={50} className={input} /></label>
          <label className="inline-flex items-center gap-2 text-sm md:col-span-3">
            <input name="isConfidential" type="checkbox" defaultChecked /> Poufna — MANAGER nie widzi jej w wynikach salonów
          </label>
          <button type="submit" disabled={pending} className={primary}>Zapisz umowę</button>
        </form>
      )}

      <section className="overflow-x-auto rounded-lg border border-[var(--wd-border)] bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide" style={{ color: 'var(--wd-text-muted)' }}>
            <tr>
              <th className="px-4 py-3">Umowa</th>
              <th className="px-4 py-3">Okres</th>
              <th className="px-4 py-3 text-right">Kwota / mies.</th>
              <th className="px-4 py-3">Podział</th>
              <th className="px-4 py-3">Zmiany</th>
            </tr>
          </thead>
          <tbody>
            {contracts === null && <tr><td colSpan={5} className="px-4 py-6 text-center" style={{ color: 'var(--wd-text-muted)' }}>Ładowanie…</td></tr>}
            {contracts?.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center" style={{ color: 'var(--wd-text-muted)' }}>Brak umów kosztowych.</td></tr>}
            {contracts?.map((contract) => (
              <ContractRow key={contract.id} contract={contract} pending={pending} act={(body) => act(contract.id, body)} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function ContractRow({ contract, pending, act }: { contract: Contract; pending: boolean; act: (body: Record<string, unknown>) => Promise<boolean> }) {
  const amount = current(contract.amounts)
  const split = current(contract.splits)
  const [open, setOpen] = useState(false)

  function submit(handler: (form: FormData) => Record<string, unknown>) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const formElement = event.currentTarget
      if (await act(handler(new FormData(formElement)))) formElement.reset()
    }
  }

  return (
    <>
      <tr className="border-t border-[var(--wd-border)] align-top">
        <td className="px-4 py-3">
          <p className="font-semibold">{contract.counterparty}</p>
          <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>{contract.description}{contract.isConfidential ? ' · poufna' : ''}</p>
        </td>
        <td className="num px-4 py-3">{contract.startMonth} → {contract.endMonth ?? 'bezterminowo'}</td>
        <td className="num px-4 py-3 text-right">{amount ? formatGrosze(amount.amountGrosze) : '—'}</td>
        <td className="num px-4 py-3">{split ? `JAG ${split.jagPercent}% · PUL ${100 - split.jagPercent}%` : 'GLOBAL'}</td>
        <td className="px-4 py-3"><button type="button" className={ghost} onClick={() => setOpen((value) => !value)}>{open ? 'Zwiń' : 'Zmień…'}</button></td>
      </tr>
      {open && (
        <tr className="border-t border-dashed border-[var(--wd-border)] bg-[var(--wd-surface-2)]">
          <td colSpan={5} className="space-y-4 px-4 py-4">
            <form className="grid gap-2 md:grid-cols-[1fr_1fr_160px_auto_auto]" onSubmit={submit((form) => ({
              action: 'update',
              counterparty: form.get('counterparty'),
              description: form.get('description'),
              endMonth: form.get('endMonth') || null,
              isConfidential: form.get('isConfidential') === 'on',
            }))}>
              <input name="counterparty" defaultValue={contract.counterparty} className={input} aria-label="Strona umowy" />
              <input name="description" defaultValue={contract.description} className={input} aria-label="Czego dotyczy" />
              <input name="endMonth" type="month" defaultValue={contract.endMonth ?? ''} className={input} aria-label="Do miesiąca" />
              <label className="inline-flex items-center gap-2 text-xs"><input name="isConfidential" type="checkbox" defaultChecked={contract.isConfidential} /> poufna</label>
              <button type="submit" disabled={pending} className={primary}>Zapisz</button>
            </form>

            <div className="grid gap-4 md:grid-cols-2">
              <History
                title="Kwota miesięczna"
                rows={contract.amounts.map((row) => ({ ...row, label: formatGrosze(row.amountGrosze) }))}
                pending={pending}
                onRevoke={(id) => act({ action: 'amount.revoke', amountId: id })}
                form={(
                  <form className="flex flex-wrap gap-2" onSubmit={submit((form) => ({ action: 'amount.add', effectiveFrom: form.get('effectiveFrom'), amount: form.get('amount') }))}>
                    <input name="effectiveFrom" type="month" required className={input} aria-label="Nowa kwota od miesiąca" />
                    <input name="amount" inputMode="decimal" required className={input} placeholder="Nowa kwota" aria-label="Nowa kwota" />
                    <button type="submit" disabled={pending} className={ghost}>Dodaj kwotę</button>
                  </form>
                )}
              />
              <History
                title="Podział JAG / PUL"
                rows={contract.splits.map((row) => ({ ...row, label: `JAG ${row.jagPercent}% · PUL ${100 - row.jagPercent}%` }))}
                pending={pending}
                onRevoke={(id) => act({ action: 'split.revoke', splitId: id })}
                form={(
                  <form className="flex flex-wrap gap-2" onSubmit={submit((form) => ({ action: 'split.add', effectiveFrom: form.get('effectiveFrom'), jagPercent: Number(form.get('jagPercent')) }))}>
                    <input name="effectiveFrom" type="month" required className={input} aria-label="Nowy podział od miesiąca" />
                    <input name="jagPercent" type="number" min={0} max={100} required className={input} placeholder="JAG %" aria-label="JAG %" />
                    <button type="submit" disabled={pending} className={ghost}>Dodaj podział</button>
                  </form>
                )}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function History({ title, rows, pending, onRevoke, form }: {
  title: string
  rows: Array<Row & { label: string }>
  pending: boolean
  onRevoke: (id: string) => void
  form: ReactNode
}) {
  return (
    <div className="space-y-2">
      <p className="data-label">{title}</p>
      <ul className="space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.id} className={`flex items-center gap-3 ${row.revokedAt ? 'line-through opacity-50' : ''}`}>
            <span className="num">od {row.effectiveFrom}</span>
            <span className="num font-semibold">{row.label}</span>
            {!row.revokedAt && <button type="button" disabled={pending} className={ghost} onClick={() => onRevoke(row.id)}>Cofnij</button>}
          </li>
        ))}
      </ul>
      {form}
    </div>
  )
}
