'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  CalendarRange,
  Plus,
  Lock,
  X,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react'
import { formatDuration } from '@/lib/hr/utils'

interface BillingPeriod {
  id: string
  name: string
  startDate: string
  endDate: string
  status: 'open' | 'closed' | 'locked'
  closedAt: string | null
  closedById: string | null
  createdAt: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function dateDiffDays(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime()
  return Math.round(ms / 86400000) + 1
}

// Suppress unused warning — formatDuration is imported for future use
void formatDuration

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: BillingPeriod['status'] }) {
  const cfg = {
    open: { label: 'Otwarty', bg: '#DCFCE7', color: '#166534', dot: '#16A34A' },
    closed: { label: 'Zamknięty', bg: '#F3F4F6', color: '#374151', dot: '#9CA3AF' },
    locked: { label: 'Zablokowany', bg: '#FEF3C7', color: '#92400E', dot: '#F59E0B' },
  }[status]

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  )
}

// ─── Confirm Close Dialog ────────────────────────────────────────────────────

function CloseConfirmDialog({
  period,
  onConfirm,
  onCancel,
  loading,
}: {
  period: BillingPeriod
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div
        className="relative w-full max-w-md rounded-2xl p-6 shadow-2xl"
        style={{ background: '#fff', border: '1px solid var(--wd-border)' }}
      >
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#FEF3C7' }}>
            <AlertTriangle size={20} style={{ color: '#D97706' }} />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-base" style={{ color: 'var(--wd-text-primary)' }}>
              Zamknąć okres?
            </h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>
              Okres <strong style={{ color: 'var(--wd-text-primary)' }}>{period.name}</strong> zostanie
              zamknięty. Tej operacji nie można cofnąć.
            </p>

            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: 'var(--wd-off-white)',
                  color: 'var(--wd-text-primary)',
                  border: '1px solid var(--wd-border)',
                }}
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                style={{
                  background: loading ? '#D1D5DB' : '#1E1E1E',
                  color: '#fff',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Zamykanie…' : 'Zamknij okres'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── New Period Modal ─────────────────────────────────────────────────────────

function NewPeriodModal({
  onCreated,
  onClose,
}: {
  onCreated: (period: BillingPeriod) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-suggest name from date range
  useEffect(() => {
    if (startDate) {
      const d = new Date(startDate)
      const suggested = d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })
      setName(suggested.charAt(0).toUpperCase() + suggested.slice(1))
    }
  }, [startDate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !startDate || !endDate) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/hr/billing-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, startDate, endDate }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Błąd podczas tworzenia okresu')
        return
      }
      onCreated(data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl"
        style={{ background: '#fff', border: '1px solid var(--wd-border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <h2 className="font-bold text-base" style={{ color: 'var(--wd-text-primary)' }}>
            Nowy okres rozliczeniowy
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
          >
            <X size={16} style={{ color: 'var(--wd-text-muted)' }} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{ background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' }}
            >
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--wd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Nazwa
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Styczeń 2026"
              required
              className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
              style={{
                border: '1px solid var(--wd-border)',
                background: 'var(--wd-off-white)',
                color: 'var(--wd-text-primary)',
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--wd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Data od
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  border: '1px solid var(--wd-border)',
                  background: 'var(--wd-off-white)',
                  color: 'var(--wd-text-primary)',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--wd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Data do
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                required
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  border: '1px solid var(--wd-border)',
                  background: 'var(--wd-off-white)',
                  color: 'var(--wd-text-primary)',
                }}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                background: 'var(--wd-off-white)',
                color: 'var(--wd-text-primary)',
                border: '1px solid var(--wd-border)',
              }}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: loading ? '#D1D5DB' : '#1E1E1E',
                color: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Tworzenie…' : 'Utwórz okres'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BillingPeriodsPage() {
  const { data: session, status: sessionStatus } = useSession()
  const router = useRouter()

  const [periods, setPeriods] = useState<BillingPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewModal, setShowNewModal] = useState(false)
  const [closeTarget, setCloseTarget] = useState<BillingPeriod | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Auth guard
  useEffect(() => {
    if (sessionStatus === 'loading') return
    if (!session) { router.replace('/login'); return }
    if (session.user.role !== 'ADMIN') { router.replace('/hr/time-tracking'); return }
  }, [session, sessionStatus, router])

  const fetchPeriods = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/hr/billing-periods')
      if (res.ok) setPeriods(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session?.user.role === 'ADMIN') fetchPeriods()
  }, [session, fetchPeriods])

  async function handleClose() {
    if (!closeTarget) return
    setClosingId(closeTarget.id)
    try {
      const res = await fetch(`/api/hr/billing-periods/${closeTarget.id}/close`, {
        method: 'POST',
      })
      if (res.ok) {
        const updated = await res.json()
        setPeriods((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p))
        )
      }
    } finally {
      setClosingId(null)
      setCloseTarget(null)
    }
  }

  if (sessionStatus === 'loading' || (session?.user.role !== 'ADMIN')) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div
          className="w-7 h-7 rounded-full border-2 animate-spin"
          style={{ borderColor: 'var(--wd-sand)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  const openCount = periods.filter((p) => p.status === 'open').length
  const closedCount = periods.filter((p) => p.status !== 'open').length

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--wd-text-primary)' }}>
            Okresy rozliczeniowe
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
            Zarządzanie cyklami ewidencji czasu pracy
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm hover:opacity-90"
          style={{ background: '#1E1E1E', color: '#fff' }}
        >
          <Plus size={16} />
          Nowy okres
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Łącznie', value: periods.length, accent: '#1E1E1E' },
          { label: 'Otwarte', value: openCount, accent: '#16A34A' },
          { label: 'Zamknięte', value: closedCount, accent: '#9CA3AF' },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl px-5 py-4"
            style={{ background: '#fff', border: '1px solid var(--wd-border)', boxShadow: 'var(--card-shadow)' }}
          >
            <p className="data-label mb-1">{kpi.label}</p>
            <p className="text-3xl font-bold num" style={{ color: kpi.accent }}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Table card */}
      <div
        className="bg-white rounded-xl border border-[var(--wd-border)]"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div
              className="w-6 h-6 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--wd-sand)', borderTopColor: 'transparent' }}
            />
          </div>
        ) : periods.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <CalendarRange size={36} style={{ color: 'var(--wd-text-muted)', opacity: 0.4 }} />
            <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
              Brak zdefiniowanych okresów rozliczeniowych
            </p>
            <button
              type="button"
              onClick={() => setShowNewModal(true)}
              className="mt-1 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: '#1E1E1E', color: '#fff' }}
            >
              Utwórz pierwszy okres
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr
                  className="border-b text-left"
                  style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-off-white)' }}
                >
                  <th className="data-label px-5 py-3 font-semibold rounded-tl-xl">Nazwa</th>
                  <th className="data-label px-5 py-3 font-semibold">Data od</th>
                  <th className="data-label px-5 py-3 font-semibold">Data do</th>
                  <th className="data-label px-5 py-3 font-semibold">Dni</th>
                  <th className="data-label px-5 py-3 font-semibold">Status</th>
                  <th className="data-label px-5 py-3 font-semibold">Zamknięto</th>
                  <th className="data-label px-5 py-3 font-semibold rounded-tr-xl text-right">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--wd-border)' }}>
                {periods.map((period) => {
                  const days = dateDiffDays(period.startDate, period.endDate)
                  const isExpanded = expandedId === period.id

                  return (
                    <tr
                      key={period.id}
                      className="transition-colors hover:bg-[var(--wd-off-white)]"
                      style={{ borderColor: 'var(--wd-border)' }}
                    >
                      <td className="px-5 py-3.5">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : period.id)}
                          className="flex items-center gap-1.5 font-semibold text-sm transition-colors hover:opacity-70"
                          style={{ color: 'var(--wd-text-primary)' }}
                        >
                          <ChevronDown
                            size={14}
                            style={{
                              color: 'var(--wd-text-muted)',
                              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                              transition: 'transform 0.15s',
                            }}
                          />
                          {period.name}
                        </button>
                      </td>
                      <td className="px-5 py-3.5 text-sm num" style={{ color: 'var(--wd-text-primary)' }}>
                        {formatDate(period.startDate)}
                      </td>
                      <td className="px-5 py-3.5 text-sm num" style={{ color: 'var(--wd-text-primary)' }}>
                        {formatDate(period.endDate)}
                      </td>
                      <td className="px-5 py-3.5 text-sm num" style={{ color: 'var(--wd-text-muted)' }}>
                        {days}d
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={period.status} />
                      </td>
                      <td className="px-5 py-3.5 text-sm" style={{ color: 'var(--wd-text-muted)' }}>
                        {period.closedAt ? formatDate(period.closedAt) : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {period.status === 'open' && (
                          <button
                            type="button"
                            onClick={() => setCloseTarget(period)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                            style={{
                              background: '#FEF3C7',
                              color: '#92400E',
                              border: '1px solid #FDE68A',
                            }}
                          >
                            <Lock size={11} />
                            Zamknij
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showNewModal && (
        <NewPeriodModal
          onCreated={(p) => {
            setPeriods((prev) => [p, ...prev])
            setShowNewModal(false)
          }}
          onClose={() => setShowNewModal(false)}
        />
      )}

      {closeTarget && (
        <CloseConfirmDialog
          period={closeTarget}
          onConfirm={handleClose}
          onCancel={() => setCloseTarget(null)}
          loading={closingId === closeTarget.id}
        />
      )}
    </div>
  )
}
