'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, X, ChevronDown, Calendar, Clock, CheckCircle2, XCircle, Ban, AlertCircle } from 'lucide-react'
import { LeaveRequestForm } from './leave-request-form'

interface LeaveType {
  id: string
  name: string
  code: string
  color: string
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  position: string
}

interface LeaveRequest {
  id: string
  employeeId: string
  employee: Employee
  leaveType: LeaveType
  startDate: string
  endDate: string
  days: number
  isOnDemand: boolean
  isRemoteWork: boolean
  isDelegation: boolean
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  note?: string | null
  createdAt: string
}

interface LeaveRequestsViewProps {
  employeeId: string
  role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
}

const STATUS_CONFIG = {
  pending: {
    label: 'Oczekujący',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    icon: Clock,
  },
  approved: {
    label: 'Zatwierdzony',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    icon: CheckCircle2,
  },
  rejected: {
    label: 'Odrzucony',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    icon: XCircle,
  },
  cancelled: {
    label: 'Anulowany',
    bg: 'bg-[var(--wd-surface-2)]',
    text: 'text-[var(--wd-text-muted)]',
    border: 'border-[var(--wd-border)]',
    icon: Ban,
  },
} as const

function formatDateRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const fmt = (d: Date) =>
    d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: '2-digit' })
  if (start === end) return fmt(s)
  return `${fmt(s)} – ${fmt(e)}`
}

export function LeaveRequestsView({ employeeId, role }: LeaveRequestsViewProps) {
  const isAdminOrManager = role === 'ADMIN' || role === 'MANAGER'

  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Filters
  const [filterStatus, setFilterStatus] = useState('')
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))

  // Confirm cancel
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (isAdminOrManager) {
        // no employeeId filter — see all, unless we add a per-employee filter later
      } else {
        params.set('employeeId', employeeId)
      }
      if (filterStatus) params.set('status', filterStatus)
      if (filterYear) params.set('year', filterYear)

      const res = await fetch(`/api/hr/leave-requests?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setRequests(data)
      }
    } finally {
      setLoading(false)
    }
  }, [employeeId, isAdminOrManager, filterStatus, filterYear])

  useEffect(() => {
    fetchRequests()
  }, [fetchRequests])

  const handleCancelConfirm = async () => {
    if (!cancelingId) return
    setCanceling(true)
    setCancelError(null)
    try {
      const res = await fetch(`/api/hr/leave-requests/${cancelingId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        setCancelError(data.error ?? 'Błąd anulowania wniosku')
        return
      }
      setCancelingId(null)
      fetchRequests()
    } catch {
      setCancelError('Błąd połączenia z serwerem')
    } finally {
      setCanceling(false)
    }
  }

  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--wd-text-primary)]">
            {isAdminOrManager ? 'Wnioski urlopowe' : 'Moje wnioski urlopowe'}
          </h1>
          <p className="text-sm text-[var(--wd-text-muted)] mt-0.5">
            Zarządzaj swoimi wnioskami o urlop
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[var(--wd-dark)] text-[var(--wd-off-white)] rounded-xl hover:opacity-90 transition-opacity shrink-0"
        >
          <Plus size={16} />
          Złóż wniosek
        </button>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-[var(--wd-border)] overflow-hidden"
            style={{ maxHeight: '90vh', overflowY: 'auto' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--wd-border)]">
              <div>
                <h2 className="font-bold text-[var(--wd-text-primary)]">Złóż wniosek urlopowy</h2>
                <p className="text-xs text-[var(--wd-text-muted)] mt-0.5">Wypełnij formularz poniżej</p>
              </div>
              <button
                onClick={() => setShowForm(false)}
                className="p-1.5 rounded-lg hover:bg-[var(--wd-surface-2)] text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5">
              <LeaveRequestForm
                employeeId={employeeId}
                onSuccess={() => {
                  setShowForm(false)
                  fetchRequests()
                }}
                onCancel={() => setShowForm(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirm dialog */}
      {cancelingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-[var(--wd-border)] p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <AlertCircle size={20} className="text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-[var(--wd-text-primary)]">Anulować wniosek?</h3>
                <p className="text-sm text-[var(--wd-text-muted)] mt-1">
                  Tej operacji nie można cofnąć. Saldo urlopowe zostanie przywrócone.
                </p>
              </div>
            </div>
            {cancelError && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{cancelError}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setCancelingId(null); setCancelError(null) }}
                disabled={canceling}
                className="px-4 py-2 text-sm font-medium text-[var(--wd-text-primary)] hover:bg-[var(--wd-surface-2)] rounded-lg transition-colors"
              >
                Wróć
              </button>
              <button
                onClick={handleCancelConfirm}
                disabled={canceling}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {canceling && <span className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />}
                Anuluj wniosek
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)] transition-colors cursor-pointer"
          >
            <option value="">Wszystkie statusy</option>
            <option value="pending">Oczekujące</option>
            <option value="approved">Zatwierdzone</option>
            <option value="rejected">Odrzucone</option>
            <option value="cancelled">Anulowane</option>
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--wd-text-muted)] pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)] transition-colors cursor-pointer"
          >
            {yearOptions.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--wd-text-muted)] pointer-events-none" />
        </div>
      </div>

      {/* Requests list */}
      {loading ? (
        <div className="bg-white rounded-xl border border-[var(--wd-border)] divide-y divide-[var(--wd-border)]">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
              <div className="w-2 h-2 rounded-full bg-[var(--wd-surface-2)] shrink-0" />
              <div className="flex-1 flex gap-4">
                <div className="h-3.5 w-32 bg-[var(--wd-surface-2)] rounded" />
                <div className="h-3.5 w-24 bg-[var(--wd-surface-2)] rounded" />
                <div className="h-3.5 w-16 bg-[var(--wd-surface-2)] rounded" />
              </div>
              <div className="h-6 w-24 bg-[var(--wd-surface-2)] rounded-full" />
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-white rounded-xl border border-[var(--wd-border)] px-6 py-12 text-center">
          <Calendar size={32} className="mx-auto text-[var(--wd-text-muted)] mb-3 opacity-40" />
          <p className="font-medium text-[var(--wd-text-primary)]">Brak wniosków urlopowych</p>
          <p className="text-sm text-[var(--wd-text-muted)] mt-1">
            Kliknij &ldquo;Złóż wniosek&rdquo;, aby złożyć pierwszy wniosek
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[var(--wd-border)] divide-y divide-[var(--wd-border)]">
          {requests.map((req) => {
            const statusCfg = STATUS_CONFIG[req.status]
            const StatusIcon = statusCfg.icon
            const daysLabel = req.days === 1 ? '1 dzień' : `${req.days} dni`

            return (
              <div key={req.id} className="px-5 py-4 flex items-center gap-4 hover:bg-[var(--wd-surface-2)]/40 transition-colors group">
                {/* Color dot */}
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: req.leaveType.color }}
                />

                {/* Main info */}
                <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs font-bold text-[var(--wd-text-muted)] uppercase tracking-wider shrink-0">
                      {req.leaveType.code}
                    </span>
                    <span className="text-sm font-medium text-[var(--wd-text-primary)] truncate">
                      {req.leaveType.name}
                      {req.isOnDemand && (
                        <span className="ml-1.5 text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                          NŻ
                        </span>
                      )}
                      {req.isRemoteWork && (
                        <span className="ml-1.5 text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                          RW
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-sm text-[var(--wd-text-muted)] shrink-0">
                    <span>{formatDateRange(req.startDate, req.endDate)}</span>
                    <span className="font-semibold text-[var(--wd-text-primary)]">{daysLabel}</span>
                  </div>

                  {isAdminOrManager && (
                    <span className="text-xs text-[var(--wd-text-muted)] truncate">
                      {req.employee.firstName} {req.employee.lastName}
                    </span>
                  )}
                </div>

                {/* Status badge */}
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold shrink-0 ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
                  <StatusIcon size={11} />
                  {statusCfg.label}
                </div>

                {/* Cancel button */}
                {req.status === 'pending' && req.employeeId === employeeId && (
                  <button
                    onClick={() => { setCancelingId(req.id); setCancelError(null) }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-[var(--wd-text-muted)] hover:text-red-600 hover:bg-red-50 transition-all"
                    title="Anuluj wniosek"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
