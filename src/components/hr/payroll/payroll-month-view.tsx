'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { calculateEmployerCostGrosze, type EmployerRates } from '@/lib/payroll/employer-cost'
import { formatGrosze, formatMinutesAsHours, groszeToPlnString, parsePlnToGrosze } from '@/lib/payroll/money'
import { dayMonthGenitive, MONTH_NAMES, monthGenitive } from '@/lib/payroll/month-names'
import { PAYROLL_BASIS_LABELS, type PayrollBasis } from '@/lib/payroll/types'
import { BaseSalaryDialog } from './base-salary-dialog'
import styles from './payroll.module.css'

// ─── Types (the JSON of GET /api/hr/payroll/sheet) ────────────────────────────

type StampSettlement = {
  id: string
  status: 'DRAFT' | 'APPROVED'
  currentVersionNumber: number
  payrollOfficeConfirmedAt: string | null
}

type Note = { code: string; message: string }

type VersionOrigin = 'MANUAL' | 'AUTO_CARRYOVER'

type AutomationStatus = {
  enabled: boolean
  nextRun: { month: string; date: string } | null
  schedulerActive: boolean
}

type SheetRow = {
  employee: { id: string; firstName: string; lastName: string; position: string; costCenterId: string; employmentType: string | null }
  contractor: boolean
  currentBase: { amountGrosze: number; basis: PayrollBasis; effectiveFrom: string } | null
  settlement: (StampSettlement & {
    revision: number
    finalGrossGrosze: number | null
    finalNetGrosze: number | null
    employerCostGrosze: number | null
    employerCostSource: string | null
  }) | null
  effectiveVersion: {
    versionNumber: number
    finalGrossGrosze: number
    finalNetGrosze: number
    employerCostGrosze: number
    employerCostSource: string
    origin: VersionOrigin
  } | null
  previous: { month: string; finalGrossGrosze: number; finalNetGrosze: number; employerCostGrosze: number } | null
  /** PREVIOUS_MONTH: copied from last month; HOURS: approved hours × rate, net from the last proportion. */
  suggestion: {
    kind: 'PREVIOUS_MONTH' | 'HOURS'
    finalGrossGrosze: number
    finalNetGrosze: number | null
    employerCostGrosze: number | null
    employerCostSource: 'CALCULATED' | 'OVERRIDDEN'
    sourceMonth: string | null
  } | null
  /** Hourly basis only: calendar hours behind the amount. */
  hours: {
    approvedMinutes: number
    pendingMinutes: number
    pendingEntries: number
    approvablePendingEntries: number
    openEntries: number
    calculation: { rateGrosze: number; approvedMinutes: number; grossGrosze: number } | null
  } | null
  flags: Note[]
  blockers: Note[]
  autoEligible: boolean
  rates: EmployerRates | null
  /** Approved rows only: pay-relevant inputs changed after approval, amount not confirmed yet. */
  changeAfterApproval: { changes: Note[]; signature: string } | null
}

type Sheet = {
  month: string
  previousMonth: string
  listReference: string | null
  approvedEmployerCostGrosze: number
  previousApprovedEmployerCostGrosze: number | null
  rows: SheetRow[]
}

type RowResult =
  | { employeeId: string; status: 'APPROVED' | 'UNCHANGED'; versionNumber: number }
  | { employeeId: string; status: 'BLOCKED'; message: string; blockers: Note[] }
  | { employeeId: string; status: 'CONFLICT' | 'INVALID'; message: string }

/** What the row inputs hold: strings as typed ("6500,50"), plus whether the cost is manual. */
type Draft = { gross: string; net: string; cost: string; manual: boolean }
type Origin = 'approved' | 'draft' | 'suggestion' | 'empty'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function toInput(grosze: number | null | undefined) {
  return grosze == null ? '' : groszeToPlnString(grosze).replace('.', ',')
}

function signed(grosze: number) {
  if (grosze === 0) return '±0'
  return `${grosze > 0 ? '+' : '−'}${formatGrosze(Math.abs(grosze))}`
}

/** "1 wpis", "3 wpisy", "5 wpisów" */
function entriesPl(count: number) {
  const few = count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
  return `${count} ${count === 1 ? 'wpis' : few ? 'wpisy' : 'wpisów'}`
}

function personName(row: SheetRow) {
  return `${row.employee.lastName} ${row.employee.firstName}`
}

/** Fields fill in this order: effective version → draft amounts → suggestion → empty. */
function initialDraft(row: SheetRow): { draft: Draft; origin: Origin } {
  const manualFor = (source: string | null | undefined) => !row.rates || (source != null && source !== 'CALCULATED')
  if (row.effectiveVersion) {
    const v = row.effectiveVersion
    return {
      draft: { gross: toInput(v.finalGrossGrosze), net: toInput(v.finalNetGrosze), cost: toInput(v.employerCostGrosze), manual: manualFor(v.employerCostSource) },
      origin: 'approved',
    }
  }
  const s = row.settlement
  if (s && s.finalGrossGrosze != null) {
    return {
      draft: { gross: toInput(s.finalGrossGrosze), net: toInput(s.finalNetGrosze), cost: toInput(s.employerCostGrosze), manual: manualFor(s.employerCostSource) },
      origin: 'draft',
    }
  }
  if (row.suggestion) {
    const g = row.suggestion
    return {
      draft: { gross: toInput(g.finalGrossGrosze), net: toInput(g.finalNetGrosze), cost: toInput(g.employerCostGrosze), manual: manualFor(g.employerCostSource) },
      origin: 'suggestion',
    }
  }
  return { draft: { gross: '', net: '', cost: '', manual: !row.rates }, origin: 'empty' }
}

function sameDraft(a: Draft, b: Draft) {
  const eq = (x: string, y: string) => parsePlnToGrosze(x) === parsePlnToGrosze(y) && (x.trim() === '') === (y.trim() === '')
  return eq(a.gross, b.gross) && eq(a.net, b.net) && a.manual === b.manual && (!a.manual || eq(a.cost, b.cost))
}

function isApproved(row: SheetRow) {
  return row.settlement?.status === 'APPROVED'
}

// ─── Stamps ──────────────────────────────────────────────────────────────────

export function StatusStamp({ settlement, origin }: { settlement: StampSettlement | null; origin?: VersionOrigin }) {
  if (!settlement) return <span className={`${styles.stamp} ${styles.stampNone}`}>brak rozliczenia</span>
  if (settlement.status === 'APPROVED' && origin === 'AUTO_CARRYOVER') {
    // A machine stamp: straight and double-ruled, unlike the hand stamp below.
    return (
      <span className={`${styles.stamp} ${styles.stampApproved} ${styles.stampAuto}`} title="Zatwierdził automat 1. dnia miesiąca, kwoty z poprzedniego miesiąca">
        <span>Zatwierdzone</span> <span>automatycznie · v{settlement.currentVersionNumber}</span>
      </span>
    )
  }
  if (settlement.status === 'APPROVED') {
    return <span className={`${styles.stamp} ${styles.stampApproved}`}>Zatwierdzone · v{settlement.currentVersionNumber}</span>
  }
  if (settlement.payrollOfficeConfirmedAt) {
    return <span className={`${styles.stamp} ${styles.stampReady}`}>Kadrowa potwierdziła</span>
  }
  return <span className={`${styles.stamp} ${styles.stampDraft}`}>Robocze</span>
}

function SheetStatus({ row }: { row: SheetRow }) {
  if (row.settlement) return <StatusStamp settlement={row.settlement} origin={row.effectiveVersion?.origin} />
  if (row.blockers.length > 0) return <span className={`${styles.stamp} ${styles.stampNone} ${styles.attention}`}>zablokowane</span>
  if (row.autoEligible) return <span className={`${styles.stamp} ${styles.stampReady}`}>gotowe</span>
  if (row.flags.length > 0) return <span className={`${styles.stamp} ${styles.stampDraft}`}>do sprawdzenia</span>
  return <span className={`${styles.stamp} ${styles.stampDraft}`}>do wpisania</span>
}

// ─── View ────────────────────────────────────────────────────────────────────

export function PayrollMonthView({ initialMonth, maxMonth }: { initialMonth: string; maxMonth: string }) {
  const router = useRouter()
  const [month, setMonth] = useState(initialMonth)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [edits, setEdits] = useState<Record<string, Draft>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Record<string, RowResult>>({})
  const [justApproved, setJustApproved] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [pendingMonth, setPendingMonth] = useState<string | null>(null)
  const [baseFor, setBaseFor] = useState<SheetRow['employee'] | null>(null)
  const [creatingFor, setCreatingFor] = useState<string | null>(null)
  const [reference, setReference] = useState('')
  const [referenceState, setReferenceState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' })
  const [automation, setAutomation] = useState<AutomationStatus | null>(null)
  const [acknowledging, setAcknowledging] = useState<string | null>(null)
  const [approvingHours, setApprovingHours] = useState<string | null>(null)
  const [hoursNotes, setHoursNotes] = useState<Record<string, { ok: boolean; text: string }>>({})
  const savedReference = useRef<string>('')
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const loadedMonth = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/hr/payroll/sheet?month=${month}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!active) return
        if (!res.ok) {
          setError('Nie udało się pobrać arkusza miesiąca.')
          return
        }
        const json = (await res.json()) as Sheet
        if (!active) return
        setError(null)
        setSheet(json)
        const firstLoad = loadedMonth.current !== json.month
        loadedMonth.current = json.month
        if (firstLoad) {
          // Only ready rows (suggestion, no flags, no blockers, no settlement yet) start selected.
          setSelected(new Set(json.rows.filter((row) => row.autoEligible && !row.settlement).map((row) => row.employee.id)))
          setReference(json.listReference ?? '')
          savedReference.current = json.listReference ?? ''
          setReferenceState({ kind: 'idle' })
        }
      })
      .catch(() => active && setError('Błąd połączenia.'))
    return () => { active = false }
  }, [month, reloadKey])

  useEffect(() => {
    let active = true
    fetch('/api/hr/payroll/automation', { cache: 'no-store' })
      .then(async (res) => {
        if (active && res.ok) setAutomation((await res.json()) as AutomationStatus)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  const rows = useMemo(() => sheet?.rows ?? [], [sheet])
  const initial = useMemo(() => new Map(rows.map((row) => [row.employee.id, initialDraft(row)])), [rows])

  const draftOf = useCallback((row: SheetRow): Draft =>
    edits[row.employee.id] ?? (initial.get(row.employee.id)?.draft as Draft), [edits, initial])
  const isDirty = useCallback((row: SheetRow) => {
    const edit = edits[row.employee.id]
    const base = initial.get(row.employee.id)
    return Boolean(edit && base && !sameDraft(edit, base.draft))
  }, [edits, initial])
  const selectable = useCallback((row: SheetRow) =>
    row.blockers.length === 0 && (!isApproved(row) || isDirty(row)), [isDirty])

  const previewCost = useCallback((row: SheetRow): number | null => {
    const draft = draftOf(row)
    if (row.effectiveVersion && !isDirty(row)) return row.effectiveVersion.employerCostGrosze
    if (draft.manual) return parsePlnToGrosze(draft.cost)
    const gross = parsePlnToGrosze(draft.gross)
    return gross !== null && gross > 0 && row.rates ? calculateEmployerCostGrosze(gross, row.rates) : null
  }, [draftOf, isDirty])

  const chosen = rows.filter((row) => selected.has(row.employee.id) && selectable(row))
  const chosenCost = chosen.reduce((sum, row) => sum + (previewCost(row) ?? 0), 0)
  const dirtyRows = rows.filter(isDirty)
  const approvedCount = rows.filter(isApproved).length
  // Needs a look: rows not ready for one-click approval, and approved rows changed after approval (D9).
  const attentionCount = rows.filter((row) => isApproved(row)
    ? row.changeAfterApproval !== null
    : !(row.autoEligible && !row.settlement)).length

  function setDraft(row: SheetRow, patch: Partial<Draft>) {
    const id = row.employee.id
    const next = { ...draftOf(row), ...patch }
    setEdits((current) => ({ ...current, [id]: next }))
    setResults(({ [id]: _dropped, ...rest }) => { void _dropped; return rest })
    const base = initial.get(id)
    const changed = !base || !sameDraft(next, base.draft)
    // Editing a row selects it (unless it is blocked); undoing a correction deselects it again.
    if (row.blockers.length === 0 && changed) setSelected((current) => new Set(current).add(id))
    if (isApproved(row) && !changed) setSelected((current) => { const s = new Set(current); s.delete(id); return s })
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function submit(target: SheetRow[]): Promise<boolean> {
    if (target.length === 0 || saving) return false
    const local: Record<string, RowResult> = {}
    const payload: Array<Record<string, unknown>> = []
    for (const row of target) {
      const id = row.employee.id
      if (row.blockers.length > 0) {
        local[id] = { employeeId: id, status: 'BLOCKED', message: 'Tego wiersza nie można zatwierdzić.', blockers: row.blockers }
        continue
      }
      const draft = draftOf(row)
      const gross = parsePlnToGrosze(draft.gross)
      const net = parsePlnToGrosze(draft.net)
      if (gross === null || net === null || gross <= 0 || net < 0) {
        local[id] = { employeeId: id, status: 'INVALID', message: 'Wpisz brutto i netto (np. 6500,50).' }
        continue
      }
      if (draft.manual && (parsePlnToGrosze(draft.cost) ?? 0) <= 0) {
        local[id] = { employeeId: id, status: 'INVALID', message: 'Wpisz pełny koszt pracodawcy.' }
        continue
      }
      payload.push({
        employeeId: id,
        finalGross: draft.gross,
        finalNet: draft.net,
        ...(draft.manual ? { employerCost: draft.cost } : {}),
        ...(row.settlement ? { expectedRevision: row.settlement.revision } : {}),
      })
    }

    let remote: RowResult[] = []
    if (payload.length > 0) {
      setSaving(true)
      setSummary(null)
      try {
        const res = await fetch('/api/hr/payroll/sheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month, rows: payload }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json) {
          setError(json?.error ?? 'Nie udało się zapisać arkusza.')
          return false
        }
        remote = json.results as RowResult[]
      } catch {
        setError('Błąd połączenia — nic nie zostało zapisane.')
        return false
      } finally {
        setSaving(false)
      }
    }

    const all = [...remote, ...Object.values(local)]
    const done = all.filter((r) => r.status === 'APPROVED' || r.status === 'UNCHANGED').map((r) => r.employeeId)
    setResults((current) => ({ ...current, ...Object.fromEntries(all.map((r) => [r.employeeId, r])) }))
    setEdits((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !done.includes(id))))
    setSelected((current) => new Set([...current].filter((id) => !done.includes(id))))
    setJustApproved(new Set(remote.filter((r) => r.status === 'APPROVED').map((r) => r.employeeId)))
    const approved = all.filter((r) => r.status === 'APPROVED').length
    const refused = all.length - done.length
    setSummary([
      approved > 0 ? `zatwierdzono ${approved}` : null,
      all.length - approved - refused > 0 ? `bez zmian ${all.length - approved - refused}` : null,
      refused > 0 ? `odmowa ${refused} — powód w wierszu` : null,
    ].filter(Boolean).join(' · '))
    setError(null)
    if (remote.length > 0) setReloadKey((key) => key + 1)
    return refused === 0
  }

  function navigate(next: string) {
    setPendingMonth(null)
    setSheet(null)
    setEdits({})
    setResults({})
    setSummary(null)
    setJustApproved(new Set())
    setMonth(next)
    router.replace(`/hr/payroll?month=${next}`, { scroll: false })
  }

  function goTo(next: string) {
    if (next > maxMonth || next === month) return
    if (dirtyRows.length > 0) {
      setPendingMonth(next)
      return
    }
    navigate(next)
  }

  async function approveAndLeave() {
    const ok = await submit(chosen)
    const unsubmittedDirty = dirtyRows.some((row) => !chosen.includes(row))
    if (ok && !unsubmittedDirty && pendingMonth) navigate(pendingMonth)
    else setPendingMonth(null)
  }

  async function saveReference() {
    const value = reference.trim()
    if (value === savedReference.current.trim()) return
    setReferenceState({ kind: 'saving' })
    try {
      const res = await fetch(`/api/hr/payroll/months/${month}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listReference: value }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) {
        setReferenceState({ kind: 'error', text: 'Nie zapisano — maks. 200 znaków.' })
        return
      }
      savedReference.current = json.listReference ?? ''
      setReference(json.listReference ?? '')
      setReferenceState({
        kind: 'saved',
        text: `zapisano ${new Date(json.updatedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`,
      })
    } catch {
      setReferenceState({ kind: 'error', text: 'Błąd połączenia — nie zapisano.' })
    }
  }

  /** "Kwota aktualna": keeps the approved amount for the change the ADMIN is looking at. */
  async function acknowledge(row: SheetRow) {
    const id = row.employee.id
    if (!row.settlement || !row.changeAfterApproval || acknowledging) return
    setAcknowledging(id)
    try {
      const res = await fetch(`/api/hr/payroll/settlements/${row.settlement.id}/acknowledge-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: row.changeAfterApproval.signature }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setResults((current) => ({ ...current, [id]: { employeeId: id, status: 'CONFLICT', message: json?.error ?? 'Nie udało się zapisać.' } }))
        if (res.status === 409) setReloadKey((key) => key + 1)
        return
      }
      setResults(({ [id]: _dropped, ...rest }) => { void _dropped; return rest })
      setReloadKey((key) => key + 1)
    } catch {
      setResults((current) => ({ ...current, [id]: { employeeId: id, status: 'CONFLICT', message: 'Błąd połączenia — nic nie zostało zapisane.' } }))
    } finally {
      setAcknowledging(null)
    }
  }

  /**
   * "Zatwierdź godziny": approves the person's waiting time entries (with a clock-out) for the month,
   * then re-reads the sheet so the row recalculates in place — no page reload. Typed amounts stay.
   */
  async function approveHours(row: SheetRow) {
    const id = row.employee.id
    if (approvingHours) return
    setApprovingHours(id)
    try {
      const res = await fetch('/api/hr/payroll/sheet/approve-hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: id, month }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) {
        setHoursNotes((current) => ({ ...current, [id]: { ok: false, text: json?.error ?? 'Nie udało się zatwierdzić godzin.' } }))
        return
      }
      const approvedCount = json.approved as number
      const leftOpen = json.leftOpen as number
      setHoursNotes((current) => ({
        ...current,
        [id]: {
          ok: leftOpen === 0,
          text: `Zatwierdzono ${entriesPl(approvedCount)} czasu pracy`
            + (leftOpen > 0 ? ` · ${entriesPl(leftOpen)} bez godziny wyjścia — uzupełnij w Czasie pracy` : ''),
        },
      }))
      setReloadKey((key) => key + 1)
    } catch {
      setHoursNotes((current) => ({ ...current, [id]: { ok: false, text: 'Błąd połączenia — nic nie zostało zapisane.' } }))
    } finally {
      setApprovingHours(null)
    }
  }

  async function openDetail(row: SheetRow) {
    if (row.settlement) {
      router.push(`/hr/payroll/${row.settlement.id}`)
      return
    }
    setCreatingFor(row.employee.id)
    setError(null)
    try {
      const res = await fetch('/api/hr/payroll/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: row.employee.id, month }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok || json.details?.settlementId) {
        router.push(`/hr/payroll/${json.id ?? json.details.settlementId}`)
        return
      }
      setError(json.error ?? 'Nie udało się utworzyć rozliczenia.')
    } finally {
      setCreatingFor(null)
    }
  }

  /** Tab from the last figure of a row jumps to the next row's gross; Enter approves this row. */
  function onFieldKey(event: KeyboardEvent<HTMLInputElement>, row: SheetRow, field: 'gross' | 'net' | 'cost') {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit([row])
      return
    }
    if (event.key !== 'Tab' || event.shiftKey) return
    const lastField = draftOf(row).manual ? 'cost' : 'net'
    if (field !== lastField) return
    const index = rows.findIndex((r) => r.employee.id === row.employee.id)
    const next = rows[index + 1]
    const target = next ? inputs.current.get(`${next.employee.id}:gross`) : null
    if (target) {
      event.preventDefault()
      target.focus()
      target.select()
    }
  }

  const bindInput = (id: string, field: string) => (element: HTMLInputElement | null) => {
    const key = `${id}:${field}`
    if (element) inputs.current.set(key, element)
    else inputs.current.delete(key)
  }

  const [y, m] = month.split('-').map(Number)
  const previousMonth = shiftMonth(month, -1)
  const costDelta = sheet && sheet.previousApprovedEmployerCostGrosze !== null
    ? sheet.approvedEmployerCostGrosze - sheet.previousApprovedEmployerCostGrosze
    : null

  return (
    <div className={`${styles.page} ${styles.reveal}`}>
      <header className={styles.masthead}>
        <div>
          <p className={styles.eyebrow}>HR · Wynagrodzenia · tylko administrator</p>
          <h1 className={styles.title}>
            {MONTH_NAMES[m - 1]} <em>{y}</em>
          </h1>
          <p className={styles.lede}>
            {rows.some((row) => row.suggestion?.kind === 'PREVIOUS_MONTH')
              ? 'Kwoty z poprzedniego miesiąca są już w polach — popraw tylko to, co się zmieniło, i zatwierdź zaznaczone osoby.'
              : 'Wpisz brutto i netto z listy płac — Tab przechodzi do następnego pola, Enter zatwierdza wiersz.'}
          </p>
          {automation && <AutomationLine status={automation} />}
        </div>
        <nav className={styles.monthNav} aria-label="Wybór miesiąca">
          <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => goTo(previousMonth)} aria-label="Poprzedni miesiąc">
            <ChevronLeft />
          </button>
          <input
            type="month"
            aria-label="Miesiąc"
            value={month}
            max={maxMonth}
            onChange={(event) => event.target.value && goTo(event.target.value)}
            className={`${styles.btn} ${styles.ghost}`}
          />
          <button
            type="button"
            className={`${styles.btn} ${styles.ghost}`}
            onClick={() => goTo(shiftMonth(month, 1))}
            disabled={shiftMonth(month, 1) > maxMonth}
            aria-label="Następny miesiąc"
          >
            <ChevronRight />
          </button>
        </nav>
      </header>

      <div className={styles.sheetMeta}>
        <label className={styles.refField}>
          Numer listy płac
          <span className={styles.refRow}>
            <input
              aria-label="Numer listy płac"
              value={reference}
              maxLength={200}
              placeholder="np. LP 11/2026"
              disabled={!sheet}
              onChange={(event) => { setReference(event.target.value); setReferenceState({ kind: 'idle' }) }}
              onBlur={() => void saveReference()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); void saveReference() }
              }}
            />
            <span
              role={referenceState.kind === 'error' ? 'alert' : 'status'}
              className={`${styles.saveState} ${referenceState.kind === 'saved' ? styles.saveOk : ''} ${referenceState.kind === 'error' ? styles.saveErr : ''}`}
            >
              {referenceState.kind === 'saving' ? 'zapisuję…' : referenceState.text ?? ''}
              {referenceState.kind === 'saved' && <Check aria-hidden style={{ display: 'inline', width: 12, height: 12, marginLeft: 4, verticalAlign: '-2px' }} />}
            </span>
          </span>
        </label>
        <dl className={styles.kv}>
          <div>
            <dt>Zatwierdzone</dt>
            <dd data-testid="sheet-approved-count">{sheet ? `${approvedCount} / ${rows.length}` : '…'}</dd>
          </div>
          <div>
            <dt>Koszt pracodawcy (zatwierdzony)</dt>
            <dd>
              {sheet ? formatGrosze(sheet.approvedEmployerCostGrosze) : '…'}
              {costDelta !== null && (
                <span className={styles.delta} title={`Różnica do ${monthGenitive(previousMonth)}`}>
                  {signed(costDelta)} vs {MONTH_NAMES[Number(previousMonth.slice(5)) - 1]}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Wymaga uwagi</dt>
            <dd className={attentionCount > 0 ? styles.attention : undefined}>{sheet ? attentionCount : '…'}</dd>
          </div>
        </dl>
      </div>

      {pendingMonth && (
        <div className={styles.banner} role="alert">
          <span>
            Masz niezapisane zmiany w {dirtyRows.length} {dirtyRows.length === 1 ? 'wierszu' : 'wierszach'}. Zatwierdź je albo porzuć, zanim przejdziesz do miesiąca {pendingMonth}.
          </span>
          <span className={styles.rowActions}>
            <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setPendingMonth(null)}>Zostań</button>
            <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={() => navigate(pendingMonth)}>Porzuć zmiany</button>
            <button type="button" className={styles.btn} disabled={chosen.length === 0 || saving} onClick={() => void approveAndLeave()}>
              Zatwierdź zaznaczone ({chosen.length})
            </button>
          </span>
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}

      <section className={styles.ledger} aria-label="Pracownicy w miesiącu">
        <div className={styles.sheetHead} aria-hidden>
          <span />
          <span>Osoba</span>
          <span>Brutto</span>
          <span>Netto</span>
          <span>Koszt pracodawcy</span>
          <span>Δ brutto</span>
          <span>Status</span>
          <span />
        </div>
        {sheet === null && <p className={styles.empty}>Ładowanie…</p>}
        {sheet?.rows.length === 0 && <p className={styles.empty}>Brak osób na liście płac w tym miesiącu.</p>}
        {rows.map((row) => {
          const id = row.employee.id
          const name = personName(row)
          const draft = draftOf(row)
          const origin = initial.get(id)?.origin ?? 'empty'
          const dirty = isDirty(row)
          const touched = id in edits
          const suggested = origin === 'suggestion' && !touched
          const approved = isApproved(row)
          const canSelect = selectable(row)
          const cost = previewCost(row)
          const gross = parsePlnToGrosze(draft.gross)
          const diff = row.previous && gross !== null ? gross - row.previous.finalGrossGrosze : null
          const result = results[id]
          const sourceHint = suggested && row.suggestion?.kind === 'PREVIOUS_MONTH' && row.suggestion.sourceMonth
            ? `z ${monthGenitive(row.suggestion.sourceMonth)}`
            : null
          // Hourly basis: "38 h × 50,00 zł" next to gross; the net comes from the last approved proportion.
          const calculation = row.hours?.calculation ?? null
          // A typed gross wins over the calculation (D15); the hint then still shows what was calculated.
          // Non-breaking spaces keep "26 h" and "50,00 zł" whole; the hint wraps between them.
          const keep = (text: string) => text.replace(/ /g, '\u00a0')
          const calcText = calculation
            ? `${keep(formatMinutesAsHours(calculation.approvedMinutes))} × ${keep(formatGrosze(calculation.rateGrosze))}`
            : null
          const calcHint = calculation && calcText
            ? gross !== null && gross !== calculation.grossGrosze
              ? `wyliczono ${calcText} = ${keep(formatGrosze(calculation.grossGrosze))}`
              : `= ${calcText}`
            : null
          const netHint = suggested && row.suggestion?.kind === 'HOURS' && row.suggestion.sourceMonth
            ? `proporcja z ${monthGenitive(row.suggestion.sourceMonth)}`
            : sourceHint
          const hoursNote = hoursNotes[id]
          const invalid = (value: string) => value.trim() !== '' && parsePlnToGrosze(value) === null
          // An approved row is never "blocked": live blockers only matter once someone corrects it.
          const change = approved ? row.changeAfterApproval : null
          const rowClass = [
            styles.sheetRow,
            approved
              ? dirty ? styles.rowSelected : change ? styles.rowChanged : styles.rowApproved
              : row.blockers.length > 0 ? styles.rowBlocked : selected.has(id) && canSelect ? styles.rowSelected : '',
            justApproved.has(id) ? styles.justApproved : '',
          ].join(' ')

          return (
            <div key={id} className={rowClass} data-testid={`payroll-row-${id}`}>
              <div className={styles.aCheck}>
                {approved && !dirty ? (
                  <span className={styles.checkDone} title="Zatwierdzone"><Check aria-hidden size={16} /></span>
                ) : (
                  <input
                    type="checkbox"
                    className={styles.check}
                    aria-label={`Zaznacz do zatwierdzenia — ${name}`}
                    checked={canSelect && selected.has(id)}
                    disabled={!canSelect}
                    onChange={(event) => toggleSelected(id, event.target.checked)}
                  />
                )}
              </div>

              <div className={styles.aPerson}>
                <div className={styles.name}>{name}</div>
                <div className={styles.sub}>
                  {row.contractor && <span className={`${styles.tag} ${styles.tagWarn} ${styles.contractorTag}`}>wykonawca B2B</span>}
                  {row.employee.position} · {row.employee.costCenterId} · {row.employee.employmentType ?? 'brak umowy'}
                  {' · '}
                  {row.currentBase ? (
                    <span title={`${PAYROLL_BASIS_LABELS[row.currentBase.basis]} od ${row.currentBase.effectiveFrom}`}>
                      angaż <span className={styles.num}>{formatGrosze(row.currentBase.amountGrosze)}</span>
                      {row.currentBase.basis === 'HOURLY_GROSS' ? '/h' : ''}
                    </span>
                  ) : (
                    <span>angaż nie ustawiony</span>
                  )}
                </div>
                {row.hours && (
                  <HoursLine
                    name={name}
                    hours={row.hours}
                    busy={approvingHours === id}
                    onApprove={() => void approveHours(row)}
                  />
                )}
              </div>

              <label className={`${styles.cell} ${styles.aGross}`}>
                <span className={styles.cellLabel}>Brutto</span>
                <input
                  ref={bindInput(id, 'gross')}
                  className={`${styles.amount} ${suggested ? styles.suggested : ''} ${invalid(draft.gross) ? styles.amountInvalid : ''}`}
                  aria-label={`Brutto — ${name}`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={draft.gross}
                  onChange={(event) => setDraft(row, { gross: event.target.value })}
                  onKeyDown={(event) => onFieldKey(event, row, 'gross')}
                />
                {calcHint && <span className={styles.calcHint} data-testid={`payroll-calc-${id}`}>{calcHint}</span>}
                {sourceHint && <span className={styles.fieldHint}>{sourceHint}</span>}
              </label>

              <label className={`${styles.cell} ${styles.aNet}`}>
                <span className={styles.cellLabel}>Netto</span>
                <input
                  ref={bindInput(id, 'net')}
                  className={`${styles.amount} ${suggested ? styles.suggested : ''} ${invalid(draft.net) ? styles.amountInvalid : ''}`}
                  aria-label={`Netto — ${name}`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={draft.net}
                  onChange={(event) => setDraft(row, { net: event.target.value })}
                  onKeyDown={(event) => onFieldKey(event, row, 'net')}
                />
                {netHint && <span className={styles.fieldHint}>{netHint}</span>}
              </label>

              <div className={`${styles.cell} ${styles.aCost}`}>
                <span className={styles.cellLabel}>Koszt pracodawcy</span>
                {draft.manual ? (
                  <input
                    ref={bindInput(id, 'cost')}
                    className={`${styles.amount} ${suggested ? styles.suggested : ''} ${invalid(draft.cost) ? styles.amountInvalid : ''}`}
                    aria-label={`Koszt pracodawcy — ${name}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0,00"
                    value={draft.cost}
                    onChange={(event) => setDraft(row, { cost: event.target.value })}
                    onKeyDown={(event) => onFieldKey(event, row, 'cost')}
                  />
                ) : (
                  <span className={styles.costOut}>
                    <output className={`${styles.costValue} ${suggested ? styles.suggested : ''}`} data-testid={`payroll-cost-${id}`} aria-label={`Koszt pracodawcy — ${name}`}>
                      {formatGrosze(cost)}
                    </output>
                  </span>
                )}
                <span className={styles.costTools}>
                  {row.rates ? (
                    <button
                      type="button"
                      className={styles.toggle}
                      aria-label={`${draft.manual ? 'Licz koszt pracodawcy ze stawek' : 'Wpisz koszt pracodawcy ręcznie'} — ${name}`}
                      onClick={() => setDraft(row, draft.manual
                        ? { manual: false }
                        : { manual: true, cost: toInput(cost) })}
                    >
                      {draft.manual ? 'licz ze stawek' : 'wpisz ręcznie'}
                    </button>
                  ) : (
                    <span className={styles.fieldHint}>brak stawek — wpisz koszt</span>
                  )}
                </span>
              </div>

              <div className={styles.aDiff}>
                <span className={styles.cellLabel}>Δ brutto</span>
                {diff === null ? (
                  <span className={styles.diffSame} title="Brak zatwierdzonego poprzedniego miesiąca">—</span>
                ) : (
                  <span
                    className={diff > 0 ? styles.diffUp : diff < 0 ? styles.diffDown : styles.diffSame}
                    title={`Brutto względem ${monthGenitive(row.previous?.month ?? previousMonth)}`}
                  >
                    {diff === 0 ? '=' : signed(diff)}
                  </span>
                )}
              </div>

              <div className={styles.aStatus}><SheetStatus row={row} /></div>

              <div className={styles.aActions}>
                <DropdownMenu>
                  <DropdownMenuTrigger className={styles.menuBtn} aria-label={`Akcje — ${name}`}>
                    <MoreHorizontal aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className={styles.tokens}>
                    {row.settlement ? (
                      <DropdownMenuItem asChild>
                        <Link href={`/hr/payroll/${row.settlement.id}`}>Szczegóły rozliczenia</Link>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem disabled={creatingFor === id} onSelect={() => void openDetail(row)}>
                        Otwórz rozliczenie szczegółowe (utworzy szkic)
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => setBaseFor(row.employee)}>Angaż…</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className={styles.aNotes}>
                {approved && dirty && row.blockers.length === 0 && (
                  <button type="button" className={`${styles.btn} ${styles.rowBtn}`} disabled={saving} onClick={() => void submit([row])}>
                    Zapisz korektę
                  </button>
                )}
                {approved && dirty && row.blockers.length > 0 && !change && row.settlement && (
                  <span className={styles.blockNote}>
                    Tej korekty nie zapiszesz na liście: {row.blockers.map((blocker) => blocker.message).join(' ')}
                    <Link className={`${styles.btn} ${styles.ghost}`} href={`/hr/payroll/${row.settlement.id}`}>Otwórz szczegóły</Link>
                  </span>
                )}
                {change && row.settlement && (
                  <ChangeNotice
                    name={name}
                    change={change}
                    blockers={row.blockers}
                    detailHref={`/hr/payroll/${row.settlement.id}`}
                    busy={acknowledging === id}
                    onAcknowledge={() => void acknowledge(row)}
                  />
                )}
                {!approved && row.blockers.map((blocker) => (
                  <span key={blocker.code} className={styles.blockNote}>
                    {blocker.message}
                    {row.hours && blocker.code === 'HOURLY_ENTRIES_PENDING' && row.hours.approvablePendingEntries > 0 ? (
                      <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={approvingHours === id} onClick={() => void approveHours(row)}>
                        Zatwierdź godziny
                      </button>
                    ) : row.hours && (blocker.code === 'HOURLY_ENTRIES_PENDING' || blocker.code === 'OPEN_TIME_ENTRY') ? (
                      <Link className={`${styles.btn} ${styles.ghost}`} href={`/hr/time-tracking?view=month&mode=employee&month=${month}&employeeId=${id}`}>
                        Czas pracy
                      </Link>
                    ) : blocker.code === 'BASE_MISSING' ? (
                      <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setBaseFor(row.employee)}>Angaż…</button>
                    ) : (
                      <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={creatingFor === id} onClick={() => void openDetail(row)}>
                        {row.settlement ? 'Otwórz' : 'Otwórz (utworzy szkic)'}
                      </button>
                    )}
                  </span>
                ))}
                {!approved && row.flags.map((flag) => <span key={flag.code} className={styles.flag}>{flag.message}</span>)}
                {hoursNote && (
                  <span role={hoursNote.ok ? 'status' : 'alert'} className={`${styles.result} ${hoursNote.ok ? styles.resultOk : styles.resultErr}`}>
                    {hoursNote.text}
                  </span>
                )}
                {result && <ResultNote result={result} />}
              </div>
            </div>
          )
        })}
      </section>

      {sheet && rows.length > 0 && (
        <div className={styles.actionBar} role="region" aria-label="Zatwierdzanie zaznaczonych">
          <span className={styles.actionSummary}>
            <span>zaznaczone <strong>{chosen.length}</strong></span>
            <span>koszt pracodawcy <strong>{formatGrosze(chosenCost)}</strong></span>
            {summary && <span role="status">{summary}</span>}
          </span>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnInvert}`}
            disabled={chosen.length === 0 || saving}
            onClick={() => void submit(chosen)}
          >
            {saving ? 'Zatwierdzam…' : `Zatwierdź zaznaczone (${chosen.length})`}
          </button>
        </div>
      )}

      {baseFor && (
        <BaseSalaryDialog
          employee={baseFor}
          defaultEffectiveFrom={`${month}-01`}
          onClose={() => setBaseFor(null)}
          onChanged={() => setReloadKey((key) => key + 1)}
        />
      )}
    </div>
  )
}

function ResultNote({ result }: { result: RowResult }) {
  switch (result.status) {
    case 'APPROVED':
      return <span role="status" className={`${styles.result} ${styles.resultOk}`}>Zatwierdzono · v{result.versionNumber}</span>
    case 'UNCHANGED':
      return <span role="status" className={`${styles.result} ${styles.resultOk}`}>Bez zmian — kwoty są takie same jak w v{result.versionNumber}.</span>
    case 'BLOCKED':
      return (
        <span role="alert" className={`${styles.result} ${styles.resultErr}`}>
          {result.message}
          <ul>{result.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
        </span>
      )
    case 'CONFLICT':
    case 'INVALID':
      return <span role="alert" className={`${styles.result} ${styles.resultErr}`}>{result.message}</span>
  }
}

/** One line under the heading: is the automat on, and when does it run next. */
function AutomationLine({ status }: { status: AutomationStatus }) {
  return (
    <p className={styles.autoLine} data-testid="payroll-automation-line">
      <span className={`${styles.autoDot} ${status.enabled ? styles.autoOn : ''}`} aria-hidden />
      <span>
        Automat: {status.enabled ? 'włączony' : 'wyłączony'}
        {status.enabled && status.nextRun && <> · następny przebieg {dayMonthGenitive(status.nextRun.date)}</>}
        {status.enabled && !status.schedulerActive && <span className={styles.autoWarn}> · harmonogram nie działa w tym środowisku</span>}
      </span>
      <Link href="/hr/payroll/rates#automat" className={styles.autoLink}>Ustawienia płac</Link>
    </p>
  )
}

/** Hourly basis: "38 h zatwierdzone · 6 h czeka" and the one-click approval of the waiting hours. */
function HoursLine({ name, hours, busy, onApprove }: {
  name: string
  hours: NonNullable<SheetRow['hours']>
  busy: boolean
  onApprove: () => void
}) {
  const open = hours.pendingEntries - hours.approvablePendingEntries
  return (
    <div className={styles.hoursLine}>
      <span data-testid="payroll-hours">
        <span className={styles.hoursApproved}><span className={styles.num}>{formatMinutesAsHours(hours.approvedMinutes)}</span> zatwierdzone</span>
        {hours.approvablePendingEntries > 0 && (
          <span className={styles.hoursWaiting}> · <span className={styles.num}>{formatMinutesAsHours(hours.pendingMinutes)}</span> czeka</span>
        )}
        {open > 0 && <span className={styles.hoursWaiting}> · {entriesPl(open)} bez wyjścia</span>}
      </span>
      {hours.approvablePendingEntries > 0 && (
        <button
          type="button"
          className={`${styles.btn} ${styles.ghost} ${styles.rowBtn}`}
          disabled={busy}
          aria-label={`Zatwierdź godziny — ${name}`}
          onClick={onApprove}
        >
          {busy ? 'Zatwierdzam…' : 'Zatwierdź godziny'}
        </button>
      )}
    </div>
  )
}

/**
 * Approved row whose pay-relevant inputs changed after approval (D9). The approved amount stays in
 * force; the ADMIN either corrects it (in the row, or on the detail page when the live calendar has
 * a blocker such as overtime without a decision) or confirms it with "Kwota aktualna".
 */
function ChangeNotice({ name, change, blockers, detailHref, busy, onAcknowledge }: {
  name: string
  change: NonNullable<SheetRow['changeAfterApproval']>
  blockers: Note[]
  detailHref: string
  busy: boolean
  onAcknowledge: () => void
}) {
  return (
    <div className={styles.changeNote} role="group" aria-label={`Zmiana po zatwierdzeniu — ${name}`}>
      <span className={styles.changeHead}>
        <span className={styles.changeTitle}>zmiana po zatwierdzeniu — sprawdź kwotę</span>
        {change.changes.map((item) => <span key={item.code} className={styles.changeChip}>{item.message}</span>)}
      </span>
      <span className={styles.changeHint}>
        {blockers.length > 0
          ? <>Korekta tylko na stronie szczegółów: {blockers.map((blocker) => blocker.message).join(' ')}</>
          : <>Popraw kwotę w wierszu i zapisz korektę albo potwierdź, że zatwierdzona kwota jest aktualna.</>}
      </span>
      <span className={styles.changeActions}>
        {blockers.length > 0 && (
          <Link className={`${styles.btn} ${styles.ghost} ${styles.rowBtn}`} href={detailHref}>Otwórz szczegóły</Link>
        )}
        <button
          type="button"
          className={`${styles.btn} ${styles.ghost} ${styles.rowBtn}`}
          disabled={busy}
          aria-label={`Kwota aktualna — ${name}`}
          onClick={onAcknowledge}
        >
          {busy ? 'Zapisuję…' : 'Kwota aktualna'}
        </button>
      </span>
    </div>
  )
}
