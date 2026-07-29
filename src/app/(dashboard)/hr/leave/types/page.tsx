'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Pencil, PowerOff, ChevronRight, Loader2, X, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  isCanonicalLeaveTypeCode,
  PROTECTED_LEAVE_TYPE_RULES,
  type CanonicalLeaveTypeCode,
  type ProtectedLeaveTypeUpdate,
} from '@/lib/hr/leave-type-catalog'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveType {
  id: string
  name: string
  code: string
  color: string
  isPaid: boolean
  requiresApproval: boolean
  tracksBalance: boolean
  maxDaysPerYear: number | null
  isActive: boolean
  parentId: string | null
  subtypes?: LeaveType[]
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

type ProtectedUiField =
  | 'code'
  | 'isPaid'
  | 'requiresApproval'
  | 'tracksBalance'
  | 'maxDaysPerYear'
  | 'parentId'

const PROTECTED_UI_TITLES = {
  VL: {
    code: 'Kod VL jest chroniony i nie może zostać zmieniony.',
    isPaid: 'VL musi pozostać urlopem płatnym.',
    requiresApproval: 'VL musi wymagać akceptacji.',
    tracksBalance: 'VL musi pomniejszać saldo urlopowe.',
    parentId: 'VL musi pozostać typem głównym i nie może mieć typu nadrzędnego.',
  },
  SL: {
    code: 'Kod SL jest chroniony i nie może zostać zmieniony.',
    tracksBalance: 'SL nie pomniejsza salda urlopowego.',
  },
  UB: {
    code: 'Kod UB jest chroniony i nie może zostać zmieniony.',
    isPaid: 'UB musi pozostać urlopem bezpłatnym.',
    requiresApproval: 'UB musi wymagać akceptacji.',
    tracksBalance: 'UB nie pomniejsza salda urlopowego.',
    maxDaysPerYear: 'UB nie może mieć rocznego limitu dni.',
  },
  VLD: {
    code: 'Kod VLD jest chroniony i nie może zostać zmieniony.',
    requiresApproval: 'VLD musi wymagać akceptacji.',
    tracksBalance: 'VLD musi pomniejszać saldo urlopowe.',
    maxDaysPerYear: 'VLD ma chroniony limit 4 dni.',
    parentId: 'VLD musi wskazywać kanoniczny typ VL.',
  },
} satisfies Record<
  CanonicalLeaveTypeCode,
  Partial<Record<ProtectedUiField, string>>
>

function getProtectedUiTitles(
  code: string
): Partial<Record<ProtectedUiField, string>> | undefined {
  return isCanonicalLeaveTypeCode(code)
    ? PROTECTED_UI_TITLES[code]
    : undefined
}

function getProtectedRules(code: string): ProtectedLeaveTypeUpdate | undefined {
  return isCanonicalLeaveTypeCode(code)
    ? PROTECTED_LEAVE_TYPE_RULES[code]
    : undefined
}

// ─── Modal ─────────────────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editing: LeaveType | null
  parentOptions: Array<{ id: string; name: string; code: string }>
  returnFocusRef: React.RefObject<HTMLElement | null>
}

function LeaveTypeModal({
  open,
  onClose,
  onSaved,
  editing,
  parentOptions,
  returnFocusRef,
}: ModalProps) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [color, setColor] = useState('#3B82F6')
  const [isPaid, setIsPaid] = useState(true)
  const [requiresApproval, setRequiresApproval] = useState(true)
  const [tracksBalance, setTracksBalance] = useState(true)
  const [maxDays, setMaxDays] = useState('')
  const [parentId, setParentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const canonicalVlId = parentOptions.find((option) => option.code === 'VL')?.id ?? ''
  const normalizedCode = code.trim().toUpperCase()
  const creationProtectionCode =
    !editing && isCanonicalLeaveTypeCode(normalizedCode)
      ? normalizedCode
      : null
  const protectedTitles = getProtectedUiTitles(
    editing?.code ?? normalizedCode
  )
  const subtypeParentTitle = editing?.subtypes?.length
    ? 'Typ mający podtypy musi pozostać typem głównym.'
    : undefined
  const parentProtectionTitle = [
    protectedTitles?.parentId,
    subtypeParentTitle,
  ].filter((title): title is string => Boolean(title)).join(' ') || undefined

  const applyProtectedRules = useCallback((
    targetCode: string,
    fallback: {
      isPaid: boolean
      requiresApproval: boolean
      tracksBalance: boolean
      maxDays: string
      parentId: string
    }
  ) => {
    const rules = getProtectedRules(targetCode)

    setIsPaid(rules?.isPaid ?? fallback.isPaid)
    setRequiresApproval(
      rules?.requiresApproval ?? fallback.requiresApproval
    )
    setTracksBalance(rules?.tracksBalance ?? fallback.tracksBalance)
    setMaxDays(
      Object.prototype.hasOwnProperty.call(rules ?? {}, 'maxDaysPerYear')
        ? rules?.maxDaysPerYear === null
          ? ''
          : String(rules?.maxDaysPerYear)
        : fallback.maxDays
    )
    setParentId(
      Object.prototype.hasOwnProperty.call(rules ?? {}, 'parentCode')
        ? rules?.parentCode === 'VL'
          ? canonicalVlId
          : ''
        : fallback.parentId
    )
  }, [canonicalVlId])

  useEffect(() => {
    if (editing) {
      setName(editing.name)
      setCode(editing.code)
      setColor(editing.color)
      applyProtectedRules(editing.code, {
        isPaid: editing.isPaid,
        requiresApproval: editing.requiresApproval,
        tracksBalance: editing.tracksBalance,
        maxDays:
          editing.maxDaysPerYear !== null
            ? String(editing.maxDaysPerYear)
            : '',
        parentId: editing.parentId ?? '',
      })
    } else {
      setName('')
      setCode('')
      setColor('#3B82F6')
      setIsPaid(true)
      setRequiresApproval(true)
      setTracksBalance(true)
      setMaxDays('')
      setParentId('')
    }
    setError('')
  }, [applyProtectedRules, editing, open])

  useEffect(() => {
    if (editing) return

    applyProtectedRules(creationProtectionCode ?? '', {
      isPaid: true,
      requiresApproval: true,
      tracksBalance: true,
      maxDays: '',
      parentId: '',
    })
  }, [applyProtectedRules, creationProtectionCode, editing])

  const protectedDescriptionId = (field: ProtectedUiField) =>
    (field === 'parentId'
      ? parentProtectionTitle
      : protectedTitles?.[field])
      ? `leave-type-${field}-protected`
      : undefined

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
      tracksBalance,
      maxDaysPerYear: maxDays
        ? parseInt(maxDays, 10)
        : editing
          ? null
          : undefined,
      parentId: parentId || (editing ? null : undefined),
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

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent
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
          <DialogTitle className="text-base font-semibold text-[var(--wd-text-primary)]">
            {editing ? 'Edytuj typ urlopu' : 'Dodaj typ urlopu'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Ustaw nazwę, kod i zachowanie typu urlopu.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <Label
              htmlFor="leave-type-name"
              className="mb-1.5 block text-xs font-medium uppercase text-[var(--wd-text-muted)]"
            >
              Nazwa
            </Label>
            <Input
              id="leave-type-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="h-auto w-full rounded-lg border-[var(--wd-border)] bg-[var(--wd-surface)] px-3 py-2 text-sm text-[var(--wd-text-primary)] focus-visible:ring-[var(--wd-sand)]"
              placeholder="np. Urlop wypoczynkowy"
            />
          </div>

          <div>
            <Label
              htmlFor="leave-type-code"
              className="mb-1.5 block text-xs font-medium uppercase text-[var(--wd-text-muted)]"
            >
              Kod
            </Label>
            <Input
              id="leave-type-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              maxLength={20}
              disabled={Boolean(editing && protectedTitles?.code)}
              title={editing ? protectedTitles?.code : undefined}
              aria-describedby={
                editing ? protectedDescriptionId('code') : undefined
              }
              className="h-auto w-full rounded-lg border-[var(--wd-border)] bg-[var(--wd-surface)] px-3 py-2 font-mono text-sm uppercase text-[var(--wd-text-primary)] focus-visible:ring-[var(--wd-sand)]"
              placeholder="np. VL"
            />
            {editing && protectedTitles?.code && (
              <span id={protectedDescriptionId('code')} className="sr-only">
                {protectedTitles.code}
              </span>
            )}
          </div>

          <div>
            <Label
              htmlFor="leave-type-color"
              className="mb-1.5 block text-xs font-medium uppercase text-[var(--wd-text-muted)]"
            >
              Kolor
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset.hex}
                  type="button"
                  title={preset.label}
                  onClick={() => setColor(preset.hex)}
                  className="relative h-7 w-7 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)] focus:ring-offset-1"
                  style={{ backgroundColor: preset.hex }}
                >
                  {color === preset.hex && (
                    <Check
                      size={12}
                      className="absolute inset-0 m-auto text-white"
                      strokeWidth={3}
                    />
                  )}
                </button>
              ))}
              <Input
                id="leave-type-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                title="Własny kolor"
                className="h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-[var(--wd-border)] p-0"
              />
              <span className="font-mono text-xs text-[var(--wd-text-muted)]">
                {color}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {([
              {
                field: 'isPaid' as const,
                id: 'leave-type-paid',
                label: 'Płatny',
                checked: isPaid,
                onChange: setIsPaid,
              },
              {
                field: 'requiresApproval' as const,
                id: 'leave-type-approval',
                label: 'Wymaga akceptacji',
                checked: requiresApproval,
                onChange: setRequiresApproval,
              },
              {
                field: 'tracksBalance' as const,
                id: 'leave-type-balance',
                label: 'Pomniejsza saldo',
                checked: tracksBalance,
                onChange: setTracksBalance,
              },
            ]).map((control) => {
              const protectedTitle = protectedTitles?.[control.field]
              const descriptionId = protectedDescriptionId(control.field)

              return (
                <div key={control.field}>
                  <Label
                    htmlFor={control.id}
                    className={`flex items-center gap-2 text-sm text-[var(--wd-text-primary)] ${
                      protectedTitle
                        ? 'cursor-not-allowed opacity-60'
                        : 'cursor-pointer'
                    }`}
                    title={protectedTitle}
                  >
                    <input
                      id={control.id}
                      type="checkbox"
                      checked={control.checked}
                      onChange={(e) => control.onChange(e.target.checked)}
                      disabled={Boolean(protectedTitle)}
                      title={protectedTitle}
                      aria-describedby={descriptionId}
                      className="h-4 w-4 rounded border-[var(--wd-border)] accent-[var(--wd-dark)]"
                    />
                    <span>{control.label}</span>
                  </Label>
                  {protectedTitle && (
                    <span id={descriptionId} className="sr-only">
                      {protectedTitle}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          <div>
            <Label
              htmlFor="leave-type-max-days"
              className="mb-1.5 block text-xs font-medium uppercase text-[var(--wd-text-muted)]"
            >
              Maks. dni w roku{' '}
              <span className="normal-case font-normal">(opcjonalnie)</span>
            </Label>
            <Input
              id="leave-type-max-days"
              type="number"
              value={maxDays}
              onChange={(e) => setMaxDays(e.target.value)}
              min={1}
              max={365}
              disabled={Boolean(protectedTitles?.maxDaysPerYear)}
              title={protectedTitles?.maxDaysPerYear}
              aria-describedby={protectedDescriptionId('maxDaysPerYear')}
              className="h-auto w-full rounded-lg border-[var(--wd-border)] bg-[var(--wd-surface)] px-3 py-2 text-sm text-[var(--wd-text-primary)] focus-visible:ring-[var(--wd-sand)]"
              placeholder="np. 26"
            />
            {protectedTitles?.maxDaysPerYear && (
              <span
                id={protectedDescriptionId('maxDaysPerYear')}
                className="sr-only"
              >
                {protectedTitles.maxDaysPerYear}
              </span>
            )}
          </div>

          <div>
            <Label
              htmlFor="leave-type-parent"
              className="mb-1.5 block text-xs font-medium uppercase text-[var(--wd-text-muted)]"
            >
              Typ nadrzędny{' '}
              <span className="normal-case font-normal">(opcjonalnie)</span>
            </Label>
            <select
              id="leave-type-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              disabled={Boolean(parentProtectionTitle)}
              title={parentProtectionTitle}
              aria-describedby={protectedDescriptionId('parentId')}
              className="w-full rounded-lg border border-[var(--wd-border)] bg-[var(--wd-surface)] px-3 py-2 text-sm text-[var(--wd-text-primary)] transition focus:outline-none focus:ring-2 focus:ring-[var(--wd-sand)]"
            >
              <option value="">— brak (typ główny) —</option>
              {parentOptions
                .filter((parent) => parent.id !== editing?.id)
                .map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    [{parent.code}] {parent.name}
                  </option>
                ))}
            </select>
            {parentProtectionTitle && (
              <span id={protectedDescriptionId('parentId')} className="sr-only">
                {parentProtectionTitle}
              </span>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <DialogFooter className="flex-row items-center justify-end gap-2 pt-1 sm:space-x-0">
            <Button
              type="button"
              onClick={onClose}
              variant="outline"
              className="h-auto rounded-lg border-[var(--wd-border)] px-4 py-2 text-sm font-medium text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)]"
            >
              Anuluj
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="h-auto rounded-lg bg-[var(--wd-dark)] px-4 py-2 text-sm font-medium text-white hover:bg-[#2E2E2E]"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {editing ? 'Zapisz zmiany' : 'Dodaj typ'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const canonical = isCanonicalLeaveTypeCode(type.code)
  const deactivateDescriptionId = canonical
    ? `leave-type-${type.id}-deactivate-protected`
    : undefined

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
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
            type.tracksBalance
              ? 'bg-sky-50 text-sky-700 border-sky-200'
              : 'bg-stone-50 text-stone-500 border-stone-200'
          }`}
        >
          {type.tracksBalance ? 'Saldo' : 'Bez salda'}
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
            aria-label={`Edytuj ${type.code}`}
            className="p-1.5 rounded-md text-[var(--wd-text-muted)] hover:bg-[var(--wd-surface-2)] hover:text-[var(--wd-text-primary)] transition-colors"
            title="Edytuj"
          >
            <Pencil size={14} />
          </button>
          {type.isActive && (
            <>
              <button
                onClick={() => onDeactivate(type)}
                disabled={canonical}
                aria-label={`Dezaktywuj ${type.code}`}
                aria-describedby={deactivateDescriptionId}
                className="p-1.5 rounded-md text-[var(--wd-text-muted)] hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--wd-text-muted)] transition-colors"
                title={
                  canonical
                    ? `Typ ${type.code} jest kanoniczny i nie może zostać dezaktywowany.`
                    : 'Dezaktywuj'
                }
              >
                <PowerOff size={14} />
              </button>
              {canonical && (
                <span id={deactivateDescriptionId} className="sr-only">
                  Typ {type.code} jest kanoniczny i nie może zostać
                  dezaktywowany.
                </span>
              )}
            </>
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
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null)

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
    dialogReturnFocusRef.current = document.activeElement as HTMLElement | null
    setEditing(type)
    setModalOpen(true)
  }

  const handleAdd = () => {
    dialogReturnFocusRef.current = document.activeElement as HTMLElement | null
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
    for (const sub of type.subtypes ?? []) {
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
                  <th>Saldo</th>
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
        returnFocusRef={dialogReturnFocusRef}
      />
    </div>
  )
}
