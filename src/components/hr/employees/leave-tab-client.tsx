'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Pencil, Loader2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveType {
  id: string
  name: string
  code: string
  color: string
}

interface LeaveBalance {
  id: string
  year: number
  totalDays: number
  usedDays: number
  pendingDays: number
  carriedOver: number
  leaveType: LeaveType
}

interface LeaveRequest {
  id: string
  startDate: string
  endDate: string
  days: number
  status: string
  leaveType: LeaveType
}

interface LeaveTabClientProps {
  employeeId: string
  balances: LeaveBalance[]
  requests: LeaveRequest[]
  canEditBalance: boolean
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending: 'Oczekujący',
  approved: 'Zatwierdzony',
  rejected: 'Odrzucony',
  cancelled: 'Anulowany',
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-600 border-red-200',
  cancelled: 'bg-stone-50 text-stone-600 border-stone-200',
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  canEditBalance,
  onAdd,
}: {
  canEditBalance: boolean
  onAdd: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: 'var(--wd-surface-2)' }}
      >
        <svg className="w-6 h-6" style={{ color: 'var(--wd-text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <p className="font-medium text-[var(--wd-text-primary)] mb-1">Brak danych urlopowych</p>
      <p className="text-sm mb-4" style={{ color: 'var(--wd-text-muted)' }}>
        Nie przypisano jeszcze salda urlopowego.
      </p>
      {canEditBalance && (
        <Button variant="outline" size="sm" onClick={onAdd} className="gap-2">
          <Plus className="w-3.5 h-3.5" />
          Dodaj saldo
        </Button>
      )}
    </div>
  )
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

interface BalanceModalProps {
  mode: 'add' | 'edit'
  employeeId: string
  balance?: LeaveBalance
  onClose: () => void
  onSuccess: () => void
}

function BalanceModal({ mode, employeeId, balance, onClose, onSuccess }: BalanceModalProps) {
  const currentYear = new Date().getFullYear()

  const [year, setYear] = useState<string>(balance ? String(balance.year) : String(currentYear))
  const [leaveTypeId, setLeaveTypeId] = useState<string>('')
  const [totalDays, setTotalDays] = useState<string>(balance ? String(balance.totalDays) : '')
  const [reason, setReason] = useState('')

  const [leaveTypes, setLeaveTypes] = useState<LeaveType[] | null>(null)
  const [loadingTypes, setLoadingTypes] = useState(mode === 'add')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Fetch leave types on mount — only needed in "add" mode
  useEffect(() => {
    if (mode !== 'add') return
    fetch('/api/hr/leave-types')
      .then((r) => r.json())
      .then((data: LeaveType[]) => {
        setLeaveTypes(data)
        setLoadingTypes(false)
      })
      .catch(() => {
        setError('Błąd ładowania typów urlopów')
        setLoadingTypes(false)
      })
  }, [mode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const yearNum = parseInt(year, 10)
    const daysNum = parseFloat(totalDays)

    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      setError('Nieprawidłowy rok (2000–2100)')
      return
    }
    if (isNaN(daysNum) || daysNum < 0) {
      setError('Liczba dni musi być nieujemna')
      return
    }
    if (mode === 'add' && !leaveTypeId) {
      setError('Wybierz typ urlopu')
      return
    }
    const normalizedReason = reason.trim()
    if (mode === 'edit' && (normalizedReason.length < 3 || normalizedReason.length > 1000)) {
      setError('Powód korekty musi mieć od 3 do 1000 znaków')
      return
    }

    startTransition(async () => {
      try {
        let res: Response
        if (mode === 'add') {
          res = await fetch('/api/hr/leave-balances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employeeId,
              leaveTypeId,
              year: yearNum,
              totalDays: daysNum,
            }),
          })
        } else {
          res = await fetch(`/api/hr/leave-balances/${balance!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ totalDays: daysNum, reason: normalizedReason }),
          })
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(
            (data as { error?: string }).error ??
              (res.status === 409
                ? 'Saldo dla tego typu i roku już istnieje'
                : 'Błąd zapisu')
          )
          return
        }

        onSuccess()
      } catch {
        setError('Błąd połączenia z serwerem')
      }
    })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'add' ? 'Dodaj saldo urlopowe' : 'Edytuj saldo urlopowe'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {mode === 'add'
              ? 'Uzupełnij dane nowego salda urlopowego.'
              : 'Zmień saldo i podaj wymagany powód korekty.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Leave type — only for "add" */}
          {mode === 'add' && (
            <div className="space-y-1.5">
              <Label htmlFor="leaveTypeId">Typ urlopu</Label>
              {loadingTypes ? (
                <div className="flex items-center gap-2 text-sm text-[var(--wd-text-muted)]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Ładowanie…
                </div>
              ) : (
                <select
                  id="leaveTypeId"
                  value={leaveTypeId}
                  onChange={(e) => setLeaveTypeId(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                >
                  <option value="">— wybierz typ —</option>
                  {(leaveTypes ?? []).map((lt: LeaveType) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Edit mode — show type name as read-only */}
          {mode === 'edit' && (
            <div className="space-y-1.5">
              <Label>Typ urlopu</Label>
              <p className="text-sm font-medium text-[var(--wd-text-primary)] py-2">
                {balance?.leaveType.name}
              </p>
            </div>
          )}

          {/* Year */}
          <div className="space-y-1.5">
            <Label htmlFor="year">Rok</Label>
            <Input
              id="year"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              required
            />
          </div>

          {/* Total days */}
          <div className="space-y-1.5">
            <Label htmlFor="totalDays">Dni urlopowe (łącznie)</Label>
            <Input
              id="totalDays"
              type="number"
              min={0}
              step={0.5}
              value={totalDays}
              onChange={(e) => setTotalDays(e.target.value)}
              placeholder="np. 26"
              required
            />
            {mode === 'edit' && balance && (
              <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                Wykorzystano: {balance.usedDays} dni
                {balance.pendingDays > 0 ? ` + ${balance.pendingDays} oczekujących` : ''}
              </p>
            )}
          </div>

          {mode === 'edit' && (
            <div className="space-y-1.5">
              <Label htmlFor="balanceCorrectionReason">Powód korekty</Label>
              <Input
                id="balanceCorrectionReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
                maxLength={1000}
                required
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Anuluj
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              {mode === 'add' ? 'Dodaj' : 'Zapisz'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LeaveTabClient({
  employeeId,
  balances,
  requests,
  canEditBalance,
}: LeaveTabClientProps) {
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)
  const [editBalance, setEditBalance] = useState<LeaveBalance | null>(null)

  function handleSuccess() {
    setAddOpen(false)
    setEditBalance(null)
    router.refresh()
  }

  const hasData = balances.length > 0 || requests.length > 0

  if (!hasData) {
    return (
      <>
        <EmptyState
          canEditBalance={canEditBalance}
          onAdd={() => setAddOpen(true)}
        />
        {addOpen && (
          <BalanceModal
            mode="add"
            employeeId={employeeId}
            onClose={() => setAddOpen(false)}
            onSuccess={handleSuccess}
          />
        )}
      </>
    )
  }

  return (
    <div className="space-y-8">
      {/* Balances section */}
      {balances.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-[var(--wd-text-primary)]">Saldo urlopowe</h3>
            {canEditBalance && (
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                <Plus className="w-3.5 h-3.5" />
                Dodaj saldo
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {balances.map((b) => {
              const used = b.usedDays + b.pendingDays
              const pct = b.totalDays > 0 ? Math.min(100, (used / b.totalDays) * 100) : 0
              return (
                <div key={b.id} className="p-4 rounded-lg border border-[var(--wd-border)] bg-white">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--wd-text-primary)]">
                        {b.leaveType.name}
                      </span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ background: 'var(--wd-surface-2)', color: 'var(--wd-text-muted)' }}
                      >
                        {b.year}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm num" style={{ color: 'var(--wd-text-muted)' }}>
                        {b.usedDays} / {b.totalDays} dni
                      </span>
                      {canEditBalance && (
                        <button
                          onClick={() => setEditBalance(b)}
                          className="p-1 rounded hover:bg-[var(--wd-surface-2)] text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)] transition-colors"
                          title="Edytuj saldo"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="w-full h-2 rounded-full" style={{ background: 'var(--wd-surface-2)' }}>
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct > 80 ? '#EF4444' : pct > 60 ? '#F59E0B' : '#10B981',
                      }}
                    />
                  </div>
                  {b.pendingDays > 0 && (
                    <p className="text-xs mt-1" style={{ color: 'var(--wd-text-muted)' }}>
                      {b.pendingDays} dni oczekuje na zatwierdzenie
                    </p>
                  )}
                  {b.carriedOver > 0 && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
                      Przeniesiono z poprzedniego roku: {b.carriedOver} dni
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* No balances yet but has requests — show add button */}
      {balances.length === 0 && canEditBalance && (
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--wd-text-primary)]">Saldo urlopowe</h3>
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="w-3.5 h-3.5" />
            Dodaj saldo
          </Button>
        </div>
      )}

      {/* Recent leave requests */}
      {requests.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-[var(--wd-text-primary)] mb-4">Ostatnie wnioski</h3>
          <div className="space-y-2">
            {requests.slice(0, 10).map((r) => {
              const fmt = (d: string) =>
                new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short' }).format(new Date(d))
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-[var(--wd-border)]"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--wd-text-primary)]">{r.leaveType.name}</p>
                    <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                      {fmt(r.startDate)} – {fmt(r.endDate)} ({r.days}{' '}
                      {r.days === 1 ? 'dzień' : 'dni'})
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                      STATUS_STYLES[r.status] ?? STATUS_STYLES.cancelled
                    }`}
                  >
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      {addOpen && (
        <BalanceModal
          mode="add"
          employeeId={employeeId}
          onClose={() => setAddOpen(false)}
          onSuccess={handleSuccess}
        />
      )}
      {editBalance && (
        <BalanceModal
          mode="edit"
          employeeId={employeeId}
          balance={editBalance}
          onClose={() => setEditBalance(null)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}
