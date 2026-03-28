'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Calendar, Info, AlertCircle, Loader2 } from 'lucide-react'
import { EmployeeSelect } from '@/components/hr/employees/employee-select'
import { calculateWorkingDays } from '@/lib/hr/utils'

interface LeaveType {
  id: string
  name: string
  code: string
  color: string
  isPaid: boolean
  requiresApproval: boolean
}

interface LeaveBalance {
  id: string
  leaveTypeId: string
  leaveType: LeaveType
  year: number
  totalDays: number
  usedDays: number
  pendingDays: number
  carriedOver: number
}

interface LeaveRequestFormProps {
  employeeId?: string
  isAdmin?: boolean
  onSuccess: () => void
  onCancel: () => void
}

export function LeaveRequestForm({ employeeId: employeeIdProp, isAdmin = false, onSuccess, onCancel }: LeaveRequestFormProps) {
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [allLeaveTypes, setAllLeaveTypes] = useState<LeaveType[]>([])
  const [loadingBalances, setLoadingBalances] = useState(false)

  // When admin mode without pre-set employeeId — let admin pick from dropdown
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | undefined>(employeeIdProp)

  // The effective employeeId used for fetching and submitting
  const employeeId = isAdmin ? selectedEmployeeId : employeeIdProp

  const [leaveTypeId, setLeaveTypeId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [isOnDemand, setIsOnDemand] = useState(false)
  const [isRemoteWork, setIsRemoteWork] = useState(false)
  const [substituteId, setSubstituteId] = useState<string | undefined>()
  const [notifySubstitute, setNotifySubstitute] = useState(false)
  const [note, setNote] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [onDemandUsed, setOnDemandUsed] = useState(0)

  const currentYear = new Date().getFullYear()

  // Admin: load all leave types on mount so dropdown is always populated
  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/hr/leave-types')
      .then((r) => r.json())
      .then((data: unknown) => {
        const list = Array.isArray(data) ? data as LeaveType[] : (data as { leaveTypes?: LeaveType[] }).leaveTypes ?? []
        setAllLeaveTypes(list)
        if (list.length > 0 && !leaveTypeId) setLeaveTypeId(list[0].id)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  const loadBalances = useCallback(async () => {
    if (!employeeId) {
      setBalances([])
      if (!isAdmin) setLeaveTypeId('')
      return
    }
    setLoadingBalances(true)
    try {
      const res = await fetch(`/api/hr/leave-balances?employeeId=${employeeId}&year=${currentYear}`)
      if (res.ok) {
        const data = await res.json() as LeaveBalance[]
        setBalances(data)
        if (!isAdmin && data.length > 0) setLeaveTypeId(data[0].leaveTypeId)
      }
    } finally {
      setLoadingBalances(false)
    }
  }, [employeeId, currentYear, isAdmin])

  const loadOnDemandCount = useCallback(async () => {
    if (!leaveTypeId || !employeeId) return
    try {
      const res = await fetch(
        `/api/hr/leave-requests?employeeId=${employeeId}&year=${currentYear}`
      )
      if (res.ok) {
        const data = await res.json()
        const count = (data as { isOnDemand: boolean; status: string }[]).filter(
          (r) => r.isOnDemand && !['cancelled', 'rejected'].includes(r.status)
        ).length
        setOnDemandUsed(count)
      }
    } catch {
      // ignore
    }
  }, [employeeId, leaveTypeId, currentYear])

  useEffect(() => {
    loadBalances()
  }, [loadBalances])

  useEffect(() => {
    loadOnDemandCount()
  }, [loadOnDemandCount])

  const selectedBalance = balances.find((b) => b.leaveTypeId === leaveTypeId)
  const available = selectedBalance
    ? selectedBalance.totalDays - selectedBalance.usedDays - selectedBalance.pendingDays
    : 0

  const workingDays =
    startDate && endDate
      ? calculateWorkingDays(new Date(startDate), new Date(endDate))
      : 0

  const hasEnoughBalance =
    isRemoteWork || available >= workingDays || workingDays === 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!employeeId) {
      setError('Wybierz pracownika')
      return
    }

    if (!leaveTypeId || !startDate || !endDate) {
      setError('Wypełnij wszystkie wymagane pola')
      return
    }

    if (workingDays <= 0) {
      setError('Wybrany zakres nie zawiera dni roboczych')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/hr/leave-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          leaveTypeId,
          startDate,
          endDate,
          isOnDemand,
          isRemoteWork,
          isDelegation: false,
          substituteId,
          notifySubstitute,
          note: note || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Wystąpił błąd podczas składania wniosku')
        return
      }

      onSuccess()
    } catch {
      setError('Błąd połączenia z serwerem')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Employee picker — admin only, when no employeeId pre-set */}
      {isAdmin && !employeeIdProp && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--wd-text-primary)] uppercase tracking-wide">
            Pracownik <span className="text-red-500">*</span>
          </label>
          <EmployeeSelect
            value={selectedEmployeeId}
            onChange={(val) => {
              setSelectedEmployeeId(val)
              setBalances([])
              setLeaveTypeId('')
            }}
            placeholder="Wybierz pracownika…"
          />
        </div>
      )}

      {/* Loading indicator for balances */}
      {loadingBalances && (
        <div className="flex items-center justify-center py-6">
          <Loader2 size={18} className="animate-spin text-[var(--wd-text-muted)]" />
        </div>
      )}

      {/* Prompt to pick employee first (admin mode) */}
      {isAdmin && !employeeId && !loadingBalances && (
        <div className="py-4 text-center text-sm text-[var(--wd-text-muted)]">
          Wybierz pracownika, aby załadować saldo urlopowe
        </div>
      )}

      {/* Rest of form — only when employee is known */}
      {!!employeeId && !loadingBalances && (
      <>

      {/* Leave type */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-[var(--wd-text-primary)] uppercase tracking-wide">
          Typ urlopu <span className="text-red-500">*</span>
        </label>
        <select
          value={leaveTypeId}
          onChange={(e) => {
            setLeaveTypeId(e.target.value)
            setIsOnDemand(false)
          }}
          required
          className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)] transition-colors"
        >
          <option value="">Wybierz typ urlopu…</option>
          {isAdmin
            ? allLeaveTypes.map((lt) => {
                const bal = balances.find((b) => b.leaveTypeId === lt.id)
                const avail = bal ? bal.totalDays - bal.usedDays - bal.pendingDays : null
                return (
                  <option key={lt.id} value={lt.id}>
                    {lt.code} — {lt.name}{avail !== null ? ` (${avail % 1 === 0 ? avail : avail.toFixed(1)} dni pozostałych)` : ''}
                  </option>
                )
              })
            : balances.map((b) => {
                const avail = b.totalDays - b.usedDays - b.pendingDays
                return (
                  <option key={b.leaveTypeId} value={b.leaveTypeId}>
                    {b.leaveType.code} — {b.leaveType.name} ({avail % 1 === 0 ? avail : avail.toFixed(1)} dni pozostałych)
                  </option>
                )
              })
          }
        </select>

        {/* Balance progress */}
        {selectedBalance && (
          <div className="mt-1 flex flex-col gap-1">
            <div className="h-1.5 rounded-full bg-[var(--wd-surface-2)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(
                    ((selectedBalance.usedDays + selectedBalance.pendingDays) / selectedBalance.totalDays) * 100,
                    100
                  )}%`,
                  backgroundColor: selectedBalance.leaveType.color,
                  opacity: 0.85,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-[var(--wd-text-muted)]">
              <span>{selectedBalance.usedDays} wyk. · {selectedBalance.pendingDays} oczekujące</span>
              <span className="font-semibold" style={{ color: selectedBalance.leaveType.color }}>
                {available % 1 === 0 ? available : available.toFixed(1)} / {selectedBalance.totalDays} dni
              </span>
            </div>
          </div>
        )}
      </div>

      {/* On demand */}
      {selectedBalance && (
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={isOnDemand}
            onChange={(e) => setIsOnDemand(e.target.checked)}
            className="mt-0.5 rounded border-[var(--wd-border)] accent-[var(--wd-dark)]"
          />
          <span className="text-sm text-[var(--wd-text-primary)]">
            Urlop na żądanie{' '}
            <span className="text-[var(--wd-text-muted)]">
              (max 4/rok — pozostało: {4 - onDemandUsed})
            </span>
          </span>
        </label>
      )}

      {/* Remote work */}
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={isRemoteWork}
          onChange={(e) => setIsRemoteWork(e.target.checked)}
          className="mt-0.5 rounded border-[var(--wd-border)] accent-[var(--wd-dark)]"
        />
        <span className="text-sm text-[var(--wd-text-primary)]">Praca zdalna</span>
      </label>

      {/* Date range */}
      <div className="grid grid-cols-3 gap-3 items-end">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--wd-text-primary)] uppercase tracking-wide">
            Od <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--wd-text-muted)] pointer-events-none" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                if (endDate && e.target.value > endDate) setEndDate(e.target.value)
              }}
              required
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)] transition-colors"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--wd-text-primary)] uppercase tracking-wide">
            Do <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--wd-text-muted)] pointer-events-none" />
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)] transition-colors"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--wd-text-muted)] uppercase tracking-wide">
            Dni robocze
          </label>
          <div
            className="px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface-2)] font-bold tabular-nums"
            style={{
              color: workingDays > 0
                ? (hasEnoughBalance ? 'var(--wd-text-primary)' : '#DC2626')
                : 'var(--wd-text-muted)',
            }}
          >
            {workingDays > 0 ? workingDays : '—'}
          </div>
        </div>
      </div>

      {/* Insufficient balance warning */}
      {workingDays > 0 && !hasEnoughBalance && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle size={14} className="shrink-0" />
          <span>
            Niewystarczające saldo urlopowe — dostępne: {available % 1 === 0 ? available : available.toFixed(1)} dni, wymagane: {workingDays} dni
          </span>
        </div>
      )}

      {/* Substitute */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-[var(--wd-text-primary)] uppercase tracking-wide">
          Zastępuje mnie
        </label>
        <EmployeeSelect
          value={substituteId}
          onChange={setSubstituteId}
          placeholder="Wybierz zastępcę (opcjonalnie)"
          excludeIds={employeeId ? [employeeId] : []}
        />
      </div>

      {substituteId && (
        <label className="flex items-start gap-2.5 cursor-pointer -mt-2">
          <input
            type="checkbox"
            checked={notifySubstitute}
            onChange={(e) => setNotifySubstitute(e.target.checked)}
            className="mt-0.5 rounded border-[var(--wd-border)] accent-[var(--wd-dark)]"
          />
          <span className="text-sm text-[var(--wd-text-primary)]">Powiadom zastępcę</span>
        </label>
      )}

      {/* Note */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-[var(--wd-text-primary)] uppercase tracking-wide">
          Notatka
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Opcjonalna notatka do wniosku…"
          rows={2}
          className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] placeholder:text-[var(--wd-text-muted)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)] transition-colors"
        />
      </div>

      {/* Info */}
      {selectedBalance?.leaveType.requiresApproval && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--wd-surface-2)] text-[var(--wd-text-muted)] text-xs">
          <Info size={12} className="shrink-0" />
          <span>Ten typ urlopu wymaga zatwierdzenia przez przełożonego</span>
        </div>
      )}

      </>
      )}

      {/* Error — always visible */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-[var(--wd-text-primary)] hover:bg-[var(--wd-surface-2)] rounded-lg transition-colors"
        >
          Anuluj
        </button>
        <button
          type="submit"
          disabled={submitting || !employeeId || !hasEnoughBalance || workingDays <= 0}
          className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-[var(--wd-dark)] text-[var(--wd-off-white)] rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Złóż wniosek
        </button>
      </div>
    </form>
  )
}
