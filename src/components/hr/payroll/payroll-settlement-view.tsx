'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { formatGrosze, formatMinutesAsHours, groszeToPlnString, parsePlnToGrosze } from '@/lib/payroll/money'
import { calculateEmployerCostGrosze } from '@/lib/payroll/employer-cost'
import { monthGenitive } from '@/lib/payroll/month-names'
import { pluralPl } from '@/lib/plural-pl'
import { BLOCKER_LABELS, WARNING_LABELS, type PayrollBlocker, type PayrollWarning } from '@/lib/payroll/summary'
import { PAYROLL_BASIS_LABELS, type OvertimeResolution, type PayrollBasis } from '@/lib/payroll/types'
import { StatusStamp } from './payroll-month-view'
import { EmployerCostPanel, describeRates, describeSplit, type EmployerCostContextView } from './employer-cost-panel'
import styles from './payroll.module.css'

type Line = {
  id: string
  date: string
  overtimeMinutes: number
  entryStatus: 'pending' | 'approved' | 'rejected'
  isSaturday: boolean
  resolution: OvertimeResolution | null
  resolutionSource: 'OVERTIME_REQUEST' | 'ADMIN' | null
}
type Adjustment = {
  id: string
  kind: 'BONUS' | 'CORRECTION'
  label: string
  amountGrosze: number
  note: string | null
  deletedAt: string | null
}
type Version = {
  id: string
  versionNumber: number
  finalGrossGrosze: number
  finalNetGrosze: number
  employerCostGrosze: number
  approvedAt: string
  approvedById: string
  approvalNote: string | null
  payrollOfficeReference: string | null
  employerCostSource: string
  supersededAt: string | null
  origin: 'MANUAL' | 'AUTO_CARRYOVER'
}
type AuditEvent = {
  id: string
  action: string
  beforeJson: string | null
  afterJson: string | null
  reason: string | null
  actorId: string
  createdAt: string
}
type Detail = {
  id: string
  year: number
  month: number
  status: 'DRAFT' | 'APPROVED'
  revision: number
  employee: { id: string; firstName: string; lastName: string; position: string; costCenterId: string; employmentType: string | null; startDate: string }
  baseSalaryGrosze: number | null
  baseBasis: PayrollBasis | null
  baseSegments: Array<{ from: string; amountGrosze: number; basis: PayrollBasis }>
  approvedWorkedMinutes: number
  pendingEntryCount: number
  calendarSyncedAt: string | null
  calendarInSync: boolean
  finalGrossGrosze: number | null
  finalNetGrosze: number | null
  employerCostGrosze: number | null
  employerCostSource: 'CALCULATED' | 'OVERRIDDEN' | null
  employerCostContext: EmployerCostContextView
  payrollOfficeReference: string | null
  payrollOfficeConfirmedAt: string | null
  currentVersionNumber: number
  overtimeLines: Line[]
  adjustments: Adjustment[]
  versions: Version[]
  auditEvents: AuditEvent[]
  actors: Record<string, string>
  /** "YYYY-MM" and the payroll list number of the month (read-only here; set on the month sheet). */
  monthKey: string
  listReference: string | null
  /** The month sheet's view of this person: the same suggestion and notes the sheet shows. */
  sheetRow: {
    suggestion: {
      kind: 'PREVIOUS_MONTH' | 'HOURS'
      finalGrossGrosze: number
      finalNetGrosze: number | null
      employerCostGrosze: number | null
      employerCostSource: 'CALCULATED' | 'OVERRIDDEN'
      sourceMonth: string | null
    } | null
    hours: {
      approvedMinutes: number
      pendingMinutes: number
      pendingEntries: number
      approvablePendingEntries: number
      openEntries: number
      calculation: { rateGrosze: number; approvedMinutes: number; grossGrosze: number } | null
    } | null
    flags: Array<{ code: string; message: string }>
  } | null
  summary: {
    bonusesGrosze: number
    correctionsGrosze: number
    payoutOvertimeMinutes: number
    timeOffOvertimeMinutes: number
    pendingOvertimeMinutes: number
    rejectedOvertimeMinutes: number
    inputBlockers: PayrollBlocker[]
    approvalBlockers: PayrollBlocker[]
    warnings: PayrollWarning[]
  }
}

const AUDIT_LABELS: Record<string, string> = {
  'settlement.create': 'Utworzono rozliczenie',
  'calendar.sync': 'Pobrano dane z kalendarza i podstawy',
  'overtime.resolve': 'Rozstrzygnięto nadgodziny',
  'adjustment.add': 'Dodano pozycję',
  'adjustment.update': 'Zmieniono pozycję',
  'adjustment.delete': 'Usunięto pozycję',
  'payrollOffice.confirm': 'Zapisano dane od kadrowej',
  'settlement.approve': 'Zatwierdzono wersję',
  'settlement.reopen': 'Otwarto do korekty',
  'settlement.changesAcknowledged': 'Kwota aktualna mimo zmiany po zatwierdzeniu',
}

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']
const dateTime = (iso: string) => new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })

const FIELD_LABELS: Record<string, string> = {
  month: 'miesiąc',
  kind: 'rodzaj',
  label: 'nazwa',
  note: 'notatka',
  amountGrosze: 'kwota',
  baseSalaryGrosze: 'podstawa',
  approvedWorkedMinutes: 'przepracowane',
  overtimeLines: 'dni z nadgodzinami',
  date: 'dzień',
  minutes: 'nadgodziny',
  resolution: 'rozliczenie',
  finalGrossGrosze: 'brutto',
  finalNetGrosze: 'netto',
  employerCostGrosze: 'koszt pracodawcy',
  reference: 'lista płac',
  versionNumber: 'wersja',
  status: 'status',
  effectiveVersionStillCounted: 'w kosztach nadal wersja',
  payrollOfficeConfirmationCleared: 'potwierdzenie kadrowej unieważnione',
  origin: 'zatwierdził',
  changesText: 'zmiany',
  hourlyRateGrosze: 'stawka godzinowa',
}
const VALUE_LABELS: Record<string, string> = {
  BONUS: 'premia',
  CORRECTION: 'korekta',
  PAYOUT: 'wypłata',
  TIME_OFF: 'czas wolny',
  DRAFT: 'robocze',
  APPROVED: 'zatwierdzone',
  MANUAL: 'ręcznie',
  AUTO_CARRYOVER: 'automat (przeniesienie z poprzedniego miesiąca)',
}

function formatAuditValue(key: string, value: unknown): string {
  if (typeof value === 'number' && key.endsWith('Grosze')) return formatGrosze(value)
  if (typeof value === 'number' && /minutes|Minutes/.test(key)) return formatMinutesAsHours(value)
  if (typeof value === 'boolean') return value ? 'tak' : 'nie'
  if (Array.isArray(value)) return String(value.length)
  return VALUE_LABELS[String(value)] ?? String(value)
}

function describeDiff(event: AuditEvent) {
  const fmt = (json: string | null) => {
    if (!json) return null
    const value = JSON.parse(json) as Record<string, unknown>
    return Object.entries(value)
      .filter(([k, v]) => v !== null && FIELD_LABELS[k] && (typeof v !== 'object' || Array.isArray(v)))
      .map(([k, v]) => `${FIELD_LABELS[k]}: ${formatAuditValue(k, v)}`)
      .join(', ')
  }
  const before = fmt(event.beforeJson)
  const after = fmt(event.afterJson)
  return [before && `przed — ${before}`, after && `po — ${after}`].filter(Boolean).join(' · ')
}

type AmountDraft = { gross: string; net: string; cost: string; manual: boolean }
type AmountOrigin = 'approved' | 'draft' | 'suggestion' | 'empty'

const toInput = (grosze: number | null | undefined) => (grosze == null ? '' : groszeToPlnString(grosze).replace('.', ','))
const keepTogether = (text: string) => text.replace(/ /g, ' ')

/** Same order as the month sheet: effective version → draft amounts → suggestion → empty. */
function baselineOf(detail: Detail): { draft: AmountDraft; origin: AmountOrigin } {
  const rates = detail.employerCostContext.rates
  const manualFor = (source: string | null | undefined) => !rates || (source != null && source !== 'CALCULATED')
  const effective = detail.versions.find((version) => version.supersededAt === null)
  if (effective) {
    return {
      draft: {
        gross: toInput(effective.finalGrossGrosze),
        net: toInput(effective.finalNetGrosze),
        cost: toInput(effective.employerCostGrosze),
        manual: manualFor(effective.employerCostSource),
      },
      origin: 'approved',
    }
  }
  if (detail.finalGrossGrosze != null) {
    return {
      draft: {
        gross: toInput(detail.finalGrossGrosze),
        net: toInput(detail.finalNetGrosze),
        cost: toInput(detail.employerCostGrosze),
        manual: manualFor(detail.employerCostSource),
      },
      origin: 'draft',
    }
  }
  const suggestion = detail.sheetRow?.suggestion ?? null
  if (suggestion) {
    return {
      draft: {
        gross: toInput(suggestion.finalGrossGrosze),
        net: toInput(suggestion.finalNetGrosze),
        cost: toInput(suggestion.employerCostGrosze),
        manual: manualFor(suggestion.employerCostSource),
      },
      origin: 'suggestion',
    }
  }
  return { draft: { gross: '', net: '', cost: '', manual: !rates }, origin: 'empty' }
}

/** A folded panel: native <details>, opens by click and by Enter/Space on the summary. */
function Fold({ id, title, summary, defaultOpen, children }: {
  id: string
  title: string
  summary: string
  defaultOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      className={`${styles.panel} ${styles.fold}`}
      data-testid={`fold-${id}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ChevronRight aria-hidden size={16} className={styles.foldChevron} />
        <span className={styles.panelTitle}>{title}</span>{' '}
        <span className={styles.panelNote} data-testid={`fold-${id}-summary`}>{summary}</span>
      </summary>
      {children}
    </details>
  )
}

export function PayrollSettlementView({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blockers, setBlockers] = useState<string[]>([])
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  // What the owner typed in "Kwoty i zatwierdzenie"; null = the fields show the baseline (version, draft or suggestion).
  const [edit, setEdit] = useState<AmountDraft | null>(null)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')

  const [reloadKey, setReloadKey] = useState(0)
  const load = () => setReloadKey((key) => key + 1)

  useEffect(() => {
    let active = true
    fetch(`/api/hr/payroll/settlements/${id}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!active) return
        if (!res.ok) {
          setError(res.status === 404 ? 'Rozliczenie nie istnieje.' : 'Brak dostępu lub błąd pobierania.')
          return
        }
        const json = await res.json()
        if (active) setDetail(json)
      })
      .catch(() => active && setError('Błąd połączenia.'))
    return () => { active = false }
  }, [id, reloadKey])

  function failure(res: Response, json: { error?: string; details?: { fieldErrors?: Record<string, string[]>; blockers?: Array<{ message: string }> } }) {
    const fieldErrors = json.details?.fieldErrors ? Object.values(json.details.fieldErrors).flat() as string[] : []
    setBlockers((json.details?.blockers ?? []).map((b) => b.message))
    if (json.details?.fieldErrors?.reason) {
      // Said once, under the field it belongs to.
      setReasonError(json.details.fieldErrors.reason[0])
    } else {
      setError(fieldErrors[0] ?? json.error ?? 'Nie udało się zapisać.')
    }
    if (res.status === 409) load()
  }

  async function act(body: Record<string, unknown>) {
    if (!detail) return false
    setPending(true)
    setError(null)
    setNotice(null)
    setBlockers([])
    const res = await fetch(`/api/hr/payroll/settlements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: detail.revision, ...body }),
    }).catch(() => null)
    if (!res) {
      // A dropped connection must not leave every button disabled until a reload.
      setPending(false)
      setError('Błąd połączenia — nic nie zapisano. Spróbuj ponownie.')
      return false
    }
    const json = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      failure(res, json)
      return false
    }
    setDetail(json)
    return true
  }

  function submitForm(handler: (form: FormData) => Record<string, unknown>) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const formElement = event.currentTarget
      const submitter = (event.nativeEvent as SubmitEvent).submitter
      if (await act(handler(new FormData(formElement, submitter)))) {
        formElement.reset()
        setEditing(null)
      }
    }
  }

  /** "Zapisz i zatwierdź" / "Zapisz korektę": the month sheet's server path (settleEmployeeMonth). */
  async function settle(event: FormEvent<HTMLFormElement>, draft: AmountDraft, approvedNow: boolean) {
    event.preventDefault()
    if (!detail) return
    setPending(true)
    setError(null)
    setNotice(null)
    setBlockers([])
    setReasonError(null)
    const res = await fetch(`/api/hr/payroll/settlements/${id}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: detail.revision,
        finalGross: draft.gross,
        finalNet: draft.net,
        ...(draft.manual ? { employerCost: draft.cost } : {}),
        note: approvedNow ? null : note.trim() || null,
        reason: approvedNow ? reason.trim() || null : null,
      }),
    }).catch(() => null)
    if (!res) {
      setPending(false)
      setError('Błąd połączenia — nic nie zapisano. Spróbuj ponownie.')
      return
    }
    const json = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      failure(res, json)
      return
    }
    setDetail(json.detail)
    setEdit(null)
    setNote('')
    setReason('')
    setNotice(json.outcome === 'UNCHANGED'
      ? 'Kwoty bez zmian — nie utworzono nowej wersji.'
      : approvedNow ? `Zapisano korektę: wersja ${json.versionNumber} obowiązuje.` : `Zatwierdzono wersję ${json.versionNumber}.`)
  }

  if (!detail) {
    return (
      <div className={styles.page}>
        {error ? <p className={styles.error} role="alert">{error}</p> : <p className={styles.hint}>Ładowanie…</p>}
      </div>
    )
  }

  const isDraft = detail.status === 'DRAFT'
  const s = detail.summary
  const confirmed = Boolean(detail.payrollOfficeConfirmedAt)
  // D15: at an hourly rate every approved hour is paid at the rate — no "payout or time off" decision.
  const hourly = detail.baseBasis === 'HOURLY_GROSS'
  const costContext = detail.employerCostContext
  const canCalculate = costContext.rates !== null
  const baseline = baselineOf(detail)
  const draft = edit ?? baseline.draft
  const suggestion = detail.sheetRow?.suggestion ?? null
  const suggested = baseline.origin === 'suggestion' && edit === null
  const grossPreview = parsePlnToGrosze(draft.gross)
  const employerCostPreview = canCalculate && grossPreview !== null && grossPreview > 0
    ? calculateEmployerCostGrosze(grossPreview, costContext.rates!)
    : null
  const employerCostHint = detail.employerCostSource === 'CALCULATED' ? 'wyliczony ze stawek'
    : detail.employerCostSource === 'OVERRIDDEN' ? 'wpisany ręcznie' : null
  const figureHint = !detail.finalGrossGrosze ? 'jeszcze niewpisane'
    : !isDraft ? 'zatwierdzone'
      : confirmed ? 'zapisane — niezatwierdzone'
        : 'niepotwierdzone — dane wejściowe zmieniły się'

  // The blockers the saving button resolves itself (it confirms the figures and recalculates the cost) are not listed.
  const listedBlockers = s.approvalBlockers.filter((code) => code !== 'PAYROLL_OFFICE_NOT_CONFIRMED' && code !== 'EMPLOYER_COST_STALE')
  const draftFlags = isDraft ? detail.sheetRow?.flags ?? [] : []
  const monthHref = `/hr/payroll?month=${detail.monthKey}`
  const effectiveVersion = detail.versions.find((version) => version.supersededAt === null) ?? null

  // Hourly: "= 26 h × 50,00 zł" under gross; a typed gross wins and the hint shows what was calculated (D15).
  const calculation = detail.sheetRow?.hours?.calculation ?? null
  const calcText = calculation ? `${keepTogether(formatMinutesAsHours(calculation.approvedMinutes))} × ${keepTogether(formatGrosze(calculation.rateGrosze))}` : null
  const calcHint = calculation && calcText
    ? grossPreview !== null && grossPreview !== calculation.grossGrosze
      ? `wyliczono ${calcText} = ${keepTogether(formatGrosze(calculation.grossGrosze))}`
      : `= ${calcText}`
    : null
  const sourceHint = suggested && suggestion?.sourceMonth
    ? suggestion.kind === 'HOURS' ? `proporcja z ${monthGenitive(suggestion.sourceMonth)}` : `podpowiedź z ${monthGenitive(suggestion.sourceMonth)}`
    : null
  const invalid = (value: string) => value.trim() !== '' && parsePlnToGrosze(value) === null
  const readyToSave = parsePlnToGrosze(draft.gross) !== null && parsePlnToGrosze(draft.net) !== null
    && (!draft.manual || parsePlnToGrosze(draft.cost) !== null)
  const setDraft = (patch: Partial<AmountDraft>) => setEdit({ ...draft, ...patch })

  // The summary of a folded panel follows its title: "Wersje · 2 · obowiązuje v2".
  const versionsSummary = detail.versions.length === 0
    ? '· brak zatwierdzonych'
    : `· ${detail.versions.length} · ${effectiveVersion ? `obowiązuje v${effectiveVersion.versionNumber}` : 'żadna nie obowiązuje'}`
  const eventsCount = detail.auditEvents.length
  const historySummary = `· ${eventsCount} ${pluralPl(eventsCount, 'zdarzenie', 'zdarzenia', 'zdarzeń')}`
  const legacyReference = isDraft && detail.payrollOfficeReference && detail.payrollOfficeReference !== detail.listReference
    ? detail.payrollOfficeReference
    : null

  return (
    <div className={`${styles.page} ${styles.detailPage} ${styles.reveal}`} data-testid="settlement-page">
      <Link href={monthHref} className={styles.eyebrow} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <ArrowLeft size={14} /> Wynagrodzenia · {MONTHS[detail.month - 1]} {detail.year}
      </Link>

      {/* (1) Header with the three figures */}
      <section className={`${styles.slip} ${styles.slipCompact}`} aria-label="Podsumowanie rozliczenia">
        <div className={styles.slipTop}>
          <div>
            <div className={styles.slipName}>{detail.employee.firstName} {detail.employee.lastName}</div>
            <div className={styles.slipMeta}>
              {MONTHS[detail.month - 1]} {detail.year} · {detail.employee.position} · {detail.employee.costCenterId} · {detail.employee.employmentType ?? 'umowa nieokreślona'}
            </div>
          </div>
          <StatusStamp
            settlement={{ id: detail.id, status: detail.status, currentVersionNumber: detail.currentVersionNumber, payrollOfficeConfirmedAt: detail.payrollOfficeConfirmedAt }}
            origin={effectiveVersion?.origin}
          />
        </div>
        <div className={styles.figures}>
          {[
            ['Brutto (ostateczne)', detail.finalGrossGrosze],
            ['Netto do wypłaty', detail.finalNetGrosze],
            ['Pełny koszt pracodawcy', detail.employerCostGrosze],
          ].map(([label, value]) => (
            <div key={label as string} className={styles.figure}>
              <div className={styles.figureLabel}>{label}</div>
              <div className={styles.figureValue} data-testid={`figure-${label}`}>{formatGrosze(value as number | null)}</div>
              <div className={styles.figureHint}>
                {figureHint}{label === 'Pełny koszt pracodawcy' && employerCostHint ? ` · ${employerCostHint}` : ''}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* (2) Blockers and warnings */}
      {!detail.calendarInSync && (
        <div className={styles.banner} role="status">
          <span>
            {isDraft
              ? 'Kalendarz czasu pracy lub podstawa zmieniły się od ostatniego pobrania.'
              : 'Kalendarz lub podstawa zmieniły się po zatwierdzeniu. Jeśli to wpływa na wypłatę — popraw kwoty poniżej z powodem korekty.'}
          </span>
          {isDraft && (
            <button type="button" className={styles.btn} disabled={pending} onClick={() => act({ action: 'calendar.sync' })}>
              <RefreshCw size={14} /> Pobierz ponownie
            </button>
          )}
        </div>
      )}
      {isDraft && listedBlockers.length > 0 && (
        <section className={styles.blockerBox} aria-label="Blokady zatwierdzenia">
          <ul className={styles.blockers} data-testid="approval-blockers">
            {listedBlockers.map((code) => <li key={code}>{BLOCKER_LABELS[code]}</li>)}
          </ul>
        </section>
      )}
      {s.warnings.length > 0 && (
        <ul className={`${styles.blockers} ${styles.warn}`}>
          {s.warnings.map((code) => <li key={code}>{WARNING_LABELS[code]}</li>)}
        </ul>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
          {blockers.length > 0 && <ul className={styles.blockers} style={{ marginTop: 8 }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        </div>
      )}
      {notice && <p className={styles.okLine} role="status" data-testid="settle-notice">{notice}</p>}

      {/* (3) Amounts and approval */}
      <section className={styles.panel} aria-labelledby="amounts-title">
        <header className={styles.panelHead}>
          <h2 id="amounts-title" className={styles.panelTitle}>Kwoty i zatwierdzenie</h2>
          <span className={styles.panelNote} data-testid="payroll-list-reference">
            Lista płac: {detail.listReference ? <span className={styles.num}>{detail.listReference}</span> : 'bez numeru'}
            {' · '}
            <Link href={monthHref} className={styles.inlineLink}>zmień na arkuszu miesiąca</Link>
          </span>
        </header>
        <form className={`${styles.panelBody} ${styles.amountsForm}`} onSubmit={(event) => settle(event, draft, !isDraft)} noValidate>
          <label className={styles.field}>
            Brutto (ostateczne)
            <input
              name="finalGross"
              inputMode="decimal"
              placeholder="0,00"
              className={`${styles.amountInput} ${suggested ? styles.suggested : ''} ${invalid(draft.gross) ? styles.amountInvalid : ''}`}
              value={draft.gross}
              onChange={(e) => setDraft({ gross: e.target.value })}
            />
            <span className={styles.fieldNote} data-testid="payroll-detail-calc">{calcHint ?? ' '}</span>
          </label>
          <label className={styles.field}>
            Netto do wypłaty
            <input
              name="finalNet"
              inputMode="decimal"
              placeholder="0,00"
              className={`${styles.amountInput} ${suggested ? styles.suggested : ''} ${invalid(draft.net) ? styles.amountInvalid : ''}`}
              value={draft.net}
              onChange={(e) => setDraft({ net: e.target.value })}
            />
            <span className={styles.fieldNote}>{sourceHint ?? ' '}</span>
          </label>
          <div className={styles.field}>
            <span>Pełny koszt pracodawcy</span>
            {canCalculate && !draft.manual ? (
              <p className={`${styles.num} ${styles.costOutput}`} data-testid="employer-cost-preview">
                {employerCostPreview === null ? 'wpisz brutto' : formatGrosze(employerCostPreview)}
              </p>
            ) : (
              <input
                name="employerCost"
                inputMode="decimal"
                placeholder="0,00"
                aria-label="Pełny koszt pracodawcy"
                className={`${styles.amountInput} ${suggested ? styles.suggested : ''} ${invalid(draft.cost) ? styles.amountInvalid : ''}`}
                value={draft.cost}
                onChange={(e) => setDraft({ cost: e.target.value })}
              />
            )}
            {canCalculate && (
              <label className={styles.hint}>
                <input type="checkbox" checked={draft.manual} onChange={(e) => setDraft({ manual: e.target.checked })} />{' '}
                wpisz ręcznie (wyjątek — zapisze się jako nadpisany)
              </label>
            )}
          </div>

          {isDraft ? (
            <>
              <label className={`${styles.field} ${styles.noteField}`}>
                Notatka do wersji (opcjonalnie)
                <input name="note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className={styles.saveCell}>
                <button type="submit" className={styles.btn} disabled={pending || listedBlockers.length > 0 || !readyToSave}>
                  Zapisz i zatwierdź
                </button>
              </div>
            </>
          ) : (
            <>
              <label className={`${styles.field} ${styles.noteField}`}>
                Powód korekty (wymagany)
                <input
                  name="reason"
                  maxLength={500}
                  value={reason}
                  aria-invalid={reasonError !== null}
                  aria-describedby="reason-hint"
                  onChange={(e) => { setReason(e.target.value); setReasonError(null) }}
                />
              </label>
              <div className={styles.saveCell}>
                <button type="submit" className={styles.btn} disabled={pending || !readyToSave}>
                  Zapisz korektę
                </button>
              </div>
            </>
          )}
          <div className={styles.amountsHints}>
            {!isDraft && (
              <p id="reason-hint" className={reasonError ? styles.fieldError : styles.hint} role={reasonError ? 'alert' : undefined}>
                {reasonError ?? `Wersja ${detail.currentVersionNumber} obowiązuje, dopóki nie zapiszesz korekty. Korekta bez powodu zostanie odrzucona.`}
              </p>
            )}
            {isDraft && detail.currentVersionNumber > 0 && (
              <p className={styles.hint}>
                Do czasu zatwierdzenia w kosztach liczy się wersja {detail.currentVersionNumber}. Nowa wersja ją zastąpi — koszt nie zostanie zdublowany.
              </p>
            )}
            <p className={styles.hint}>{describeRates(costContext)}</p>
            {draftFlags.length > 0 && (
              <ul className={`${styles.blockers} ${styles.warn}`} data-testid="detail-flags">
                {draftFlags.map((flag) => <li key={flag.code}>{flag.message}</li>)}
              </ul>
            )}
            {legacyReference && (
              <p className={styles.hint}>
                Wcześniejsza notatka przy tym rozliczeniu: „{legacyReference}” — zostanie zastąpiona numerem listy płac miesiąca przy zatwierdzeniu (zostaje w historii zmian).
              </p>
            )}
          </div>
        </form>
      </section>

      {/* (4) Overtime from the calendar */}
      <section className={styles.panel} aria-labelledby="ot-title">
        <header className={styles.panelHead}>
          <h2 id="ot-title" className={styles.panelTitle}>Nadgodziny z kalendarza</h2>
          <span className={styles.panelNote}>
            {hourly
              ? <>płatne stawką · przepracowane {formatMinutesAsHours(detail.approvedWorkedMinutes)}</>
              : <>do wypłaty {formatMinutesAsHours(s.payoutOvertimeMinutes)} · czas wolny {formatMinutesAsHours(s.timeOffOvertimeMinutes)}</>}
          </span>
        </header>
        <div className={styles.panelBody}>
          <p className={styles.hint}>
            Godziny nie są tu wpisywane — pochodzą z modułu Czas pracy. Liczą się wyłącznie wpisy zatwierdzone.
            {detail.calendarSyncedAt && ` Ostatnie pobranie: ${dateTime(detail.calendarSyncedAt)}.`}
          </p>
          {hourly && (
            <p className={styles.okLine} data-testid="hourly-overtime-info">
              Stawka godzinowa: każda zatwierdzona godzina — także w sobotę i ponad normę — jest płatna tą samą stawką. Nie wybierasz „wypłata czy czas wolny”.
            </p>
          )}
          {detail.overtimeLines.length === 0 && <p className={styles.hint}>Brak nadgodzin w kalendarzu za ten miesiąc.</p>}
          <div className={styles.lines}>
            {detail.overtimeLines.map((line) => (
              <div key={line.id} className={styles.line} data-testid={`ot-${line.date}`}>
                <span className={styles.lineDate}>{line.date}</span>
                <span>
                  <span className={styles.num}>{formatMinutesAsHours(line.overtimeMinutes)}</span>
                  {line.isSaturday && <span className={styles.tag}>sobota</span>}
                  {line.entryStatus === 'pending' && <span className={`${styles.tag} ${styles.tagWarn}`}>niezatwierdzony wpis</span>}
                  {line.entryStatus === 'rejected' && <span className={`${styles.tag} ${styles.tagWarn}`}>odrzucony — nie liczy się</span>}
                  {line.resolutionSource === 'OVERTIME_REQUEST' && <span className={styles.tag}>z wniosku</span>}
                </span>
                {hourly ? (
                  <span className={styles.tag}>płatne stawką</span>
                ) : (
                  <span className={styles.seg} role="group" aria-label={`Rozliczenie nadgodzin ${line.date}`}>
                    {(['PAYOUT', 'TIME_OFF'] as const).map((resolution) => (
                      <button
                        key={resolution}
                        type="button"
                        aria-pressed={line.resolution === resolution}
                        disabled={!isDraft || pending || line.entryStatus !== 'approved'}
                        onClick={() => act({ action: 'overtime.resolve', lineId: line.id, resolution })}
                      >
                        {resolution === 'PAYOUT' ? 'Wypłata' : 'Czas wolny'}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* (5) Bonuses and corrections */}
      <section className={styles.panel} aria-labelledby="adj-title">
        <header className={styles.panelHead}>
          <h2 id="adj-title" className={styles.panelTitle}>Premie i korekty</h2>
          <span className={styles.panelNote}>premie {formatGrosze(s.bonusesGrosze)} · korekty {formatGrosze(s.correctionsGrosze)}</span>
        </header>
        <div className={styles.panelBody}>
          {detail.adjustments.length === 0 && <p className={styles.hint}>Brak pozycji.</p>}
          <div>
            {detail.adjustments.map((adj) => (
              <div key={adj.id}>
                <div className={`${styles.adj} ${adj.deletedAt ? styles.adjDeleted : ''}`}>
                  <div>
                    <div className={styles.name}>{adj.label} <span className={styles.tag}>{adj.kind === 'BONUS' ? 'premia' : 'korekta'}</span></div>
                    {adj.note && <div className={styles.sub}>{adj.note}</div>}
                  </div>
                  <span className={`${styles.num} ${adj.amountGrosze < 0 ? styles.amountNeg : styles.amountPos}`}>{formatGrosze(adj.amountGrosze)}</span>
                  {isDraft && !adj.deletedAt ? (
                    <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setEditing(editing === adj.id ? null : adj.id)}>
                      {editing === adj.id ? 'Anuluj' : 'Popraw'}
                    </button>
                  ) : <span />}
                </div>
                {editing === adj.id && (
                  <form
                    className={styles.form}
                    style={{ padding: '10px 0 14px' }}
                    onSubmit={submitForm((form) => form.get('intent') === 'delete'
                      ? { action: 'adjustment.delete', adjustmentId: adj.id, reason: form.get('reason') }
                      : { action: 'adjustment.update', adjustmentId: adj.id, label: form.get('label'), amount: form.get('amount'), note: form.get('note') || null, reason: form.get('reason') })}
                  >
                    <label className={styles.field}>Nazwa<input name="label" defaultValue={adj.label} required /></label>
                    <label className={styles.field}>Kwota (PLN)<input name="amount" defaultValue={groszeToPlnString(adj.amountGrosze).replace('.', ',')} required /></label>
                    <label className={`${styles.field} ${styles.full}`}>Notatka<input name="note" defaultValue={adj.note ?? ''} /></label>
                    <label className={`${styles.field} ${styles.full}`}>Powód zmiany (trafi do historii)<input name="reason" required minLength={3} /></label>
                    <div className={`${styles.full} ${styles.rowActions}`}>
                      <button type="submit" name="intent" value="delete" className={`${styles.btn} ${styles.danger}`} disabled={pending}>
                        Usuń
                      </button>
                      <button type="submit" className={styles.btn} disabled={pending}>Zapisz zmianę</button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
          {isDraft && (
            <form
              className={styles.form}
              onSubmit={submitForm((form) => ({
                action: 'adjustment.add',
                kind: form.get('kind'),
                label: form.get('label'),
                amount: form.get('amount'),
                note: form.get('note') || null,
              }))}
            >
              <label className={styles.field}>
                Rodzaj
                <select name="kind" defaultValue="BONUS">
                  <option value="BONUS">Premia (kwota dodatnia)</option>
                  <option value="CORRECTION">Korekta (+/−)</option>
                </select>
              </label>
              <label className={styles.field}>Kwota (PLN)<input name="amount" inputMode="decimal" placeholder="0,00" required /></label>
              <label className={`${styles.field} ${styles.full}`}>Nazwa<input name="label" placeholder="np. premia sprzedażowa" required minLength={2} /></label>
              <label className={`${styles.field} ${styles.full}`}>Notatka (opcjonalnie)<input name="note" /></label>
              <div className={`${styles.full} ${styles.rowActions}`}>
                <button type="submit" className={styles.btn} disabled={pending}>Dodaj pozycję</button>
              </div>
            </form>
          )}
          {!isDraft && (
            <form
              className={styles.form}
              onSubmit={submitForm((form) => ({ action: 'reopen', reason: form.get('reason') }))}
            >
              <p className={`${styles.hint} ${styles.full}`}>
                Zatwierdzone rozliczenie jest zablokowane. Żeby dodać premię, rozstrzygnąć nadgodziny albo pobrać kalendarz, otwórz korektę — wersja {detail.currentVersionNumber} liczy się w kosztach, dopóki nie zatwierdzisz nowej.
              </p>
              <label className={`${styles.field} ${styles.full}`}>Powód otwarcia korekty<input name="reason" required minLength={3} /></label>
              <div className={`${styles.full} ${styles.rowActions}`}>
                <button type="submit" className={`${styles.btn} ${styles.ghost}`} disabled={pending}>Otwórz korektę</button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* (6) Components for the payroll office */}
      <section className={styles.panel} aria-labelledby="base-title">
        <header className={styles.panelHead}>
          <h2 id="base-title" className={styles.panelTitle}>Składniki do kadrowej</h2>
          <span className={styles.panelNote}>bez wyliczania brutto</span>
        </header>
        <div className={styles.panelBody}>
          <dl className={styles.kv}>
            <div>
              <dt>Podstawa</dt>
              <dd>{formatGrosze(detail.baseSalaryGrosze)}</dd>
              {detail.baseBasis && <dd className={styles.sub}>{PAYROLL_BASIS_LABELS[detail.baseBasis]}</dd>}
            </div>
            <div><dt>Premie</dt><dd>{formatGrosze(s.bonusesGrosze)}</dd></div>
            <div><dt>Korekty</dt><dd>{formatGrosze(s.correctionsGrosze)}</dd></div>
            <div><dt>Nadgodziny do wypłaty</dt><dd>{formatMinutesAsHours(s.payoutOvertimeMinutes)}</dd></div>
            <div><dt>Nadgodziny → czas wolny</dt><dd>{formatMinutesAsHours(s.timeOffOvertimeMinutes)}</dd></div>
            <div><dt>Przepracowane (zatwierdzone)</dt><dd>{formatMinutesAsHours(detail.approvedWorkedMinutes)}</dd></div>
          </dl>
          {detail.baseSegments.length > 1 && (
            <p className={styles.hint}>
              Podstawy w miesiącu: {detail.baseSegments.map((seg) => `od ${seg.from}: ${formatGrosze(seg.amountGrosze)}`).join(' · ')}
            </p>
          )}
        </div>
      </section>

      {/* (7) Folded panels */}
      <Fold id="employer-cost" title="Koszt pracodawcy i podział" summary={`· ${describeSplit(costContext)}`} defaultOpen={costContext.split === null}>
        <EmployerCostPanel
          employeeId={detail.employee.id}
          employeeStartDate={detail.employee.startDate}
          context={costContext}
          onChanged={load}
        />
      </Fold>

      <Fold
        id="versions"
        title="Wersje"
        summary={versionsSummary}
        defaultOpen={false}
      >
        <div className={styles.panelBody}>
          {detail.versions.length === 0 && <p className={styles.hint}>Brak zatwierdzonych wersji.</p>}
          {detail.versions.map((version) => (
            <div key={version.id} className={styles.version}>
              <span className={`${styles.vBadge} ${version.supersededAt ? styles.vBadgeOld : ''}`}>v{version.versionNumber}</span>
              <div>
                <div className={styles.num}>{formatGrosze(version.employerCostGrosze)} <span className={styles.sub}>koszt</span></div>
                <div className={styles.sub}>
                  brutto {formatGrosze(version.finalGrossGrosze)} · netto {formatGrosze(version.finalNetGrosze)} · {dateTime(version.approvedAt)} · {detail.actors[version.approvedById] ?? '—'}
                </div>
                {version.approvalNote && <div className={styles.sub}>{version.approvalNote}</div>}
                {version.payrollOfficeReference && <div className={styles.sub}>lista płac: {version.payrollOfficeReference}</div>}
              </div>
              <span className={styles.versionTags}>
                {version.origin === 'AUTO_CARRYOVER' && <span className={`${styles.tag} ${styles.tagAuto}`}>automat</span>}
                <span className={styles.tag}>{version.supersededAt ? 'zastąpiona' : 'obowiązuje'}</span>
              </span>
            </div>
          ))}
        </div>
      </Fold>

      <Fold id="history" title="Historia zmian" summary={historySummary} defaultOpen={false}>
        <div className={`${styles.panelBody} ${styles.timeline}`}>
          {detail.auditEvents.map((event) => (
            <div key={event.id} className={styles.event}>
              <span className={styles.eventWhen}>{dateTime(event.createdAt)}</span>
              <div>
                <div className={styles.eventWhat}>{AUDIT_LABELS[event.action] ?? event.action} · {detail.actors[event.actorId] ?? 'nieznany użytkownik'}</div>
                {event.reason && <div className={styles.sub}>Powód: {event.reason}</div>}
                <div className={styles.eventDiff}>{describeDiff(event)}</div>
              </div>
            </div>
          ))}
        </div>
      </Fold>
    </div>
  )
}
