'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { PieChart, Loader2, Pencil, X, Check, RefreshCw } from 'lucide-react'
import { AdminLeaveButton } from '@/components/hr/leave/admin-leave-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Employee {
  id: string
  firstName: string
  lastName: string
  email: string
  costCenter: { id: string; name: string } | null
}

interface LeaveType {
  id: string
  name: string
  code: string
  color: string
}

interface LeaveBalance {
  id: string
  employeeId: string
  leaveTypeId: string
  year: number
  totalDays: number
  usedDays: number
  pendingDays: number
  carriedOver: number
  leaveType: LeaveType
  employee: Employee
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function BalanceProgressBar({
  used,
  total,
}: {
  used: number
  total: number
}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  const barColor =
    pct >= 75 ? '#EF4444' : pct >= 25 ? '#F59E0B' : '#10B981'

  return (
    <div className="space-y-1">
      <div className="h-1.5 rounded-full bg-[var(--wd-surface-2)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <p className="text-[10px] text-[var(--wd-text-muted)]">
        {pct.toFixed(0)}% wykorzystane
      </p>
    </div>
  )
}

// ─── Inline Edit ─────────────────────────────────────────────────────────────

function InlineBalanceEdit({
  balance,
  onSaved,
  onCancel,
}: {
  balance: LeaveBalance
  onSaved: () => void
  onCancel: () => void
}) {
  const [totalDays, setTotalDays] = useState(String(balance.totalDays))
  const [usedDays, setUsedDays] = useState(String(balance.usedDays))
  const [carriedOver, setCarriedOver] = useState(String(balance.carriedOver))
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    const trimmedReason = reason.trim()
    if (trimmedReason.length < 3) {
      setError('Powód korekty musi mieć co najmniej 3 znaki')
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/hr/leave-balances/${balance.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalDays: parseFloat(totalDays),
          usedDays: parseFloat(usedDays),
          carriedOver: parseFloat(carriedOver),
          reason: trimmedReason,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Błąd zapisu')
        return
      }
      onSaved()
    } catch {
      setError('Błąd połączenia')
    } finally {
      setLoading(false)
    }
  }

  return (
    <td colSpan={7} className="px-4 py-2">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-[var(--wd-text-muted)]">
          Przysługuje:
          <input
            aria-label="Przysługuje"
            type="number"
            value={totalDays}
            onChange={(e) => setTotalDays(e.target.value)}
            min={0}
            step={0.5}
            className="w-16 px-2 py-1 text-xs rounded border border-[var(--wd-border)] bg-[var(--wd-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--wd-sand)]"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--wd-text-muted)]">
          Wykorzystane:
          <input
            aria-label="Wykorzystane"
            type="number"
            value={usedDays}
            onChange={(e) => setUsedDays(e.target.value)}
            min={0}
            step={0.5}
            className="w-16 px-2 py-1 text-xs rounded border border-[var(--wd-border)] bg-[var(--wd-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--wd-sand)]"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--wd-text-muted)]">
          Przeniesione:
          <input
            aria-label="Przeniesione"
            type="number"
            value={carriedOver}
            onChange={(e) => setCarriedOver(e.target.value)}
            min={0}
            step={0.5}
            className="w-16 px-2 py-1 text-xs rounded border border-[var(--wd-border)] bg-[var(--wd-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--wd-sand)]"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--wd-text-muted)]">
          Powód korekty:
          <input
            aria-label="Powód korekty"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
            maxLength={1000}
            className="w-64 max-w-full px-2 py-1 text-xs rounded border border-[var(--wd-border)] bg-[var(--wd-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--wd-sand)]"
          />
        </label>
        {error && (
          <span role="alert" className="text-xs text-red-600">
            {error}
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={handleSave}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-[var(--wd-dark)] text-white hover:bg-[#2E2E2E] disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Zapisz korektę
          </button>
          <button
            onClick={onCancel}
            aria-label="Anuluj korektę"
            className="p-1 rounded text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </td>
  )
}

// ─── Carryover Modal ──────────────────────────────────────────────────────────

function CarryoverModal({
  open,
  onClose,
  onDone,
  returnFocusRef,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
  returnFocusRef: React.RefObject<HTMLElement | null>
}) {
  const currentYear = new Date().getFullYear()
  const initialFocusRef = useRef<HTMLInputElement>(null)
  const [fromYear, setFromYear] = useState(String(currentYear - 1))
  const [toYear, setToYear] = useState(String(currentYear))
  const [maxDays, setMaxDays] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    processed: number
    created: number
    updated: number
    skipped: number
    needsReview: Array<{
      employeeId: string
      employeeName: string
    }>
  } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setResult(null)
      setError('')
      setReason('')
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedReason = reason.trim()
    if (trimmedReason.length < 3) {
      setError('Powód przeniesienia musi mieć co najmniej 3 znaki')
      return
    }

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch('/api/hr/leave-balances/carryover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromYear: parseInt(fromYear, 10),
          toYear: parseInt(toYear, 10),
          maxCarryoverDays: maxDays ? parseFloat(maxDays) : undefined,
          reason: trimmedReason,
        }),
      })

      const data = await res.json() as {
        processed?: number
        created?: number
        updated?: number
        skipped?: number
        needsReview?: Array<{
          employeeId: string
          employeeName: string
        }>
        error?: string
      }

      if (!res.ok) {
        setError(data.error ?? 'Wystąpił błąd')
        return
      }

      setResult({
        processed: data.processed ?? 0,
        created: data.created ?? 0,
        updated: data.updated ?? 0,
        skipped: data.skipped ?? 0,
        needsReview: data.needsReview ?? [],
      })
      onDone()
    } catch {
      setError('Błąd połączenia z serwerem')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          initialFocusRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
        className="max-w-md gap-0 overflow-hidden border-[var(--wd-border)] bg-[var(--wd-white)] p-0 shadow-2xl"
      >
        <DialogHeader
          className="border-b px-5 py-4 pr-12"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <div className="flex items-center gap-2">
            <RefreshCw size={16} className="text-[var(--wd-text-muted)]" />
            <DialogTitle className="text-base font-semibold text-[var(--wd-text-primary)]">
              Przeniesienie dni na nowy rok
            </DialogTitle>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <DialogDescription className="text-xs leading-5 text-[var(--wd-text-muted)]">
            Operacja dotyczy wyłącznie urlopu wypoczynkowego (VL).
          </DialogDescription>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="carryover-from-year"
                className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5 uppercase tracking-wide"
              >
                Z roku
              </label>
              <input
                ref={initialFocusRef}
                id="carryover-from-year"
                type="number"
                value={fromYear}
                onChange={(e) => setFromYear(e.target.value)}
                required
                min={2000}
                max={2100}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
              />
            </div>
            <div>
              <label
                htmlFor="carryover-to-year"
                className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5 uppercase tracking-wide"
              >
                Na rok
              </label>
              <input
                id="carryover-to-year"
                type="number"
                value={toYear}
                onChange={(e) => setToYear(e.target.value)}
                required
                min={2000}
                max={2100}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="carryover-max-days"
              className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5 uppercase tracking-wide"
            >
              Maks. dni do przeniesienia <span className="normal-case font-normal">(opcjonalnie)</span>
            </label>
            <input
              id="carryover-max-days"
              type="number"
              value={maxDays}
              onChange={(e) => setMaxDays(e.target.value)}
              min={0}
              step={0.5}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
              placeholder="Brak limitu — przenosi wszystkie"
            />
          </div>

          <div>
            <label
              htmlFor="carryover-reason"
              className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5 uppercase tracking-wide"
            >
              Powód przeniesienia
            </label>
            <textarea
              id="carryover-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              maxLength={1000}
              rows={2}
              className="w-full resize-y px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="text-xs text-red-600 border-l-2 border-red-500 pl-3 py-1"
            >
              {error}
            </p>
          )}

          {result && (
            <div
              role="status"
              aria-live="polite"
              className="border-t border-[var(--wd-border)] pt-3 space-y-3"
            >
              <p className="text-xs font-medium text-emerald-800">Przeniesienie zakończone</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: 'Przetworzone', value: result.processed },
                  { label: 'Utworzone', value: result.created },
                  { label: 'Zaktualizowane', value: result.updated },
                  { label: 'Pominięte', value: result.skipped },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-lg font-bold text-emerald-700">{s.value}</p>
                    <p className="text-[10px] leading-4 text-emerald-700 break-words">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
              {result.needsReview.length > 0 && (
                <div className="border-l-2 border-amber-500 pl-3">
                  <p className="text-xs font-medium text-amber-800">
                    Wymagają weryfikacji
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Trzeba ustawić wymiar urlopu na profilu pracownika:
                  </p>
                  <ul className="mt-1 text-xs text-amber-900 list-disc list-inside">
                    {result.needsReview.map((employee) => (
                      <li key={employee.employeeId}>{employee.employeeName}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--wd-border)] text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)] transition-colors"
            >
              {result ? 'Zamknij' : 'Anuluj'}
            </button>
            {!result && (
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--wd-dark)] text-white hover:bg-[#2E2E2E] disabled:opacity-50 transition-colors"
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                Przenieś dni
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeaveBalancesPage() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'ADMIN'
  const currentYear = new Date().getFullYear()

  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [selectedYear, setSelectedYear] = useState(String(currentYear))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [carryoverOpen, setCarryoverOpen] = useState(false)
  const carryoverReturnFocusRef = useRef<HTMLElement | null>(null)

  const fetchBalances = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedEmployee) params.set('employeeId', selectedEmployee)
      if (selectedYear) params.set('year', selectedYear)

      const res = await fetch(`/api/hr/leave-balances?${params.toString()}`)
      if (res.ok) {
        const data = await res.json() as LeaveBalance[]
        setBalances(data)
      }
    } finally {
      setLoading(false)
    }
  }, [selectedEmployee, selectedYear])

  const fetchEmployees = useCallback(async () => {
    const res = await fetch('/api/hr/employees?limit=200&status=active')
    if (res.ok) {
      const data = await res.json() as { employees: Employee[] }
      setEmployees(data.employees)
    }
  }, [])

  useEffect(() => {
    void fetchEmployees()
  }, [fetchEmployees])

  useEffect(() => {
    void fetchBalances()
  }, [fetchBalances])

  // Group balances by employee
  const grouped = balances.reduce<Record<string, LeaveBalance[]>>((acc, b) => {
    if (!acc[b.employeeId]) acc[b.employeeId] = []
    acc[b.employeeId].push(b)
    return acc
  }, {})

  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i)

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--wd-text-primary)]">Salda urlopowe</h1>
          <p className="text-sm mt-0.5 text-[var(--wd-text-muted)]">
            {balances.length} rekordów · rok {selectedYear}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && <AdminLeaveButton onSuccess={fetchBalances} />}
          {isAdmin && (
            <button
              onClick={(event) => {
                carryoverReturnFocusRef.current = event.currentTarget
                setCarryoverOpen(true)
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] hover:bg-[var(--wd-surface-2)] transition-colors"
            >
              <RefreshCw size={14} />
              Przenieś na nowy rok
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div
        className="flex items-center gap-3 mb-5 p-3 rounded-xl border flex-wrap"
        style={{ background: 'var(--wd-white)', borderColor: 'var(--wd-border)' }}
      >
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-[var(--wd-text-muted)] uppercase tracking-wide whitespace-nowrap">
            Pracownik:
          </label>
          <select
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
          >
            <option value="">Wszyscy pracownicy</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-[var(--wd-text-muted)] uppercase tracking-wide whitespace-nowrap">
            Rok:
          </label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="bg-white border border-[var(--wd-border)] rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center gap-2 text-[var(--wd-text-muted)]">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Ładowanie sald...</span>
          </div>
        ) : balances.length === 0 ? (
          <div className="py-16 text-center">
            <PieChart size={32} className="mx-auto mb-3 text-[var(--wd-text-muted)] opacity-30" />
            <p className="text-sm text-[var(--wd-text-muted)]">
              Brak sald urlopowych dla wybranych filtrów.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pracownik</th>
                  <th>Typ urlopu</th>
                  <th className="text-right">Przysługuje</th>
                  <th className="text-right">Wykorz.</th>
                  <th className="text-right">Oczek.</th>
                  <th className="text-right">Pozostało</th>
                  <th style={{ minWidth: '120px' }}>Postęp</th>
                  {isAdmin && <th className="text-right">Akcje</th>}
                </tr>
              </thead>
              <tbody>
                {Object.values(grouped).map((empBalances) => {
                  const emp = empBalances[0]?.employee
                  return empBalances.map((balance, idx) => {
                    const remaining = balance.totalDays - balance.usedDays - balance.pendingDays
                    const isEditing = isAdmin && editingId === balance.id

                    if (isEditing) {
                      return (
                        <tr key={balance.id} className="bg-amber-50/50">
                          {idx === 0 && (
                            <td rowSpan={empBalances.length} className="align-top pt-3">
                              <div>
                                <p className="font-medium text-sm text-[var(--wd-text-primary)]">
                                  {emp?.firstName} {emp?.lastName}
                                </p>
                                <p className="text-xs text-[var(--wd-text-muted)]">{emp?.email}</p>
                              </div>
                            </td>
                          )}
                          <InlineBalanceEdit
                            key={balance.id}
                            balance={balance}
                            onSaved={async () => {
                              setEditingId(null)
                              await fetchBalances()
                            }}
                            onCancel={() => setEditingId(null)}
                          />
                        </tr>
                      )
                    }

                    return (
                      <tr key={balance.id}>
                        {idx === 0 && (
                          <td rowSpan={empBalances.length} className="align-top pt-3">
                            <div>
                              <p className="font-medium text-sm text-[var(--wd-text-primary)]">
                                {emp?.firstName} {emp?.lastName}
                              </p>
                              <p className="text-xs text-[var(--wd-text-muted)]">{emp?.email}</p>
                            </div>
                          </td>
                        )}
                        <td>
                          <div className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ background: balance.leaveType.color }}
                            />
                            <span className="text-sm text-[var(--wd-text-primary)]">
                              {balance.leaveType.name}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--wd-text-muted)] uppercase">
                              {balance.leaveType.code}
                            </span>
                          </div>
                        </td>
                        <td className="text-right">
                          <span className="text-sm font-medium text-[var(--wd-text-primary)]">
                            {balance.totalDays} dni
                          </span>
                          {balance.carriedOver > 0 && (
                            <p className="text-[10px] text-[var(--wd-text-muted)]">
                              +{balance.carriedOver} przen.
                            </p>
                          )}
                        </td>
                        <td className="text-right">
                          <span className="text-sm text-[var(--wd-text-primary)]">
                            {balance.usedDays} dni
                          </span>
                        </td>
                        <td className="text-right">
                          <span className="text-sm text-[var(--wd-text-muted)]">
                            {balance.pendingDays} dni
                          </span>
                        </td>
                        <td className="text-right">
                          <span
                            className={`text-sm font-medium ${
                              remaining <= 0
                                ? 'text-red-600'
                                : remaining <= 3
                                  ? 'text-amber-600'
                                  : 'text-[var(--wd-text-primary)]'
                            }`}
                          >
                            {remaining} dni
                          </span>
                        </td>
                        <td style={{ minWidth: '120px' }}>
                          <BalanceProgressBar
                            used={balance.usedDays}
                            total={balance.totalDays}
                          />
                        </td>
                        {isAdmin && (
                          <td className="text-right">
                            <button
                              onClick={() => setEditingId(balance.id)}
                              aria-label="Edytuj saldo"
                              className="p-1.5 rounded-md text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)] hover:text-[var(--wd-text-primary)] transition-colors"
                              title="Edytuj saldo"
                            >
                              <Pencil size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Carryover Modal */}
      {isAdmin && (
        <CarryoverModal
          open={carryoverOpen}
          onClose={() => setCarryoverOpen(false)}
          onDone={fetchBalances}
          returnFocusRef={carryoverReturnFocusRef}
        />
      )}
    </div>
  )
}
