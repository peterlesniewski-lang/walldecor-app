'use client'

import { useState, useCallback, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  Check,
  X,
  Loader2,
  CalendarDays,
  ChevronRight,
  AlertCircle,
  Download,
  Filter,
  PartyPopper,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeaveRequestItem {
  id: string
  employeeId: string
  leaveTypeId: string
  startDate: string
  endDate: string
  days: number
  hours: number | null
  status: string
  note: string | null
  rejectionNote: string | null
  approverId: string | null
  approvedAt: string | null
  createdAt: string
  isOnDemand: boolean
  isRemoteWork: boolean
  isDelegation: boolean
  employee: {
    id: string
    firstName: string
    lastName: string
    division: { id: string; name: string } | null
  }
  leaveType: {
    id: string
    name: string
    color: string
    code: string
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
    approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    rejected: 'bg-red-100 text-red-700 border-red-200',
    cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
  }

  const labels: Record<string, string> = {
    pending: 'Oczekujący',
    approved: 'Zatwierdzony',
    rejected: 'Odrzucony',
    cancelled: 'Anulowany',
  }

  const cls = variants[status] ?? 'bg-gray-100 text-gray-500 border-gray-200'

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full border ${cls}`}
    >
      {status === 'pending' && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
      )}
      {status === 'approved' && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      )}
      {status === 'rejected' && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      )}
      {status === 'cancelled' && (
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      )}
      {labels[status] ?? status}
    </span>
  )
}

// ─── Rejection Modal ──────────────────────────────────────────────────────────

function RejectionModal({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (note: string) => void
  loading: boolean
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!note.trim()) {
      setError('Powód odrzucenia jest wymagany')
      return
    }
    setError('')
    onConfirm(note.trim())
  }

  const handleClose = () => {
    setNote('')
    setError('')
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div
        className="relative w-full max-w-sm rounded-xl shadow-2xl"
        style={{ background: 'var(--wd-white)', border: '1px solid var(--wd-border)' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-red-500" />
            <h2 className="font-semibold text-[var(--wd-text-primary)]">Odrzuć wniosek</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-[var(--wd-surface-2)] text-[var(--wd-text-muted)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5 uppercase tracking-wide">
              Powód odrzucenia <span className="text-red-500">*</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              autoFocus
              placeholder="Podaj powód odrzucenia wniosku..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] placeholder:text-[var(--wd-text-muted)] focus:outline-none focus:ring-2 focus:ring-red-300 resize-none transition"
            />
            {error && (
              <p className="mt-1 text-xs text-red-600">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--wd-border)] text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)] disabled:opacity-50 transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading || !note.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Odrzuć wniosek
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Detail Sheet ─────────────────────────────────────────────────────────────

function DetailSheet({
  request,
  open,
  onClose,
  onApprove,
  onReject,
}: {
  request: LeaveRequestItem | null
  open: boolean
  onClose: () => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  if (!request) return null

  const durationLabel = request.hours
    ? `${request.days} dni (${request.hours} h)`
    : `${request.days} dni`

  const tags = [
    request.isOnDemand && 'Na żądanie',
    request.isRemoteWork && 'Praca zdalna',
    request.isDelegation && 'Delegacja',
  ].filter((t): t is string => Boolean(t))

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ background: 'var(--wd-white)', borderLeft: '1px solid var(--wd-border)' }}
      >
        {/* Panel header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <h2 className="font-semibold text-[var(--wd-text-primary)]">Szczegóły wniosku</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--wd-surface-2)] text-[var(--wd-text-muted)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Employee */}
          <div className="pb-5 border-b" style={{ borderColor: 'var(--wd-border)' }}>
            <p className="text-xs font-medium text-[var(--wd-text-muted)] uppercase tracking-wide mb-2">
              Pracownik
            </p>
            <p className="text-base font-semibold text-[var(--wd-text-primary)]">
              {request.employee.firstName} {request.employee.lastName}
            </p>
            {request.employee.division && (
              <p className="text-xs text-[var(--wd-text-muted)] mt-0.5">
                {request.employee.division.name}
              </p>
            )}
          </div>

          {/* Leave type */}
          <div className="pb-5 border-b" style={{ borderColor: 'var(--wd-border)' }}>
            <p className="text-xs font-medium text-[var(--wd-text-muted)] uppercase tracking-wide mb-2">
              Typ urlopu
            </p>
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: request.leaveType.color }}
              />
              <span className="font-medium text-[var(--wd-text-primary)]">
                {request.leaveType.name}
              </span>
              <span className="font-mono text-[10px] text-[var(--wd-text-muted)] uppercase bg-[var(--wd-surface-2)] px-1.5 py-0.5 rounded">
                {request.leaveType.code}
              </span>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-[var(--wd-surface-2)] text-[var(--wd-text-muted)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="pb-5 border-b" style={{ borderColor: 'var(--wd-border)' }}>
            <p className="text-xs font-medium text-[var(--wd-text-muted)] uppercase tracking-wide mb-2">
              Termin
            </p>
            <div className="flex items-center gap-3">
              <div className="text-center">
                <p className="text-xs text-[var(--wd-text-muted)]">Od</p>
                <p className="font-semibold text-[var(--wd-text-primary)]">
                  {formatDate(request.startDate)}
                </p>
              </div>
              <ChevronRight size={16} className="text-[var(--wd-text-muted)] shrink-0" />
              <div className="text-center">
                <p className="text-xs text-[var(--wd-text-muted)]">Do</p>
                <p className="font-semibold text-[var(--wd-text-primary)]">
                  {formatDate(request.endDate)}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-[var(--wd-text-muted)]">Czas</p>
                <p className="font-semibold text-[var(--wd-text-primary)]">{durationLabel}</p>
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="pb-5 border-b" style={{ borderColor: 'var(--wd-border)' }}>
            <p className="text-xs font-medium text-[var(--wd-text-muted)] uppercase tracking-wide mb-2">
              Status
            </p>
            <StatusBadge status={request.status} />
            {request.approvedAt && (
              <p className="text-xs text-[var(--wd-text-muted)] mt-1.5">
                Zatwierdzone: {formatDate(request.approvedAt)}
              </p>
            )}
            {request.rejectionNote && (
              <div className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-700">
                  <span className="font-medium">Powód odrzucenia:</span> {request.rejectionNote}
                </p>
              </div>
            )}
          </div>

          {/* Note */}
          {request.note && (
            <div className="pb-5 border-b" style={{ borderColor: 'var(--wd-border)' }}>
              <p className="text-xs font-medium text-[var(--wd-text-muted)] uppercase tracking-wide mb-2">
                Notatka pracownika
              </p>
              <p className="text-sm text-[var(--wd-text-primary)]">{request.note}</p>
            </div>
          )}

          {/* Submission date */}
          <p className="text-xs text-[var(--wd-text-muted)]">
            Złożono: {formatDate(request.createdAt)}
          </p>
        </div>

        {/* Actions footer */}
        {request.status === 'pending' && (
          <div
            className="px-6 py-4 border-t shrink-0 flex gap-3"
            style={{ borderColor: 'var(--wd-border)' }}
          >
            <button
              onClick={() => onApprove(request.id)}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
            >
              <Check size={16} />
              Zatwierdź
            </button>
            <button
              onClick={() => onReject(request.id)}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
            >
              <X size={16} />
              Odrzuć
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ApprovalList({
  initialRequests,
  employees,
  leaveTypes,
}: {
  initialRequests: LeaveRequestItem[]
  employees: { id: string; firstName: string; lastName: string }[]
  leaveTypes: { id: string; name: string; code: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const [requests, setRequests] = useState<LeaveRequestItem[]>(initialRequests)
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequestItem | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Reject modal state
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null)
  const [rejectLoading, setRejectLoading] = useState(false)

  // Approve loading
  const [approveLoadingId, setApproveLoadingId] = useState<string | null>(null)

  // Error toast
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // ── Filters ────────────────────────────────────────────────────────────────
  const statusFilter = searchParams.get('status') ?? 'pending'
  const leaveTypeFilter = searchParams.get('leaveTypeId') ?? ''
  const employeeFilter = searchParams.get('employeeId') ?? ''
  const monthFilter = searchParams.get('month') ?? ''

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`)
      })
    },
    [pathname, router, searchParams]
  )

  // ── Filtered view ──────────────────────────────────────────────────────────
  const filtered = requests.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false
    if (leaveTypeFilter && r.leaveTypeId !== leaveTypeFilter) return false
    if (employeeFilter && r.employeeId !== employeeFilter) return false
    if (monthFilter) {
      const parts = monthFilter.split('-')
      const year = parseInt(parts[0] ?? '0', 10)
      const month = parseInt(parts[1] ?? '0', 10)
      const startDate = new Date(r.startDate)
      if (startDate.getFullYear() !== year || startDate.getMonth() + 1 !== month) return false
    }
    return true
  })

  // ── Approve ────────────────────────────────────────────────────────────────
  const handleApprove = useCallback(
    async (id: string) => {
      setApproveLoadingId(id)
      setErrorMsg(null)
      try {
        const res = await fetch(`/api/hr/leave-requests/${id}/approve`, {
          method: 'PATCH',
        })
        if (!res.ok) {
          const data = await res.json() as { error?: string }
          setErrorMsg(data.error ?? 'Błąd zatwierdzania')
          return
        }
        const updated = await res.json() as LeaveRequestItem
        setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)))
        if (selectedRequest?.id === id) {
          setSelectedRequest((prev) => (prev ? { ...prev, ...updated } : null))
        }
      } catch {
        setErrorMsg('Błąd połączenia z serwerem')
      } finally {
        setApproveLoadingId(null)
      }
    },
    [selectedRequest]
  )

  // ── Reject ─────────────────────────────────────────────────────────────────
  const handleRejectConfirm = useCallback(
    async (note: string) => {
      if (!rejectTargetId) return
      setRejectLoading(true)
      setErrorMsg(null)
      try {
        const res = await fetch(`/api/hr/leave-requests/${rejectTargetId}/reject`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rejectionNote: note }),
        })
        if (!res.ok) {
          const data = await res.json() as { error?: string }
          setErrorMsg(data.error ?? 'Błąd odrzucania')
          return
        }
        const updated = await res.json() as LeaveRequestItem
        setRequests((prev) =>
          prev.map((r) => (r.id === rejectTargetId ? { ...r, ...updated } : r))
        )
        if (selectedRequest?.id === rejectTargetId) {
          setSelectedRequest((prev) => (prev ? { ...prev, ...updated } : null))
        }
        setRejectTargetId(null)
      } catch {
        setErrorMsg('Błąd połączenia z serwerem')
      } finally {
        setRejectLoading(false)
      }
    },
    [rejectTargetId, selectedRequest]
  )

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const handleExport = () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (monthFilter) params.set('month', monthFilter)
    window.location.href = `/api/hr/leave-requests/export?${params.toString()}`
  }

  // ── Row click ──────────────────────────────────────────────────────────────
  const handleRowClick = (request: LeaveRequestItem) => {
    setSelectedRequest(request)
    setSheetOpen(true)
  }

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - 5 + i)
    return d.toISOString().slice(0, 7)
  })

  return (
    <div>
      {/* Error banner */}
      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" />
          <span>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="ml-auto p-0.5 hover:bg-red-100 rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filters bar */}
      <div
        className="flex items-center gap-3 mb-5 p-3 rounded-xl border flex-wrap"
        style={{ background: 'var(--wd-white)', borderColor: 'var(--wd-border)' }}
      >
        <Filter size={14} className="text-[var(--wd-text-muted)] shrink-0" />

        {/* Status */}
        <select
          value={statusFilter}
          onChange={(e) => updateFilter('status', e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
        >
          <option value="">Wszystkie statusy</option>
          <option value="pending">Oczekujące</option>
          <option value="approved">Zatwierdzone</option>
          <option value="rejected">Odrzucone</option>
          <option value="cancelled">Anulowane</option>
        </select>

        {/* Leave type */}
        <select
          value={leaveTypeFilter}
          onChange={(e) => updateFilter('leaveTypeId', e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
        >
          <option value="">Wszystkie typy</option>
          {leaveTypes.map((lt) => (
            <option key={lt.id} value={lt.id}>
              {lt.name} ({lt.code})
            </option>
          ))}
        </select>

        {/* Employee */}
        <select
          value={employeeFilter}
          onChange={(e) => updateFilter('employeeId', e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
        >
          <option value="">Wszyscy pracownicy</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.firstName} {emp.lastName}
            </option>
          ))}
        </select>

        {/* Month */}
        <select
          value={monthFilter}
          onChange={(e) => updateFilter('month', e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
        >
          <option value="">Wszystkie miesiące</option>
          {monthOptions.map((m) => {
            const parts = m.split('-')
            const y = parseInt(parts[0] ?? '0', 10)
            const mo = parseInt(parts[1] ?? '1', 10)
            const label = new Date(y, mo - 1, 1).toLocaleDateString('pl-PL', {
              month: 'long',
              year: 'numeric',
            })
            return (
              <option key={m} value={m}>
                {label}
              </option>
            )
          })}
        </select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Export */}
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-[var(--wd-border)] text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)] transition-colors"
        >
          <Download size={14} />
          Eksport CSV
        </button>
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden shadow-sm"
        style={{ background: 'var(--wd-white)', borderColor: 'var(--wd-border)' }}
      >
        {filtered.length === 0 ? (
          <div className="py-20 text-center space-y-3">
            <PartyPopper size={36} className="mx-auto text-[var(--wd-text-muted)] opacity-30" />
            <div>
              <p className="font-medium text-[var(--wd-text-primary)]">
                {statusFilter === 'pending'
                  ? 'Brak wniosków do akceptacji'
                  : 'Brak wniosków spełniających kryteria'}
              </p>
              <p className="text-sm text-[var(--wd-text-muted)] mt-1">
                {statusFilter === 'pending' ? 'Wszystkie wnioski zostały rozpatrzone' : 'Zmień filtry aby zobaczyć wyniki'}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pracownik</th>
                  <th>Oddział</th>
                  <th>Typ urlopu</th>
                  <th>Od</th>
                  <th>Do</th>
                  <th className="text-center">Dni</th>
                  <th>Status</th>
                  <th className="text-center">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((req) => (
                  <tr
                    key={req.id}
                    className="cursor-pointer hover:bg-[var(--wd-surface)] transition-colors"
                    onClick={() => handleRowClick(req)}
                  >
                    {/* Employee */}
                    <td>
                      <p className="font-medium text-sm text-[var(--wd-text-primary)]">
                        {req.employee.firstName} {req.employee.lastName}
                      </p>
                    </td>

                    {/* Division */}
                    <td>
                      <span className="text-xs text-[var(--wd-text-muted)]">
                        {req.employee.division?.name ?? '—'}
                      </span>
                    </td>

                    {/* Leave type */}
                    <td>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: req.leaveType.color }}
                        />
                        <span className="text-sm text-[var(--wd-text-primary)]">
                          {req.leaveType.name}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--wd-text-muted)] uppercase">
                          {req.leaveType.code}
                        </span>
                      </div>
                    </td>

                    {/* Start */}
                    <td>
                      <div className="flex items-center gap-1 text-sm text-[var(--wd-text-primary)]">
                        <CalendarDays size={12} className="text-[var(--wd-text-muted)]" />
                        {formatDateShort(req.startDate)}
                      </div>
                    </td>

                    {/* End */}
                    <td>
                      <span className="text-sm text-[var(--wd-text-primary)]">
                        {formatDateShort(req.endDate)}
                      </span>
                    </td>

                    {/* Days */}
                    <td className="text-center">
                      <span className="inline-flex items-center justify-center w-7 h-7 text-xs font-bold rounded-full bg-[var(--wd-surface-2)] text-[var(--wd-text-primary)]">
                        {req.days}
                      </span>
                    </td>

                    {/* Status */}
                    <td>
                      <StatusBadge status={req.status} />
                    </td>

                    {/* Actions */}
                    <td
                      className="text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {req.status === 'pending' && (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleApprove(req.id)
                            }}
                            disabled={approveLoadingId === req.id}
                            className="inline-flex items-center gap-1 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50 transition-colors"
                            title="Zatwierdź"
                          >
                            {approveLoadingId === req.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Check size={12} />
                            )}
                            Zatwierdź
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setRejectTargetId(req.id)
                            }}
                            className="inline-flex items-center gap-1 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg px-3 py-1 text-xs font-medium transition-colors"
                            title="Odrzuć"
                          >
                            <X size={12} />
                            Odrzuć
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Count */}
      {filtered.length > 0 && (
        <p className="text-xs text-[var(--wd-text-muted)] mt-3 px-1">
          {filtered.length} {filtered.length === 1 ? 'wniosek' : 'wniosków'}
          {statusFilter === 'pending' && ' do rozpatrzenia'}
        </p>
      )}

      {/* Rejection modal */}
      <RejectionModal
        open={rejectTargetId !== null}
        onClose={() => setRejectTargetId(null)}
        onConfirm={(note) => void handleRejectConfirm(note)}
        loading={rejectLoading}
      />

      {/* Detail sheet */}
      <DetailSheet
        request={selectedRequest}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onApprove={(id) => void handleApprove(id)}
        onReject={(id) => {
          setSheetOpen(false)
          setRejectTargetId(id)
        }}
      />
    </div>
  )
}
