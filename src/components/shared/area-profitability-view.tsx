'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { Plus, Save } from 'lucide-react'
import type { AreaProfitabilityReport } from '@/lib/finance/area-profitability'

const MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']

interface AreaTagOption {
  id: string
  slug: string
  name: string
  active: boolean
}

interface AreaRevenueEntry {
  year: number
  month: number
  costCenterId: string
  areaTagId: string
  amount: number
}

interface AreaProfitabilityViewProps {
  year: number
  selectedCostCenterId: 'COMPANY' | 'JAG' | 'PUL'
  role: string
  report: AreaProfitabilityReport
  areaTags: AreaTagOption[]
  costCenters: Array<{ id: string; name: string }>
  revenueEntries: AreaRevenueEntry[]
}

function money(value: number) {
  return `${Math.round(value).toLocaleString('pl-PL')} PLN`
}

function rate(value: number | null) {
  return value == null ? '-' : `${(value * 100).toFixed(1).replace('.', ',')}%`
}

function resultClass(value: number) {
  if (value > 0) return 'text-green-700'
  if (value < 0) return 'text-red-600'
  return 'text-gray-500'
}

function revenueKey(areaTagId: string, month: number) {
  return `${areaTagId}:${month}`
}

function costCenterLabel(costCenters: Array<{ id: string; name: string }>, id: 'JAG' | 'PUL') {
  return costCenters.find((center) => center.id === id)?.name ?? id
}

export function AreaProfitabilityView({
  year,
  selectedCostCenterId,
  role,
  report,
  areaTags,
  costCenters,
  revenueEntries,
}: AreaProfitabilityViewProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const isAdmin = role === 'ADMIN'
  const canEdit = isAdmin && selectedCostCenterId !== 'COMPANY'
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [newAreaName, setNewAreaName] = useState('')
  const [managedAreas, setManagedAreas] = useState(areaTags)
  const [areaSavingId, setAreaSavingId] = useState<string | null>(null)
  const [entries, setEntries] = useState(() => {
    const values: Record<string, string> = {}
    for (const entry of revenueEntries) {
      if (entry.costCenterId === selectedCostCenterId) {
        values[revenueKey(entry.areaTagId, entry.month)] = String(entry.amount)
      }
    }
    return values
  })

  const costCenterTabs = useMemo(() => [
    { id: 'COMPANY', name: 'Firma' },
    { id: 'JAG', name: costCenterLabel(costCenters, 'JAG') },
    { id: 'PUL', name: costCenterLabel(costCenters, 'PUL') },
  ] as const, [costCenters])

  async function saveRevenue(areaTagId: string, month: number) {
    if (!canEdit) return
    const key = revenueKey(areaTagId, month)
    setPendingKey(key)
    const amount = Number((entries[key] ?? '0').replace(',', '.')) || 0
    const response = await fetch('/api/finance/area-revenue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month, costCenterId: selectedCostCenterId, areaTagId, amount }),
    })
    setPendingKey(null)
    if (response.ok) {
      startTransition(() => router.refresh())
    }
  }

  async function addArea(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newAreaName.trim()
    if (!name) return

    setAreaSavingId('new')
    const response = await fetch('/api/finance/area-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setAreaSavingId(null)
    if (!response.ok) return

    const data = await response.json() as { tag?: AreaTagOption }
    if (data.tag) setManagedAreas((current) => [...current, data.tag!])
    setNewAreaName('')
    startTransition(() => router.refresh())
  }

  async function updateArea(area: AreaTagOption, data: Partial<Pick<AreaTagOption, 'name' | 'active'>>) {
    setAreaSavingId(area.id)
    const response = await fetch(`/api/finance/area-tags/${area.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    setAreaSavingId(null)
    if (!response.ok) return

    const result = await response.json() as { tag?: AreaTagOption }
    if (result.tag) {
      setManagedAreas((current) => current.map((item) => item.id === result.tag!.id ? result.tag! : item))
    }
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="data-label mb-1">Rentowność linii</p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>Obszary produktowe</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Przychody per obszar zestawione z kosztami z tagów faktur.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/finance/areas?year=${year - 1}&costCenterId=${selectedCostCenterId}`} className="rounded p-1.5 text-sm hover:bg-gray-100">‹</Link>
          <span className="px-2 text-sm font-semibold">{year}</span>
          <Link href={`/finance/areas?year=${year + 1}&costCenterId=${selectedCostCenterId}`} className="rounded p-1.5 text-sm hover:bg-gray-100">›</Link>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2">
        {costCenterTabs.map((tab) => (
          <Link
            key={tab.id}
            href={`/finance/areas?year=${year}&costCenterId=${tab.id}`}
            className={`rounded border px-3 py-1.5 text-sm font-semibold ${
              selectedCostCenterId === tab.id ? 'border-[#D7C8B5] bg-white' : 'border-[var(--wd-border)] bg-transparent'
            }`}
          >
            {tab.name}
          </Link>
        ))}
      </nav>

      {isAdmin && (
        <section className="rounded-lg border border-[var(--wd-border)] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--wd-border)] px-4 py-3">
            <div>
              <p className="data-label">Zarządzanie obszarami</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--wd-dark)' }}>Tagi osi Obszar</p>
            </div>
            <form onSubmit={addArea} className="flex min-w-[280px] items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded border border-[var(--wd-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D7C8B5]"
                placeholder="Nowy obszar"
                value={newAreaName}
                onChange={(event) => setNewAreaName(event.target.value)}
                disabled={areaSavingId === 'new'}
              />
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded bg-[var(--wd-dark)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={areaSavingId === 'new' || !newAreaName.trim()}
              >
                <Plus size={15} />
                Dodaj obszar
              </button>
            </form>
          </div>
          <div className="divide-y divide-[var(--wd-border)]">
            {managedAreas.map((area) => (
              <div key={area.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_92px_120px_120px] md:items-center">
                <input
                  className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D7C8B5]"
                  value={area.name}
                  disabled={areaSavingId === area.id}
                  onChange={(event) => {
                    const name = event.target.value
                    setManagedAreas((current) => current.map((item) => item.id === area.id ? { ...item, name } : item))
                  }}
                />
                <button
                  type="button"
                  className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
                  disabled={areaSavingId === area.id}
                  onClick={() => {
                    const name = managedAreas.find((item) => item.id === area.id)?.name.trim()
                    if (name) void updateArea(area, { name })
                  }}
                >
                  Zapisz
                </button>
                <span className={`rounded-full border px-2 py-1 text-center text-xs font-semibold ${area.active ? 'border-green-100 bg-green-50 text-green-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                  {area.active ? 'Aktywny' : 'Ukryty'}
                </span>
                <button
                  type="button"
                  className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
                  disabled={areaSavingId === area.id}
                  onClick={() => { void updateArea(area, { active: !area.active }) }}
                >
                  {area.active ? 'Ukryj' : 'Aktywuj'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <p className="data-label">Przychód</p>
          <p className="num mt-2 text-xl font-bold">{money(report.totals.revenue)}</p>
        </div>
        <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <p className="data-label">Koszt</p>
          <p className="num mt-2 text-xl font-bold">{money(report.totals.costs)}</p>
        </div>
        <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <p className="data-label">Marża</p>
          <p className={`num mt-2 text-xl font-bold ${resultClass(report.totals.margin)}`}>{money(report.totals.margin)}</p>
        </div>
        <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <p className="data-label">Koszt bez obszaru</p>
          <p className="num mt-2 text-xl font-bold text-amber-700">{money(report.unassignedCosts)}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--wd-border)] bg-white">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide" style={{ color: 'var(--wd-text-muted)' }}>
            <tr>
              <th className="px-4 py-3">Obszar</th>
              <th className="px-4 py-3 text-right">Przychód</th>
              <th className="px-4 py-3 text-right">Koszt</th>
              <th className="px-4 py-3 text-right">Marża</th>
              <th className="px-4 py-3 text-right">%</th>
              <th className="px-4 py-3">JAG</th>
              <th className="px-4 py-3">PUL</th>
              <th className="px-4 py-3">GLOBAL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--wd-border)]">
            {report.rows.map((row) => (
              <tr key={row.areaTagId}>
                <td className="px-4 py-3 font-semibold">{row.name}</td>
                <td className="px-4 py-3 text-right num">{money(row.revenue)}</td>
                <td className="px-4 py-3 text-right num">{money(row.costs)}</td>
                <td className={`px-4 py-3 text-right num font-semibold ${resultClass(row.margin)}`}>{money(row.margin)}</td>
                <td className={`px-4 py-3 text-right num font-semibold ${resultClass(row.margin)}`}>{rate(row.marginRate)}</td>
                {(['JAG', 'PUL', 'GLOBAL'] as const).map((center) => (
                  <td key={center} className="px-4 py-3 text-xs">
                    <span className="num">P {money(row.byCostCenter[center].revenue)}</span>
                    <span className="mx-1" style={{ color: 'var(--wd-text-muted)' }}>/</span>
                    <span className="num">K {money(row.byCostCenter[center].costs)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--wd-border)] bg-white">
        <div className="flex items-center justify-between border-b border-[var(--wd-border)] px-4 py-3">
          <div>
            <p className="data-label">Przychód miesięczny</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--wd-dark)' }}>
              {selectedCostCenterId === 'COMPANY' ? 'Firma' : costCenterLabel(costCenters, selectedCostCenterId)}
            </p>
          </div>
          {isPending && <Save size={16} className="text-green-700" />}
        </div>
        {selectedCostCenterId === 'COMPANY' ? (
          <div className="px-4 py-5 text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Wybierz JAG albo PUL, żeby edytować przychód per obszar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide" style={{ color: 'var(--wd-text-muted)' }}>
                <tr>
                  <th className="px-4 py-3 text-left">Obszar</th>
                  {MONTHS.map((month) => <th key={month} className="px-2 py-3 text-right">{month}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--wd-border)]">
                {areaTags.filter((tag) => tag.active).map((tag) => (
                  <tr key={tag.id}>
                    <td className="px-4 py-3 font-semibold">{tag.name}</td>
                    {MONTHS.map((_, index) => {
                      const month = index + 1
                      const key = revenueKey(tag.id, month)
                      return (
                        <td key={key} className="px-2 py-2">
                          <input
                            aria-label={`${tag.name} ${month}`}
                            className="w-24 rounded border border-[var(--wd-border)] px-2 py-1.5 text-right text-sm num focus:outline-none focus:ring-2 focus:ring-[#D7C8B5]"
                            inputMode="decimal"
                            disabled={!canEdit || pendingKey === key}
                            value={entries[key] ?? ''}
                            onChange={(event) => {
                              setEntries((current) => ({ ...current, [key]: event.target.value }))
                            }}
                            onBlur={() => { void saveRevenue(tag.id, month) }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
