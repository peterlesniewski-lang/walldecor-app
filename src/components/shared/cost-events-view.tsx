'use client'

import { useState } from 'react'
import { Plus, Search } from 'lucide-react'

interface CostEventsViewProps {
  role: string
  initialEvents: CostEventRow[]
  initialTotalGrossAmount: number
  costCenters: Array<{ id: string; name: string }>
  costTagGroups: Array<{ id: string; name: string; tags: Array<{ id: string; name: string; slug: string }> }>
}

interface CostEventRow {
  id: string
  source: string
  eventDate: string
  supplierName: string | null
  supplierNip: string | null
  reference: string | null
  grossAmount: number
  isConfidential: boolean
  parts: Array<{
    tags: Array<{ tag: { id: string; name: string; slug: string } }>
    allocations: Array<{ costCenterId: string; percent: number }>
  }>
}

function money(value: number) {
  return `${Math.round(value * 100) / 100}`.replace('.', ',') + ' PLN'
}

export function CostEventsView({ role, initialEvents, initialTotalGrossAmount, costCenters, costTagGroups }: CostEventsViewProps) {
  const [events, setEvents] = useState(initialEvents)
  const [total, setTotal] = useState(initialTotalGrossAmount)
  const [filters, setFilters] = useState({ search: '', costCenterId: '', tagId: '', source: '' })
  const [manualOpen, setManualOpen] = useState(false)
  const [form, setForm] = useState({
    eventDate: new Date().toISOString().slice(0, 10),
    supplierName: '',
    supplierNip: '',
    reference: '',
    grossAmount: '',
    costCenterId: 'GLOBAL',
    tagIds: [] as string[],
    isConfidential: false,
  })

  async function refresh(nextFilters = filters) {
    const params = new URLSearchParams()
    if (nextFilters.search) params.set('search', nextFilters.search)
    if (nextFilters.costCenterId) params.set('costCenterId', nextFilters.costCenterId)
    if (nextFilters.tagId) params.set('tagId', nextFilters.tagId)
    if (nextFilters.source) params.set('source', nextFilters.source)
    const response = await fetch(`/api/finance/cost-events?${params.toString()}`)
    const data = await response.json()
    setEvents(data.events ?? [])
    setTotal(data.totalGrossAmount ?? 0)
  }

  async function addManualCost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await fetch('/api/finance/cost-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setManualOpen(false)
    await refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="data-label">Koszty zatwierdzone</p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>Ledger kosztów</h1>
        </div>
        {role === 'ADMIN' && (
          <button type="button" onClick={() => setManualOpen((value) => !value)} className="inline-flex items-center gap-2 rounded bg-[var(--wd-dark)] px-3 py-2 text-sm font-semibold text-white">
            <Plus size={16} />
            Dodaj koszt ręczny
          </button>
        )}
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void refresh() }} className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
        <div className="grid gap-2 md:grid-cols-[1fr_180px_180px_140px_auto]">
          <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" placeholder="Dostawca, NIP, numer" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          <select className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" value={filters.costCenterId} onChange={(event) => setFilters({ ...filters, costCenterId: event.target.value })}>
            <option value="">Wszystkie salony</option>
            {costCenters.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
          </select>
          <select className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" value={filters.tagId} onChange={(event) => setFilters({ ...filters, tagId: event.target.value })}>
            <option value="">Wszystkie tagi</option>
            {costTagGroups.flatMap((group) => group.tags.map((tag) => <option key={tag.id} value={tag.id}>{group.name} / {tag.name}</option>))}
          </select>
          <select className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}>
            <option value="">Źródło</option>
            <option value="KSEF">KSeF</option>
            <option value="MANUAL">Ręczne</option>
          </select>
          <button type="submit" className="inline-flex items-center justify-center gap-2 rounded bg-[var(--wd-dark)] px-3 py-2 text-sm font-semibold text-white">
            <Search size={15} />
            Filtruj
          </button>
        </div>
      </form>

      {manualOpen && role === 'ADMIN' && (
        <form onSubmit={addManualCost} className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <div className="grid gap-2 md:grid-cols-4">
            <input type="date" className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" value={form.eventDate} onChange={(event) => setForm({ ...form, eventDate: event.target.value })} />
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" placeholder="Dostawca / źródło" value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} />
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" placeholder="Nr / referencja" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" inputMode="decimal" placeholder="Brutto PLN" value={form.grossAmount} onChange={(event) => setForm({ ...form, grossAmount: event.target.value })} />
            <select className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" value={form.costCenterId} onChange={(event) => setForm({ ...form, costCenterId: event.target.value })}>
              {costCenters.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
            </select>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isConfidential} onChange={(event) => setForm({ ...form, isConfidential: event.target.checked })} />
              Poufne
            </label>
            <button type="submit" className="rounded bg-[var(--wd-dark)] px-3 py-2 text-sm font-semibold text-white">Zapisz koszt</button>
          </div>
        </form>
      )}

      <section className="overflow-hidden rounded-lg border border-[var(--wd-border)] bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide" style={{ color: 'var(--wd-text-muted)' }}>
            <tr>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Dostawca / źródło</th>
              <th className="px-4 py-3">Referencja</th>
              <th className="px-4 py-3">Tagi</th>
              <th className="px-4 py-3">Alokacje</th>
              <th className="px-4 py-3 text-right">Kwota</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--wd-border)]">
            {events.map((event) => (
              <tr key={event.id}>
                <td className="px-4 py-3 num">{event.eventDate.slice(0, 10)}</td>
                <td className="px-4 py-3">{event.supplierName || event.source}</td>
                <td className="px-4 py-3">{event.reference || '-'}</td>
                <td className="px-4 py-3">{event.parts.flatMap((part) => part.tags.map((tag) => tag.tag.name)).join(', ') || '-'}</td>
                <td className="px-4 py-3">{event.parts.flatMap((part) => part.allocations.map((allocation) => `${allocation.costCenterId} ${allocation.percent}%`)).join(', ') || '-'}</td>
                <td className="px-4 py-3 text-right num font-semibold">{money(event.grossAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-[var(--wd-border)] px-4 py-3">
          <p className="data-label">Suma aktywnego filtra</p>
          <p className="num text-sm font-semibold">{money(total)}</p>
        </div>
      </section>
    </div>
  )
}
