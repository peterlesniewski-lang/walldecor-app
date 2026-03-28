'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Building2, Layers, Tag, X } from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────

interface Department {
  id: string
  name: string
  divisionId: string
  _count: { employees: number }
  employees?: { id: string; firstName: string; lastName: string; position: string }[]
}

interface Division {
  id: string
  name: string
  costCenterId: string | null
  _count: { employees: number }
  departments: Department[]
}

interface Position {
  id: string
  name: string
  _count: { employees: number }
}

// ─── Modal ─────────────────────────────────────────────────────────────────

interface ModalProps {
  title: string
  onClose: () => void
  onSubmit: (data: Record<string, string>) => Promise<void>
  children: React.ReactNode
  loading: boolean
  error: string | null
}

function Modal({ title, onClose, onSubmit, children, loading, error }: ModalProps) {
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const data: Record<string, string> = {}
    formData.forEach((val, key) => { if (val) data[key] = val as string })
    await onSubmit(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl border border-[var(--wd-border)] w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-[var(--wd-text-primary)]">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--wd-surface-2)] transition-colors text-[var(--wd-text-muted)]"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {children}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--wd-border)] text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)] transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--wd-dark)] text-white hover:bg-[#2E2E2E] transition-colors disabled:opacity-50"
            >
              {loading ? 'Zapisywanie…' : 'Zapisz'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Field helpers ──────────────────────────────────────────────────────────

function Field({ label, name, defaultValue, placeholder }: {
  label: string
  name: string
  defaultValue?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5">{label}</label>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required
        className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] placeholder:text-[var(--wd-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)] transition-colors"
      />
    </div>
  )
}

function SelectField({ label, name, defaultValue, options }: {
  label: string
  name: string
  defaultValue?: string
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--wd-text-muted)] mb-1.5">{label}</label>
      <select
        name={name}
        defaultValue={defaultValue ?? ''}
        className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)] transition-colors"
      >
        <option value="">Brak</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ─── Icon buttons ────────────────────────────────────────────────────────────

function IconBtn({ onClick, title, variant = 'default', children }: {
  onClick: (e: React.MouseEvent) => void
  title: string
  variant?: 'default' | 'danger'
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors ${
        variant === 'danger'
          ? 'text-[var(--wd-text-muted)] hover:text-red-600 hover:bg-red-50'
          : 'text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)] hover:bg-[var(--wd-surface-2)]'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Department row ──────────────────────────────────────────────────────────

interface DeptRowProps {
  dept: Department
  divisionId: string
  onEdit: (dept: Department) => void
  onDelete: (dept: Department) => void
}

function DeptRow({ dept, onEdit, onDelete }: DeptRowProps) {
  const [open, setOpen] = useState(false)
  const count = dept._count.employees

  return (
    <div>
      <div className="flex items-center gap-1.5 py-1.5 px-2 rounded-lg hover:bg-[var(--wd-surface-2)] group transition-colors">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          disabled={count === 0}
        >
          <span className="text-[var(--wd-text-muted)] w-4 shrink-0">
            {count > 0 ? (
              open ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : (
              <span className="w-3.5 h-3.5 block" />
            )}
          </span>
          <Layers size={13} className="text-[var(--wd-text-muted)] shrink-0" />
          <span className="text-sm text-[var(--wd-text-primary)] truncate">{dept.name}</span>
          <span className="text-xs text-[var(--wd-text-muted)] ml-1 shrink-0">({count})</span>
        </button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconBtn onClick={(e) => { e.stopPropagation(); onEdit(dept) }} title="Edytuj dział">
            <Pencil size={13} />
          </IconBtn>
          <IconBtn onClick={(e) => { e.stopPropagation(); onDelete(dept) }} title="Usuń dział" variant="danger">
            <Trash2 size={13} />
          </IconBtn>
        </div>
      </div>

      {open && dept.employees && dept.employees.length > 0 && (
        <div className="ml-8 mt-0.5 space-y-0.5">
          {dept.employees.map((emp) => (
            <div key={emp.id} className="flex items-center gap-2 py-1 px-2 text-sm">
              <span className="w-5 h-5 rounded-full bg-[var(--wd-dark)] text-white text-[9px] font-semibold flex items-center justify-center shrink-0">
                {emp.firstName[0]}{emp.lastName[0]}
              </span>
              <span className="text-[var(--wd-text-primary)]">{emp.firstName} {emp.lastName}</span>
              {emp.position && (
                <span className="text-xs text-[var(--wd-text-muted)]">· {emp.position}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

type ModalState =
  | { type: 'none' }
  | { type: 'add-division' }
  | { type: 'edit-division'; division: Division }
  | { type: 'delete-division'; division: Division }
  | { type: 'add-department'; divisionId: string }
  | { type: 'edit-department'; dept: Department }
  | { type: 'delete-department'; dept: Department }
  | { type: 'add-position' }
  | { type: 'edit-position'; position: Position }
  | { type: 'delete-position'; position: Position }

export function OrgStructureClient() {
  const [divisions, setDivisions] = useState<Division[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [expandedDivisions, setExpandedDivisions] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<ModalState>({ type: 'none' })
  const [loading, setLoading] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(true)

  const COST_CENTER_OPTIONS = [
    { value: 'JAG', label: 'JAG — Jagiellońska' },
    { value: 'PUL', label: 'PUL — Puławska' },
    { value: 'GLOBAL', label: 'GLOBAL' },
  ]

  const fetchAll = useCallback(async () => {
    setFetching(true)
    try {
      const [divRes, posRes] = await Promise.all([
        fetch('/api/hr/divisions'),
        fetch('/api/hr/positions'),
      ])
      if (divRes.ok) setDivisions(await divRes.json())
      if (posRes.ok) setPositions(await posRes.json())
    } finally {
      setFetching(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const toggleDivision = (id: string) => {
    setExpandedDivisions(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const closeModal = () => {
    setModal({ type: 'none' })
    setModalError(null)
  }

  // ─── Submit handlers ──────────────────────────────────────────────────────

  const handleSubmit = async (data: Record<string, string>) => {
    setLoading(true)
    setModalError(null)
    try {
      if (modal.type === 'add-division') {
        const res = await fetch('/api/hr/divisions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: data.name, costCenterId: data.costCenterId || undefined }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd')
      } else if (modal.type === 'edit-division') {
        const res = await fetch(`/api/hr/divisions/${modal.division.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: data.name, costCenterId: data.costCenterId || undefined }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd')
      } else if (modal.type === 'add-department') {
        const res = await fetch('/api/hr/departments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: data.name, divisionId: modal.divisionId }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd')
      } else if (modal.type === 'edit-department') {
        const res = await fetch(`/api/hr/departments/${modal.dept.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: data.name }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd')
      } else if (modal.type === 'add-position') {
        const res = await fetch('/api/hr/positions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: data.name }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd')
      } else if (modal.type === 'edit-position') {
        const res = await fetch(`/api/hr/positions/${modal.position.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: data.name }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd')
      }
      await fetchAll()
      closeModal()
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Błąd serwera')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    setModalError(null)
    try {
      let res: Response
      if (modal.type === 'delete-division') {
        res = await fetch(`/api/hr/divisions/${modal.division.id}`, { method: 'DELETE' })
      } else if (modal.type === 'delete-department') {
        res = await fetch(`/api/hr/departments/${modal.dept.id}`, { method: 'DELETE' })
      } else if (modal.type === 'delete-position') {
        res = await fetch(`/api/hr/positions/${modal.position.id}`, { method: 'DELETE' })
      } else return

      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Błąd')
      await fetchAll()
      closeModal()
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Błąd serwera')
    } finally {
      setLoading(false)
    }
  }

  // ─── Render modal content ─────────────────────────────────────────────────

  const renderModal = () => {
    if (modal.type === 'none') return null

    // Delete confirms
    if (modal.type === 'delete-division' || modal.type === 'delete-department' || modal.type === 'delete-position') {
      const name =
        modal.type === 'delete-division' ? modal.division.name :
        modal.type === 'delete-department' ? modal.dept.name :
        modal.position.name
      const label =
        modal.type === 'delete-division' ? 'oddział' :
        modal.type === 'delete-department' ? 'dział' :
        'stanowisko'

      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-white rounded-xl shadow-xl border border-[var(--wd-border)] w-full max-w-sm mx-4 p-6">
            <h2 className="text-base font-semibold text-[var(--wd-text-primary)] mb-3">Usuń {label}</h2>
            {modalError && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {modalError}
              </div>
            )}
            <p className="text-sm text-[var(--wd-text-muted)] mb-5">
              Czy na pewno chcesz usunąć <span className="font-medium text-[var(--wd-text-primary)]">{name}</span>?
              Operacja jest nieodwracalna.
            </p>
            <div className="flex gap-2">
              <button
                onClick={closeModal}
                className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--wd-border)] text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)] transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Usuwanie…' : 'Usuń'}
              </button>
            </div>
          </div>
        </div>
      )
    }

    // Form modals
    if (modal.type === 'add-division') {
      return (
        <Modal title="Nowy oddział" onClose={closeModal} onSubmit={handleSubmit} loading={loading} error={modalError}>
          <Field label="Nazwa oddziału" name="name" placeholder="np. Oddział Jagiellońska" />
          <SelectField label="Centrum kosztów" name="costCenterId" options={COST_CENTER_OPTIONS} />
        </Modal>
      )
    }
    if (modal.type === 'edit-division') {
      return (
        <Modal title="Edytuj oddział" onClose={closeModal} onSubmit={handleSubmit} loading={loading} error={modalError}>
          <Field label="Nazwa oddziału" name="name" defaultValue={modal.division.name} />
          <SelectField
            label="Centrum kosztów"
            name="costCenterId"
            defaultValue={modal.division.costCenterId ?? ''}
            options={COST_CENTER_OPTIONS}
          />
        </Modal>
      )
    }
    if (modal.type === 'add-department' || modal.type === 'edit-department') {
      const isEdit = modal.type === 'edit-department'
      return (
        <Modal
          title={isEdit ? 'Edytuj dział' : 'Nowy dział'}
          onClose={closeModal}
          onSubmit={handleSubmit}
          loading={loading}
          error={modalError}
        >
          <Field
            label="Nazwa działu"
            name="name"
            defaultValue={isEdit ? modal.dept.name : undefined}
            placeholder="np. Sprzedaż"
          />
        </Modal>
      )
    }
    if (modal.type === 'add-position' || modal.type === 'edit-position') {
      const isEdit = modal.type === 'edit-position'
      return (
        <Modal
          title={isEdit ? 'Edytuj stanowisko' : 'Nowe stanowisko'}
          onClose={closeModal}
          onSubmit={handleSubmit}
          loading={loading}
          error={modalError}
        >
          <Field
            label="Nazwa stanowiska"
            name="name"
            defaultValue={isEdit ? modal.position.name : undefined}
            placeholder="np. Sprzedawca"
          />
        </Modal>
      )
    }

    return null
  }

  // ─── Skeleton ─────────────────────────────────────────────────────────────

  if (fetching) {
    return (
      <div className="bg-white rounded-xl border border-[var(--wd-border)] shadow-sm p-6 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-8 rounded-lg bg-[var(--wd-surface-2)] animate-pulse" style={{ width: `${60 + i * 10}%` }} />
        ))}
      </div>
    )
  }

  // ─── Main render ───────────────────────────────────────────────────────────

  return (
    <>
      {renderModal()}

      <div className="bg-white rounded-xl border border-[var(--wd-border)] shadow-sm overflow-hidden">
        {/* Header row */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--wd-border)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--wd-text-primary)]">
            <Building2 size={16} className="text-[var(--wd-text-muted)]" />
            Oddziały i działy
          </div>
          <button
            onClick={() => setModal({ type: 'add-division' })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--wd-dark)] text-white hover:bg-[#2E2E2E] transition-colors"
          >
            <Plus size={13} />
            Oddział
          </button>
        </div>

        {/* Tree */}
        <div className="p-4 space-y-1">
          {divisions.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--wd-text-muted)]">
              Brak oddziałów. Utwórz pierwszy oddział.
            </p>
          ) : (
            divisions.map((div) => {
              const isOpen = expandedDivisions.has(div.id)
              return (
                <div key={div.id}>
                  {/* Division row */}
                  <div className="flex items-center gap-1.5 py-2 px-2 rounded-lg hover:bg-[var(--wd-surface-2)] group transition-colors">
                    <button
                      onClick={() => toggleDivision(div.id)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <span className="text-[var(--wd-text-muted)] w-4 shrink-0">
                        {div.departments.length > 0
                          ? (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />)
                          : <span className="block w-3.5" />
                        }
                      </span>
                      <Building2 size={15} className="text-[var(--wd-text-muted)] shrink-0" />
                      <span className="text-sm font-semibold text-[var(--wd-text-primary)] truncate">
                        {div.name}
                      </span>
                      {div.costCenterId && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-stone-100 text-stone-500 border border-stone-200 shrink-0">
                          {div.costCenterId}
                        </span>
                      )}
                      <span className="text-xs text-[var(--wd-text-muted)] ml-1 shrink-0">
                        {div._count.employees} prac.
                      </span>
                    </button>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <IconBtn onClick={() => setModal({ type: 'edit-division', division: div })} title="Edytuj oddział">
                        <Pencil size={13} />
                      </IconBtn>
                      <IconBtn
                        onClick={() => setModal({ type: 'delete-division', division: div })}
                        title="Usuń oddział"
                        variant="danger"
                      >
                        <Trash2 size={13} />
                      </IconBtn>
                    </div>
                  </div>

                  {/* Departments */}
                  {isOpen && (
                    <div className="ml-5 mt-0.5 space-y-0.5 border-l border-[var(--wd-border)] pl-3">
                      {div.departments.map((dept) => (
                        <DeptRow
                          key={dept.id}
                          dept={dept}
                          divisionId={div.id}
                          onEdit={(d) => setModal({ type: 'edit-department', dept: d })}
                          onDelete={(d) => setModal({ type: 'delete-department', dept: d })}
                        />
                      ))}
                      <button
                        onClick={() => setModal({ type: 'add-department', divisionId: div.id })}
                        className="flex items-center gap-1.5 py-1.5 px-2 text-xs text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)] hover:bg-[var(--wd-surface-2)] rounded-lg transition-colors w-full"
                      >
                        <Plus size={12} />
                        Dodaj dział
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Positions section */}
        <div className="border-t border-[var(--wd-border)]">
          <div className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--wd-text-primary)]">
              <Tag size={14} className="text-[var(--wd-text-muted)]" />
              Stanowiska
            </div>
            <button
              onClick={() => setModal({ type: 'add-position' })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--wd-border)] text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)] hover:bg-[var(--wd-surface-2)] transition-colors"
            >
              <Plus size={12} />
              Stanowisko
            </button>
          </div>
          <div className="px-5 pb-4 flex flex-wrap gap-2">
            {positions.length === 0 ? (
              <p className="text-xs text-[var(--wd-text-muted)] py-2">Brak stanowisk.</p>
            ) : (
              positions.map((pos) => (
                <div
                  key={pos.id}
                  className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--wd-border)] bg-[var(--wd-surface-2)] text-xs text-[var(--wd-text-primary)] hover:border-[var(--wd-dark)]/30 transition-colors"
                >
                  <span>{pos.name}</span>
                  <span className="text-[var(--wd-text-muted)]">({pos._count.employees})</span>
                  <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
                    <button
                      onClick={() => setModal({ type: 'edit-position', position: pos })}
                      title="Edytuj"
                      className="p-0.5 rounded hover:bg-white transition-colors text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)]"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => setModal({ type: 'delete-position', position: pos })}
                      title="Usuń"
                      className="p-0.5 rounded hover:bg-red-50 transition-colors text-[var(--wd-text-muted)] hover:text-red-600"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  )
}
