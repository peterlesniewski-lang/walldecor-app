'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, PowerOff, ChevronRight, Loader2, X, Check } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveType {
  id: string
  name: string
  code: string
  color: string
  isPaid: boolean
  requiresApproval: boolean
  maxDaysPerYear: number | null
  isActive: boolean
  parentId: string | null
  subtypes: LeaveType[]
  _count: {
    leaveBalancesNew: number
    leaveRequestsNew: number
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  { hex: '#3B82F6', label: 'Niebieski' },
  { hex: '#10B981', label: 'Zielony' },
  { hex: '#F59E0B', label: 'Żółty' },
  { hex: '#EF4444', label: 'Czerwony' },
  { hex: '#8B5CF6', label: 'Fioletowy' },
  { hex: '#F97316', label: 'Pomarańczowy' },
]

// ─── Modal ─────────────────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editing: LeaveType | null
  parentOptions: Array<{ id: string; name: string; code: string }>
}

function LeaveTypeModal({ open, onClose, onSaved, editing, parentOptions }: ModalProps) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [color, setColor] = useState('#3B82F6')
  const [isPaid, setIsPaid] = useState(true)
  const [requiresApproval, setRequiresApproval] = useState(true)
  const [maxDays, setMaxDays] = useState('')
  const [parentId, setParentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (editing) {
      setName(editing.name)
      setCode(editing.code)
      setColor(editing.color)
      setIsPaid(editing.isPaid)
      setRequiresApproval(editing.requiresApproval)
      setMaxDays(editing.maxDaysPerYear ? String(editing.maxDaysPerYear) : '')
      setParentId(editing.parentId ?? '')
    } else {
      setName('')
      setCode('')
      setColor('#3B82F6')
      setIsPaid(true)
      setRequiresApproval(true)
      setMaxDays('')
      setParentId('')
    }
    setError('')
  }, [editing, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const body = {
      name: name.trim(),
      code: code.trim().toUpperCase(),
      color,
      isPaid,
      requiresApproval,
      maxDaysPerYear: maxDays ? parseInt(maxDays, 10) : undefined,
      parentId: parentId || undefined,
    }

    try {
      const url = editing ? `/api/hr/leave-types/${editing.id}` : '/api/hr/leave-types'
      const method = editing ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Wystąpił błąd')
        return
      }

      onSaved()
      onClose()
    } catch {
      setError('Błąd połączenia z serwerem')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-xl shadow-2xl"
        style={{ background: 'var(--wd-white)', border: '1px solid var(--wd-border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <h2 className="font-semibold text-[var(--wd-text-primary)]">
            {editing ? 'Edytuj typ urlopu' : 'Dodaj typ urlopu'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--wd-surface-2)] text-[var(--wd-text-muted)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5 uppercase tracking-wide">
              Nazwa
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
              placeholder="np. Urlop wypoczynkowy"
            />
          </div>

          {/* Code */}
          <div>
            <label className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5 uppercase tracking-wide">
              Kod
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              maxLength={20}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition font-mono uppercase"
              placeholder="np. VL"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5 uppercase tracking-wide">
              Kolor
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  title={c.label}
                  onClick={() => setColor(c.hex)}
                  className="relative w-7 h-7 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[var(--wd-sand)]"
                  style={{ backgroundColor: c.hex }}
                >
                  {color === c.hex && (
                    <Check size={12} className="absolute inset-0 m-auto text-white" strokeWidth={3} />
                  )}
                </button>
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                title="Własny kolor"
                className="w-7 h-7 rounded-full cursor-pointer border border-[var(--wd-border)] p-0 overflow-hidden"
              />
              <span className="text-xs font-mono text-[var(--wd-text-muted)]">{color}</span>
            </div>
          </div>

          {/* Toggles row */}
          <div className="flex gap-4">
            {/* isPaid */}
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                onClick={() => setIsPaid(!isPaid)}
                className="relative w-9 h-5 rounded-full transition-colors cursor-pointer"
                style={{ background: isPaid ? 'var(--wd-sand)' : 'var(--wd-border)' }}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ left: isPaid ? '18px' : '2px' }}
                />
              </div>
              <span className="text-sm text-[var(--wd-text-primary)]">Płatny</span>
            </label>

            {/* requiresApproval */}
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                onClick={() => setRequiresApproval(!requiresApproval)}
                className="relative w-9 h-5 rounded-full transition-colors cursor-pointer"
                style={{ background: requiresApproval ? 'var(--wd-sand)' : 'var(--wd-border)' }}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ left: requiresApproval ? '18px' : '2px' }}
                />
              </div>
              <span className="text-sm text-[var(--wd-text-primary)]">Wymaga akceptacji</span>
            </label>
          </div>

          {/* Max days */}
          <div>
            <label className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5 uppercase tracking-wide">
              Maks. dni w roku <span className="normal-case font-normal">(opcjonalnie)</span>
            </label>
            <input
              type="number"
              value={maxDays}
              onChange={(e) => setMaxDays(e.target.value)}
              min={1}
              max={365}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
              placeholder="np. 26"
            />
          </div>

          {/* Parent */}
          <div>
            <label className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5 uppercase tracking-wide">
              Typ nadrzędny <span className="normal-case font-normal">(opcjonalnie)</span>
            </label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] transition"
            >
              <option value="">— brak (typ główny) —</option>
              {parentOptions
                .filter((p) => p.id !== editing?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.code}] {p.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-200">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--wd-border)] text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)] transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--wd-dark)] text-white hover:bg-[#2E2E2E] disabled:opacity-50 transition-colors"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {editing ? 'Zapisz zmiany' : 'Dodaj typ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Leave Type Row ────────────────────────────────────────────────────────────

function LeaveTypeRow({
  type,
  indent,
  onEdit,
  onDeactivate,
}: {
  type: LeaveType
  indent: boolean
  onEdit: (t: LeaveType) => void
  onDeactivate: (t: LeaveType) => void
}) {
  return (
    <tr className={!type.isActive ? 'opacity-50' : ''}>
      <td>
        <div className="flex items-center gap-2.5" style={{ paddingLeft: indent ? '1.75rem' : '0' }}>
          {indent && <ChevronRight size={12} className="text-[var(--wd-text-muted)] shrink-0" />}
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: type.color }}
          />
          <span className="font-mono text-xs font-bold text-[var(--wd-text-muted)] uppercase">
            {type.code}
          </span>
        </div>
      </td>
      <td>
        <span className="text-sm font-medium text-[var(--wd-text-primary)]">{type.name}</span>
      </td>
      <td>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
            type.isPaid
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-stone-50 text-stone-600 border-stone-200'
          }`}
        >
          {type.isPaid ? 'Płatny' : 'Bezpłatny'}
        </span>
      </td>
      <td>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
            type.requiresApproval
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-stone-50 text-stone-500 border-stone-200'
          }`}
        >
          {type.requiresApproval ? 'Wymaga akc.' : 'Automatyczny'}
        </span>
      </td>
      <td>
        <span className="text-sm text-[var(--wd-text-muted)]">
          {type.maxDaysPerYear ? `${type.maxDaysPerYear} dni` : '—'}
        </span>
      </td>
      <td>
        <span className="text-xs text-[var(--wd-text-muted)]">
          {type._count.leaveBalancesNew} sald · {type._count.leaveRequestsNew} wniosków
        </span>
      </td>
      <td>
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={() => onEdit(type)}
            className="p-1.5 rounded-md text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)] hover:text-[var(--wd-text-primary)] transition-colors"
            title="Edytuj"
          >
            <Pencil size={14} />
          </button>
          {type.isActive && (
            <button
              onClick={() => onDeactivate(type)}
              className="p-1.5 rounded-md text-[var(--wd-text-muted)] hover:bg-red-50 hover:text-red-600 transition-colors"
              title="Dezaktywuj"
            >
              <PowerOff size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeaveTypesPage() {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<LeaveType | null>(null)
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const [deactivateError, setDeactivateError] = useState<string | null>(null)

  const fetchTypes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/hr/leave-types')
      if (res.ok) {
        const data = await res.json() as LeaveType[]
        setLeaveTypes(data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTypes()
  }, [fetchTypes])

  const handleEdit = (type: LeaveType) => {
    setEditing(type)
    setModalOpen(true)
  }

  const handleAdd = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const handleDeactivate = async (type: LeaveType) => {
    if (!confirm(`Dezaktywować typ urlopu "${type.name}"?`)) return
    setDeactivating(type.id)
    setDeactivateError(null)
    try {
      const res = await fetch(`/api/hr/leave-types/${type.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setDeactivateError(data.error ?? 'Nie udało się dezaktywować')
      } else {
        await fetchTypes()
      }
    } catch {
      setDeactivateError('Błąd połączenia z serwerem')
    } finally {
      setDeactivating(null)
    }
  }

  // Only top-level types (no parent) for the modal parent select
  const topLevelTypes = leaveTypes.filter((t) => t.parentId === null)

  // Render: top-level types first, then each type's subtypes inline
  const rows: Array<{ type: LeaveType; indent: boolean }> = []
  for (const type of leaveTypes.filter((t) => t.parentId === null)) {
    rows.push({ type, indent: false })
    for (const sub of type.subtypes) {
      rows.push({ type: sub, indent: true })
    }
  }

  const activeCount = leaveTypes.filter((t) => t.isActive).length

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--wd-text-primary)]">Typy urlopów</h1>
          <p className="text-sm mt-0.5 text-[var(--wd-text-muted)]">
            {activeCount} aktywnych typów urlopów
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--wd-dark)] text-white hover:bg-[#2E2E2E] transition-colors"
        >
          <Plus size={16} />
          Dodaj typ urlopu
        </button>
      </div>

      {/* Error banner */}
      {deactivateError && (
        <div className="mb-4 flex items-center justify-between px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <span>{deactivateError}</span>
          <button onClick={() => setDeactivateError(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Card */}
      <div className="bg-white border border-[var(--wd-border)] rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center gap-2 text-[var(--wd-text-muted)]">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Ładowanie...</span>
          </div>
        ) : leaveTypes.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-[var(--wd-text-muted)]">
              Brak typów urlopów. Dodaj pierwszy typ.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kod</th>
                  <th>Nazwa</th>
                  <th>Opłacalność</th>
                  <th>Akceptacja</th>
                  <th>Limit roczny</th>
                  <th>Użycie</th>
                  <th className="text-right">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ type, indent }) => (
                  <LeaveTypeRow
                    key={type.id}
                    type={type}
                    indent={indent}
                    onEdit={handleEdit}
                    onDeactivate={handleDeactivate}
                  />
                ))}
              </tbody>
            </table>
            {deactivating && (
              <div className="flex items-center justify-center gap-2 py-3 text-xs text-[var(--wd-text-muted)] border-t border-[var(--wd-border)]">
                <Loader2 size={12} className="animate-spin" />
                Dezaktywowanie...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      <LeaveTypeModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setEditing(null)
        }}
        onSaved={fetchTypes}
        editing={editing}
        parentOptions={topLevelTypes}
      />
    </div>
  )
}
