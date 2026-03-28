'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  TrendingUp,
  Plus,
  Check,
  X,
  Clock,
  ChevronDown,
  AlertCircle,
} from 'lucide-react'
import { formatDuration } from '@/lib/hr/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Employee {
  id: string
  firstName: string
  lastName: string
  position: string
}

interface OvertimeRequest {
  id: string
  employeeId: string
  employee: Employee
  date: string
  minutes: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  resolution: 'time_off' | 'payment' | null
  rejectionNote: string | null
  approvedById: string | null
  approvedAt: string | null
  createdAt: string
  updatedAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const RESOLUTION_LABELS: Record<string, string> = {
  time_off: 'Czas wolny',
  payment: 'Wypłata',
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OvertimeRequest['status'] }) {
  const cfg = {
    pending: { label: 'Oczekuje', bg: '#EFF6FF', color: '#1D4ED8', dot: '#3B82F6' },
    approved: { label: 'Zatwierdzony', bg: '#DCFCE7', color: '#166534', dot: '#16A34A' },
    rejected: { label: 'Odrzucony', bg: '#FEE2E2', color: '#991B1B', dot: '#DC2626' },
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

// ─── Approve Modal ────────────────────────────────────────────────────────────

function ApproveModal({
  request,
  onApproved,
  onClose,
}: {
  request: OvertimeRequest
  onApproved: (updated: OvertimeRequest) => void
  onClose: () => void
}) {
  const [resolution, setResolution] = useState<'time_off' | 'payment'>('time_off')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hr/overtime-requests/${request.id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Błąd'); return }
      onApproved(data)
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
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--wd-border)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--wd-text-primary)' }}>
            Zatwierdź nadgodziny
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100">
            <X size={16} style={{ color: 'var(--wd-text-muted)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {error && (
            <div className="rounded-lg px-4 py-3 text-sm" style={{ background: '#FEE2E2', color: '#991B1B' }}>
              {error}
            </div>
          )}

          {/* Summary */}
          <div className="rounded-xl p-4" style={{ background: 'var(--wd-off-white)', border: '1px solid var(--wd-border)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--wd-text-primary)' }}>
              {request.employee.firstName} {request.employee.lastName}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
              {formatDate(request.date)} · {formatDuration(request.minutes)}
            </p>
            <p className="text-sm mt-2" style={{ color: 'var(--wd-text-muted)' }}>
              {request.reason}
            </p>
          </div>

          {/* Resolution choice */}
          <div>
            <p className="text-xs font-semibold mb-2.5 uppercase tracking-wider" style={{ color: 'var(--wd-text-muted)' }}>
              Rozliczenie
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(['time_off', 'payment'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setResolution(opt)}
                  className="flex flex-col items-center gap-2 rounded-xl p-4 text-sm font-semibold transition-all"
                  style={
                    resolution === opt
                      ? { background: '#1E1E1E', color: '#fff', border: '2px solid #1E1E1E' }
                      : { background: 'var(--wd-off-white)', color: 'var(--wd-text-primary)', border: '2px solid var(--wd-border)' }
                  }
                >
                  {opt === 'time_off' ? <Clock size={20} /> : <TrendingUp size={20} />}
                  {RESOLUTION_LABELS[opt]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--wd-off-white)', color: 'var(--wd-text-primary)', border: '1px solid var(--wd-border)' }}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{ background: loading ? '#D1D5DB' : '#16A34A', color: '#fff' }}
            >
              {loading ? 'Zatwierdzanie…' : 'Zatwierdź'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Reject Modal ─────────────────────────────────────────────────────────────

function RejectModal({
  request,
  onRejected,
  onClose,
}: {
  request: OvertimeRequest
  onRejected: (updated: OvertimeRequest) => void
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hr/overtime-requests/${request.id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionNote: note }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Błąd'); return }
      onRejected(data)
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
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--wd-border)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--wd-text-primary)' }}>
            Odrzuć wniosek
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100">
            <X size={16} style={{ color: 'var(--wd-text-muted)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="rounded-lg px-4 py-3 text-sm" style={{ background: '#FEE2E2', color: '#991B1B' }}>
              {error}
            </div>
          )}

          <div className="rounded-xl p-4" style={{ background: 'var(--wd-off-white)', border: '1px solid var(--wd-border)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--wd-text-primary)' }}>
              {request.employee.firstName} {request.employee.lastName}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
              {formatDate(request.date)} · {formatDuration(request.minutes)}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--wd-text-muted)' }}>
              Powód odrzucenia (opcjonalnie)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Podaj powód odrzucenia…"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
              style={{ border: '1px solid var(--wd-border)', background: 'var(--wd-off-white)', color: 'var(--wd-text-primary)' }}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--wd-off-white)', color: 'var(--wd-text-primary)', border: '1px solid var(--wd-border)' }}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{ background: loading ? '#D1D5DB' : '#DC2626', color: '#fff' }}
            >
              {loading ? 'Odrzucanie…' : 'Odrzuć'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── New Request Modal ────────────────────────────────────────────────────────

const MINUTE_PRESETS = [
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '2h', value: 120 },
  { label: '4h', value: 240 },
]

function NewRequestModal({
  employeeId,
  onCreated,
  onClose,
}: {
  employeeId: string
  onCreated: (req: OvertimeRequest) => void
  onClose: () => void
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [minutes, setMinutes] = useState<number>(60)
  const [customMinutes, setCustomMinutes] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveMinutes = isCustom ? parseInt(customMinutes) || 0 : minutes

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (effectiveMinutes < 1) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/hr/overtime-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, date, minutes: effectiveMinutes, reason }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Błąd'); return }
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
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--wd-border)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--wd-text-primary)' }}>
            Złóż wniosek o nadgodziny
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100">
            <X size={16} style={{ color: 'var(--wd-text-muted)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {error && (
            <div className="rounded-lg px-4 py-3 text-sm flex items-center gap-2" style={{ background: '#FEE2E2', color: '#991B1B' }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--wd-text-muted)' }}>
              Data
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ border: '1px solid var(--wd-border)', background: 'var(--wd-off-white)', color: 'var(--wd-text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--wd-text-muted)' }}>
              Liczba minut
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {MINUTE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => { setMinutes(preset.value); setIsCustom(false) }}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                  style={
                    !isCustom && minutes === preset.value
                      ? { background: '#1E1E1E', color: '#fff', border: '2px solid #1E1E1E' }
                      : { background: 'var(--wd-off-white)', color: 'var(--wd-text-primary)', border: '2px solid var(--wd-border)' }
                  }
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIsCustom(true)}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                style={
                  isCustom
                    ? { background: '#1E1E1E', color: '#fff', border: '2px solid #1E1E1E' }
                    : { background: 'var(--wd-off-white)', color: 'var(--wd-text-primary)', border: '2px solid var(--wd-border)' }
                }
              >
                Inne
              </button>
            </div>
            {isCustom && (
              <input
                type="number"
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
                min={1}
                max={720}
                placeholder="Minuty (np. 45)"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ border: '1px solid var(--wd-border)', background: 'var(--wd-off-white)', color: 'var(--wd-text-primary)' }}
              />
            )}
            {effectiveMinutes > 0 && (
              <p className="text-xs mt-1.5" style={{ color: 'var(--wd-text-muted)' }}>
                = {formatDuration(effectiveMinutes)}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--wd-text-muted)' }}>
              Powód
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              placeholder="Opisz powód nadgodzin…"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
              style={{ border: '1px solid var(--wd-border)', background: 'var(--wd-off-white)', color: 'var(--wd-text-primary)' }}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--wd-off-white)', color: 'var(--wd-text-primary)', border: '1px solid var(--wd-border)' }}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading || effectiveMinutes < 1}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{ background: loading ? '#D1D5DB' : '#1E1E1E', color: '#fff' }}
            >
              {loading ? 'Wysyłanie…' : 'Złóż wniosek'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

function FilterBar({
  statusFilter,
  onStatusChange,
  monthFilter,
  onMonthChange,
}: {
  statusFilter: string
  onStatusChange: (v: string) => void
  monthFilter: string
  onMonthChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className="appearance-none px-3 pr-8 py-2 rounded-lg text-sm font-medium outline-none transition-colors"
          style={{ background: '#fff', border: '1px solid var(--wd-border)', color: 'var(--wd-text-primary)' }}
        >
          <option value="">Wszystkie statusy</option>
          <option value="pending">Oczekujące</option>
          <option value="approved">Zatwierdzone</option>
          <option value="rejected">Odrzucone</option>
        </select>
        <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--wd-text-muted)' }} />
      </div>

      <input
        type="month"
        value={monthFilter}
        onChange={(e) => onMonthChange(e.target.value)}
        className="px-3 py-2 rounded-lg text-sm outline-none"
        style={{ background: '#fff', border: '1px solid var(--wd-border)', color: 'var(--wd-text-primary)' }}
      />

      {(statusFilter || monthFilter) && (
        <button
          type="button"
          onClick={() => { onStatusChange(''); onMonthChange('') }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: 'var(--wd-off-white)', color: 'var(--wd-text-muted)', border: '1px solid var(--wd-border)' }}
        >
          <X size={12} />
          Wyczyść
        </button>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OvertimePage() {
  const { data: session, status: sessionStatus } = useSession()
  const router = useRouter()

  const [requests, setRequests] = useState<OvertimeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [showNewModal, setShowNewModal] = useState(false)
  const [approveTarget, setApproveTarget] = useState<OvertimeRequest | null>(null)
  const [rejectTarget, setRejectTarget] = useState<OvertimeRequest | null>(null)

  useEffect(() => {
    if (sessionStatus === 'loading') return
    if (!session) router.replace('/login')
  }, [session, sessionStatus, router])

  const isAdminOrManager = session?.user.role === 'ADMIN' || session?.user.role === 'MANAGER'

  const fetchRequests = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (monthFilter) params.set('month', monthFilter)
      const res = await fetch(`/api/hr/overtime-requests?${params}`)
      if (res.ok) setRequests(await res.json())
    } finally {
      setLoading(false)
    }
  }, [session, statusFilter, monthFilter])

  useEffect(() => {
    fetchRequests()
  }, [fetchRequests])

  function updateRequest(updated: OvertimeRequest) {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
  }

  const pendingCount = requests.filter((r) => r.status === 'pending').length
  const approvedCount = requests.filter((r) => r.status === 'approved').length
  const rejectedCount = requests.filter((r) => r.status === 'rejected').length

  if (sessionStatus === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--wd-sand)', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--wd-text-primary)' }}>
            Nadgodziny
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
            {isAdminOrManager
              ? 'Wnioski nadgodzinowe wszystkich pracowników'
              : 'Twoje wnioski nadgodzinowe'}
          </p>
        </div>
        {!isAdminOrManager && (
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm hover:opacity-90"
            style={{ background: '#1E1E1E', color: '#fff' }}
          >
            <Plus size={16} />
            Złóż wniosek
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Oczekuje', value: pendingCount, color: '#3B82F6' },
          { label: 'Zatwierdzono', value: approvedCount, color: '#16A34A' },
          { label: 'Odrzucono', value: rejectedCount, color: '#DC2626' },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl px-5 py-4"
            style={{ background: '#fff', border: '1px solid var(--wd-border)', boxShadow: 'var(--card-shadow)' }}
          >
            <p className="data-label mb-1">{kpi.label}</p>
            <p className="text-3xl font-bold num" style={{ color: kpi.color }}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <FilterBar
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          monthFilter={monthFilter}
          onMonthChange={setMonthFilter}
        />
        {isAdminOrManager && (
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: '#1E1E1E', color: '#fff' }}
          >
            <Plus size={15} />
            Nowy wniosek
          </button>
        )}
      </div>

      {/* Table card */}
      <div
        className="bg-white rounded-xl border border-[var(--wd-border)]"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--wd-sand)', borderTopColor: 'transparent' }} />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <TrendingUp size={36} style={{ color: 'var(--wd-text-muted)', opacity: 0.35 }} />
            <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
              Brak wniosków nadgodzinowych
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr
                  className="border-b text-left"
                  style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-off-white)' }}
                >
                  {isAdminOrManager && (
                    <th className="data-label px-5 py-3 font-semibold rounded-tl-xl">Pracownik</th>
                  )}
                  <th className={`data-label px-5 py-3 font-semibold ${!isAdminOrManager ? 'rounded-tl-xl' : ''}`}>Data</th>
                  <th className="data-label px-5 py-3 font-semibold">Czas</th>
                  <th className="data-label px-5 py-3 font-semibold">Powód</th>
                  <th className="data-label px-5 py-3 font-semibold">Status</th>
                  <th className="data-label px-5 py-3 font-semibold">Rozliczenie</th>
                  <th className="data-label px-5 py-3 font-semibold rounded-tr-xl text-right">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--wd-border)' }}>
                {requests.map((req) => (
                  <tr
                    key={req.id}
                    className="transition-colors hover:bg-[var(--wd-off-white)]"
                  >
                    {isAdminOrManager && (
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold" style={{ color: 'var(--wd-text-primary)' }}>
                          {req.employee.firstName} {req.employee.lastName}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                          {req.employee.position}
                        </p>
                      </td>
                    )}
                    <td className="px-5 py-3.5 text-sm num" style={{ color: 'var(--wd-text-primary)' }}>
                      {formatDate(req.date)}
                    </td>
                    <td className="px-5 py-3.5 text-sm num font-semibold" style={{ color: 'var(--wd-text-primary)' }}>
                      {formatDuration(req.minutes)}
                    </td>
                    <td className="px-5 py-3.5 max-w-xs">
                      <p className="text-sm truncate" style={{ color: 'var(--wd-text-muted)' }}>
                        {req.reason}
                      </p>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="px-5 py-3.5 text-sm" style={{ color: 'var(--wd-text-muted)' }}>
                      {req.resolution ? RESOLUTION_LABELS[req.resolution] : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {isAdminOrManager && req.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              onClick={() => setApproveTarget(req)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                              style={{ background: '#DCFCE7', color: '#166534', border: '1px solid #BBF7D0' }}
                            >
                              <Check size={12} />
                              Zatwierdź
                            </button>
                            <button
                              type="button"
                              onClick={() => setRejectTarget(req)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                              style={{ background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' }}
                            >
                              <X size={12} />
                              Odrzuć
                            </button>
                          </>
                        )}
                        {req.rejectionNote && (
                          <span
                            className="text-xs px-2 py-1 rounded"
                            style={{ background: '#FEF3C7', color: '#92400E' }}
                            title={req.rejectionNote}
                          >
                            Uwaga
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showNewModal && session?.user.employeeId && (
        <NewRequestModal
          employeeId={session.user.employeeId}
          onCreated={(req) => {
            setRequests((prev) => [req, ...prev])
            setShowNewModal(false)
          }}
          onClose={() => setShowNewModal(false)}
        />
      )}

      {approveTarget && (
        <ApproveModal
          request={approveTarget}
          onApproved={(updated) => {
            updateRequest(updated)
            setApproveTarget(null)
          }}
          onClose={() => setApproveTarget(null)}
        />
      )}

      {rejectTarget && (
        <RejectModal
          request={rejectTarget}
          onRejected={(updated) => {
            updateRequest(updated)
            setRejectTarget(null)
          }}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </div>
  )
}
