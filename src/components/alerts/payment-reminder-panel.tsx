'use client'

import { useState, useEffect, useCallback } from 'react'
import { CreditCard, Plus, Trash2, Loader2, Pencil, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CostCenter {
  id: string
  name: string
}

interface PaymentReminder {
  id: string
  name: string
  amount: number
  dayOfMonth: number
  costCenterId: string
  costCenter: CostCenter
  alertDaysInAdvance: number
  active: boolean
  lastAlertedDate: string | null
}

const COST_CENTERS = ['JAG', 'PUL', 'GLOBAL']

function fmtAmount(amount: number) {
  return amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type FormState = {
  name: string
  amount: string
  dayOfMonth: string
  costCenterId: string
  alertDaysInAdvance: string
  active: boolean
}

const DEFAULT_FORM: FormState = {
  name: '',
  amount: '',
  dayOfMonth: '',
  costCenterId: 'JAG',
  alertDaysInAdvance: '3',
  active: true,
}

export function PaymentReminderPanel() {
  const [reminders, setReminders] = useState<PaymentReminder[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [editForm, setEditForm] = useState<FormState>(DEFAULT_FORM)

  const fetchReminders = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts/payment-reminders')
      if (res.ok) {
        const data: PaymentReminder[] = await res.json()
        setReminders(data)
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReminders()
  }, [fetchReminders])

  const handleToggleActive = async (reminder: PaymentReminder) => {
    const optimistic = reminders.map((r) =>
      r.id === reminder.id ? { ...r, active: !r.active } : r
    )
    setReminders(optimistic)

    const res = await fetch(`/api/alerts/payment-reminders/${reminder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !reminder.active }),
    })
    if (!res.ok) {
      setReminders(reminders)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Usunąć to przypomnienie?')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/alerts/payment-reminders/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setReminders((prev) => prev.filter((r) => r.id !== id))
      }
    } finally {
      setDeletingId(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const body = {
        name: form.name,
        amount: parseFloat(form.amount),
        dayOfMonth: parseInt(form.dayOfMonth),
        costCenterId: form.costCenterId,
        alertDaysInAdvance: parseInt(form.alertDaysInAdvance),
        active: form.active,
      }
      const res = await fetch('/api/alerts/payment-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const created: PaymentReminder = await res.json()
        setReminders((prev) => [...prev, created])
        setForm(DEFAULT_FORM)
        setShowForm(false)
      } else {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Błąd zapisu')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = (reminder: PaymentReminder) => {
    setEditingId(reminder.id)
    setEditForm({
      name: reminder.name,
      amount: reminder.amount.toString(),
      dayOfMonth: reminder.dayOfMonth.toString(),
      costCenterId: reminder.costCenterId,
      alertDaysInAdvance: reminder.alertDaysInAdvance.toString(),
      active: reminder.active,
    })
  }

  const handleSaveEdit = async (id: string) => {
    setError(null)
    setSubmitting(true)
    try {
      const body = {
        name: editForm.name,
        amount: parseFloat(editForm.amount),
        dayOfMonth: parseInt(editForm.dayOfMonth),
        costCenterId: editForm.costCenterId,
        alertDaysInAdvance: parseInt(editForm.alertDaysInAdvance),
        active: editForm.active,
      }
      const res = await fetch(`/api/alerts/payment-reminders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const updated: PaymentReminder = await res.json()
        setReminders((prev) => prev.map((r) => r.id === id ? updated : r))
        setEditingId(null)
      } else {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Błąd zapisu')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = "w-full h-8 rounded-lg border px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] bg-white"
  const inputStyle = { borderColor: 'var(--wd-border)', color: 'var(--wd-text-primary)' }

  return (
    <div className="bg-white rounded-xl border" style={{ borderColor: 'var(--wd-border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--wd-border)' }}>
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--wd-text-primary)' }}>
            Terminy płatności
          </h2>
        </div>
        <Button
          size="sm"
          onClick={() => { setShowForm((v) => !v); setError(null) }}
          className="h-7 px-3 text-xs gap-1.5 bg-[#1E1E1E] text-white hover:bg-[#333]"
        >
          <Plus className="h-3.5 w-3.5" />
          Dodaj
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="px-5 py-4 border-b bg-[var(--wd-off-white)]" style={{ borderColor: 'var(--wd-border)' }}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-text-muted)' }}>Nazwa</label>
              <input required type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="np. Czynsz JAG" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-text-muted)' }}>Kwota (PLN)</label>
              <input required type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-text-muted)' }}>Dzień miesiąca (1–31)</label>
              <input required type="number" min={1} max={31} value={form.dayOfMonth} onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))}
                placeholder="1" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-text-muted)' }}>Centrum kosztów</label>
              <select value={form.costCenterId} onChange={(e) => setForm((f) => ({ ...f, costCenterId: e.target.value }))}
                className={inputCls} style={inputStyle}>
                {COST_CENTERS.map((cc) => <option key={cc} value={cc}>{cc}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-text-muted)' }}>Powiadom X dni wcześniej</label>
              <input required type="number" min={1} max={30} value={form.alertDaysInAdvance} onChange={(e) => setForm((f) => ({ ...f, alertDaysInAdvance: e.target.value }))}
                className={inputCls} style={inputStyle} />
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 mt-3">
            <Button type="submit" size="sm" disabled={submitting} className="h-7 px-4 text-xs bg-[#1E1E1E] text-white hover:bg-[#333]">
              {submitting && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              Zapisz
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setShowForm(false); setError(null) }}
              className="h-7 px-3 text-xs" style={{ color: 'var(--wd-text-muted)' }}>
              Anuluj
            </Button>
          </div>
        </form>
      )}

      {/* List */}
      <div>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--wd-text-muted)' }} />
          </div>
        ) : reminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <CreditCard className="h-7 w-7" style={{ color: 'var(--wd-text-muted)' }} />
            <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>Brak przypomnień o płatnościach</p>
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--wd-border)' }}>
            {reminders.map((reminder) => (
              <li
                key={reminder.id}
                className={cn('px-5 py-3.5 transition-colors hover:bg-[var(--wd-off-white)]', !reminder.active && 'opacity-50')}
              >
                {editingId === reminder.id ? (
                  // Inline edit row
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="col-span-2">
                      <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className={inputCls} style={inputStyle} placeholder="Nazwa" />
                    </div>
                    <input type="number" min={0} step="0.01" value={editForm.amount}
                      onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                      className={inputCls} style={inputStyle} placeholder="Kwota PLN" />
                    <input type="number" min={1} max={31} value={editForm.dayOfMonth}
                      onChange={(e) => setEditForm((f) => ({ ...f, dayOfMonth: e.target.value }))}
                      className={inputCls} style={inputStyle} placeholder="Dzień" />
                    <select value={editForm.costCenterId} onChange={(e) => setEditForm((f) => ({ ...f, costCenterId: e.target.value }))}
                      className={inputCls} style={inputStyle}>
                      {COST_CENTERS.map((cc) => <option key={cc} value={cc}>{cc}</option>)}
                    </select>
                    <input type="number" min={1} max={30} value={editForm.alertDaysInAdvance}
                      onChange={(e) => setEditForm((f) => ({ ...f, alertDaysInAdvance: e.target.value }))}
                      className={inputCls} style={inputStyle} placeholder="Dni wcześniej" />
                    {error && <p className="col-span-2 text-xs text-red-600">{error}</p>}
                    <div className="col-span-2 flex gap-2 mt-1">
                      <button onClick={() => handleSaveEdit(reminder.id)} disabled={submitting}
                        className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-800 disabled:opacity-40">
                        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Zapisz
                      </button>
                      <button onClick={() => { setEditingId(null); setError(null) }}
                        className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--wd-text-muted)' }}>
                        <X className="h-3.5 w-3.5" />
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold truncate" style={{ color: 'var(--wd-text-primary)' }}>
                          {reminder.name}
                        </span>
                        <span className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                          {reminder.costCenter.name}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[11px]" style={{ color: 'var(--wd-text-muted)' }}>
                        <span className="font-medium" style={{ color: 'var(--wd-text-primary)' }}>
                          {fmtAmount(reminder.amount)} PLN
                        </span>
                        <span>·</span>
                        <span>{reminder.dayOfMonth}. dnia miesiąca</span>
                        <span>·</span>
                        <span>powiadom {reminder.alertDaysInAdvance} dni wcześniej</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleToggleActive(reminder)}
                        className={cn(
                          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
                          reminder.active ? 'bg-emerald-500' : 'bg-gray-200'
                        )}
                        aria-label={reminder.active ? 'Dezaktywuj' : 'Aktywuj'}
                      >
                        <span
                          className={cn(
                            'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
                            reminder.active ? 'translate-x-4' : 'translate-x-1'
                          )}
                        />
                      </button>
                      <button
                        onClick={() => startEdit(reminder)}
                        className="text-gray-400 hover:text-gray-700 transition-colors"
                        aria-label="Edytuj"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(reminder.id)}
                        disabled={deletingId === reminder.id}
                        className="text-red-500 hover:text-red-700 transition-colors disabled:opacity-40"
                        aria-label="Usuń"
                      >
                        {deletingId === reminder.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
