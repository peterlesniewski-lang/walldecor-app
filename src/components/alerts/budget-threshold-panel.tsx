'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, AlertOctagon, Plus, Trash2, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SubCategory {
  id: string
  name: string
  categoryId: string
}

interface AccountCategory {
  id: string
  name: string
  subCategories: SubCategory[]
}

interface CostCenter {
  id: string
  name: string
}

interface BudgetThreshold {
  id: string
  name: string
  warningPercent: number
  criticalPercent: number
  costCenterId: string | null
  subCategoryId: string | null
  active: boolean
  costCenter: CostCenter | null
  subCategory: { id: string; name: string } | null
}

const COST_CENTERS = ['JAG', 'PUL', 'GLOBAL']

export function BudgetThresholdPanel() {
  const [thresholds, setThresholds] = useState<BudgetThreshold[]>([])
  const [categories, setCategories] = useState<AccountCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    warningPercent: 80,
    criticalPercent: 100,
    costCenterId: '',
    subCategoryId: '',
  })

  const fetchThresholds = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts/thresholds')
      if (res.ok) {
        const data: BudgetThreshold[] = await res.json()
        setThresholds(data)
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories')
      if (res.ok) {
        const data: AccountCategory[] = await res.json()
        setCategories(data)
      }
    } catch {
      // silently fail
    }
  }, [])

  useEffect(() => {
    fetchThresholds()
    fetchCategories()
  }, [fetchThresholds, fetchCategories])

  const allSubCategories = categories.flatMap((cat) =>
    cat.subCategories.map((sub) => ({ ...sub, categoryName: cat.name }))
  )

  const handleToggleActive = async (threshold: BudgetThreshold) => {
    const optimistic = thresholds.map((t) =>
      t.id === threshold.id ? { ...t, active: !t.active } : t
    )
    setThresholds(optimistic)

    const res = await fetch(`/api/alerts/thresholds/${threshold.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !threshold.active }),
    })
    if (!res.ok) {
      // revert
      setThresholds(thresholds)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Usunąć ten próg?')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/alerts/thresholds/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setThresholds((prev) => prev.filter((t) => t.id !== id))
      }
    } finally {
      setDeletingId(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (form.warningPercent >= form.criticalPercent) {
      setError('Próg ostrzeżenia musi być niższy niż próg krytyczny')
      return
    }

    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        warningPercent: form.warningPercent,
        criticalPercent: form.criticalPercent,
      }
      if (form.costCenterId) body.costCenterId = form.costCenterId
      if (form.subCategoryId) body.subCategoryId = form.subCategoryId

      const res = await fetch('/api/alerts/thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const created: BudgetThreshold = await res.json()
        setThresholds((prev) => [...prev, created])
        setForm({ name: '', warningPercent: 80, criticalPercent: 100, costCenterId: '', subCategoryId: '' })
        setShowForm(false)
      } else {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Błąd zapisu')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border" style={{ borderColor: 'var(--wd-border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--wd-border)' }}>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--wd-text-primary)' }}>
            Progi budżetowe
          </h2>
        </div>
        <Button
          size="sm"
          onClick={() => { setShowForm((v) => !v); setError(null) }}
          className="h-7 px-3 text-xs gap-1.5 bg-[#1E1E1E] text-white hover:bg-[#333]"
        >
          <Plus className="h-3.5 w-3.5" />
          Dodaj próg
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="px-5 py-4 border-b bg-[var(--wd-off-white)]" style={{ borderColor: 'var(--wd-border)' }}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-text-muted)' }}>
                Nazwa progu
              </label>
              <input
                required
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="np. Koszty marketingu JAG"
                className="w-full h-8 rounded-lg border px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] bg-white"
                style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-text-muted)' }}>
                Ostrzeżenie (%)
              </label>
              <input
                required
                type="number"
                min={1}
                max={199}
                value={form.warningPercent}
                onChange={(e) => setForm((f) => ({ ...f, warningPercent: parseInt(e.target.value) || 80 }))}
                className="w-full h-8 rounded-lg border px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] bg-white"
                style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-text-muted)' }}>
                Krytyczny (%)
              </label>
              <input
                required
                type="number"
                min={2}
                max={200}
                value={form.criticalPercent}
                onChange={(e) => setForm((f) => ({ ...f, criticalPercent: parseInt(e.target.value) || 100 }))}
                className="w-full h-8 rounded-lg border px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] bg-white"
                style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-text-muted)' }}>
                Centrum kosztów
              </label>
              <select
                value={form.costCenterId}
                onChange={(e) => setForm((f) => ({ ...f, costCenterId: e.target.value }))}
                className="w-full h-8 rounded-lg border px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] bg-white"
                style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-text-primary)' }}
              >
                <option value="">Wszystkie</option>
                {COST_CENTERS.map((cc) => (
                  <option key={cc} value={cc}>{cc}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--wd-text-muted)' }}>
                Podkategoria
              </label>
              <select
                value={form.subCategoryId}
                onChange={(e) => setForm((f) => ({ ...f, subCategoryId: e.target.value }))}
                className="w-full h-8 rounded-lg border px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] bg-white"
                style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-text-primary)' }}
              >
                <option value="">Wszystkie</option>
                {allSubCategories.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.categoryName} / {sub.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
          <div className="flex gap-2 mt-3">
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="h-7 px-4 text-xs bg-[#1E1E1E] text-white hover:bg-[#333]"
            >
              {submitting && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              Zapisz
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => { setShowForm(false); setError(null) }}
              className="h-7 px-3 text-xs"
              style={{ color: 'var(--wd-text-muted)' }}
            >
              Anuluj
            </Button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--wd-text-muted)' }} />
          </div>
        ) : thresholds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <ShieldAlert className="h-7 w-7" style={{ color: 'var(--wd-text-muted)' }} />
            <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
              Brak progów budżetowych
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--wd-border)' }}>
                {['Nazwa', 'Centrum', 'Podkategoria', 'Ostrzeż.', 'Krytycz.', 'Aktywny', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left font-medium"
                    style={{ color: 'var(--wd-text-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {thresholds.map((threshold) => (
                <tr
                  key={threshold.id}
                  className={cn(
                    'border-b last:border-0 transition-colors hover:bg-[var(--wd-off-white)]',
                    !threshold.active && 'opacity-50'
                  )}
                  style={{ borderColor: 'var(--wd-border)' }}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--wd-text-primary)' }}>
                    {threshold.name}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--wd-text-muted)' }}>
                    {threshold.costCenter?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--wd-text-muted)' }}>
                    {threshold.subCategory?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                      <AlertTriangle className="h-3 w-3" />
                      {threshold.warningPercent}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                      <AlertOctagon className="h-3 w-3" />
                      {threshold.criticalPercent}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(threshold)}
                      className={cn(
                        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
                        threshold.active ? 'bg-emerald-500' : 'bg-gray-200'
                      )}
                      aria-label={threshold.active ? 'Dezaktywuj' : 'Aktywuj'}
                    >
                      <span
                        className={cn(
                          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
                          threshold.active ? 'translate-x-4' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(threshold.id)}
                      disabled={deletingId === threshold.id}
                      className="text-red-500 hover:text-red-700 transition-colors disabled:opacity-40"
                      aria-label="Usuń"
                    >
                      {deletingId === threshold.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />
                      }
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
