'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { formatGrosze, formatMinutesAsHours, groszeToPlnString } from '@/lib/payroll/money'
import { BLOCKER_LABELS, WARNING_LABELS, type PayrollBlocker, type PayrollWarning } from '@/lib/payroll/summary'
import { PAYROLL_BASIS_LABELS, type OvertimeResolution, type PayrollBasis } from '@/lib/payroll/types'
import { StatusStamp } from './payroll-month-view'
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
  supersededAt: string | null
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
  employee: { firstName: string; lastName: string; position: string; costCenterId: string; employmentType: string | null }
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
  payrollOfficeReference: string | null
  payrollOfficeConfirmedAt: string | null
  currentVersionNumber: number
  overtimeLines: Line[]
  adjustments: Adjustment[]
  versions: Version[]
  auditEvents: AuditEvent[]
  actors: Record<string, string>
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
}
const VALUE_LABELS: Record<string, string> = {
  BONUS: 'premia',
  CORRECTION: 'korekta',
  PAYOUT: 'wypłata',
  TIME_OFF: 'czas wolny',
  DRAFT: 'robocze',
  APPROVED: 'zatwierdzone',
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

export function PayrollSettlementView({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blockers, setBlockers] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

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

  async function act(body: Record<string, unknown>) {
    if (!detail) return false
    setPending(true)
    setError(null)
    setBlockers([])
    const res = await fetch(`/api/hr/payroll/settlements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: detail.revision, ...body }),
    })
    const json = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      const fieldErrors = json.details?.fieldErrors ? Object.values(json.details.fieldErrors).flat() as string[] : []
      setError(fieldErrors[0] ?? json.error ?? 'Nie udało się zapisać.')
      setBlockers((json.details?.blockers ?? []).map((b: { message: string }) => b.message))
      if (res.status === 409) load()
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
  const calendarReady = detail.calendarInSync && !s.inputBlockers.some((b) => b.startsWith('OVERTIME') || b === 'HOURLY_ENTRIES_PENDING' || b === 'OPEN_TIME_ENTRY')
  const steps = [
    { label: 'Podstawa', done: detail.baseSalaryGrosze !== null },
    { label: 'Godziny z kalendarza', done: calendarReady },
    { label: 'Premie i korekty', done: confirmed || !isDraft },
    { label: 'Dane od kadrowej', done: confirmed || !isDraft },
    { label: 'Zatwierdzenie', done: !isDraft },
  ]
  const figureHint = !detail.finalGrossGrosze ? 'czeka na kadrową' : confirmed || !isDraft ? 'potwierdzone przez kadrową' : 'niepotwierdzone — dane wejściowe zmieniły się'

  return (
    <div className={`${styles.page} ${styles.reveal}`}>
      <Link href={`/hr/payroll?month=${detail.year}-${String(detail.month).padStart(2, '0')}`} className={styles.eyebrow} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <ArrowLeft size={14} /> Wynagrodzenia · {MONTHS[detail.month - 1]} {detail.year}
      </Link>

      <section className={styles.slip} aria-label="Podsumowanie rozliczenia">
        <div className={styles.slipTop}>
          <div>
            <div className={styles.slipName}>{detail.employee.firstName} {detail.employee.lastName}</div>
            <div className={styles.slipMeta}>
              {MONTHS[detail.month - 1]} {detail.year} · {detail.employee.position} · {detail.employee.costCenterId} · {detail.employee.employmentType ?? 'umowa nieokreślona'} · rewizja {detail.revision}
            </div>
          </div>
          <StatusStamp settlement={{ id: detail.id, status: detail.status, currentVersionNumber: detail.currentVersionNumber, payrollOfficeConfirmedAt: detail.payrollOfficeConfirmedAt }} />
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
              <div className={styles.figureHint}>{figureHint}</div>
            </div>
          ))}
        </div>
      </section>

      <ol className={styles.rail} aria-label="Etapy rozliczenia">
        {steps.map((step) => (
          <li key={step.label} className={`${styles.step} ${step.done ? styles.stepDone : styles.stepTodo}`}>{step.label}</li>
        ))}
      </ol>

      {!detail.calendarInSync && (
        <div className={styles.banner} role="status">
          <span>
            {isDraft
              ? 'Kalendarz czasu pracy lub podstawa zmieniły się od ostatniego pobrania.'
              : 'Kalendarz lub podstawa zmieniły się po zatwierdzeniu. Jeśli to wpływa na wypłatę — otwórz korektę.'}
          </span>
          {isDraft && (
            <button type="button" className={styles.btn} disabled={pending} onClick={() => act({ action: 'calendar.sync' })}>
              <RefreshCw size={14} /> Pobierz ponownie
            </button>
          )}
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          {error}
          {blockers.length > 0 && <ul className={styles.blockers} style={{ marginTop: 8 }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        </div>
      )}

      <div className={styles.grid2}>
        <div className={styles.stack}>
          <section className={styles.panel} aria-labelledby="ot-title">
            <header className={styles.panelHead}>
              <h2 id="ot-title" className={styles.panelTitle}>Nadgodziny z kalendarza</h2>
              <span className={styles.panelNote}>
                do wypłaty {formatMinutesAsHours(s.payoutOvertimeMinutes)} · czas wolny {formatMinutesAsHours(s.timeOffOvertimeMinutes)}
              </span>
            </header>
            <div className={styles.panelBody}>
              <p className={styles.hint}>
                Godziny nie są tu wpisywane — pochodzą z modułu Czas pracy. Liczą się wyłącznie wpisy zatwierdzone.
                {detail.calendarSyncedAt && ` Ostatnie pobranie: ${dateTime(detail.calendarSyncedAt)}.`}
              </p>
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
                  </div>
                ))}
              </div>
            </div>
          </section>

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
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="hist-title">
            <header className={styles.panelHead}>
              <h2 id="hist-title" className={styles.panelTitle}>Historia zmian</h2>
              <span className={styles.panelNote}>{detail.auditEvents.length} zdarzeń · nieusuwalna</span>
            </header>
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
          </section>
        </div>

        <div className={styles.stack}>
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

          <section className={styles.panel} aria-labelledby="office-title">
            <header className={styles.panelHead}>
              <h2 id="office-title" className={styles.panelTitle}>Dane od kadrowej</h2>
              <span className={styles.panelNote}>{confirmed ? `potwierdzone ${dateTime(detail.payrollOfficeConfirmedAt!)}` : 'wymagane do zatwierdzenia'}</span>
            </header>
            <div className={styles.panelBody}>
              {isDraft ? (
                <form
                  className={styles.form}
                  onSubmit={submitForm((form) => ({
                    action: 'payrollOffice.confirm',
                    finalGross: form.get('finalGross'),
                    finalNet: form.get('finalNet'),
                    employerCost: form.get('employerCost'),
                    reference: form.get('reference') || null,
                  }))}
                >
                  <label className={styles.field}>Brutto (ostateczne)<input name="finalGross" inputMode="decimal" required placeholder="0,00" /></label>
                  <label className={styles.field}>Netto do wypłaty<input name="finalNet" inputMode="decimal" required placeholder="0,00" /></label>
                  <label className={`${styles.field} ${styles.full}`}>
                    Pełny koszt pracodawcy
                    <input name="employerCost" inputMode="decimal" required placeholder="0,00" />
                    <span className={styles.hint}>Przepisz z listy płac kadrowej (brutto + składki i narzuty pracodawcy). Aplikacja nie wylicza go z netto.</span>
                  </label>
                  <label className={`${styles.field} ${styles.full}`}>Numer listy płac / notatka<input name="reference" maxLength={200} /></label>
                  <div className={`${styles.full} ${styles.rowActions}`}>
                    <button type="submit" className={styles.btn} disabled={pending || s.inputBlockers.length > 0}>
                      Potwierdź dane kadrowej
                    </button>
                  </div>
                  {s.inputBlockers.length > 0 && (
                    <p className={`${styles.hint} ${styles.full}`}>Najpierw domknij dane wejściowe — lista poniżej w „Zatwierdzenie”.</p>
                  )}
                </form>
              ) : (
                <p className={styles.hint}>Zatwierdzone rozliczenie jest zablokowane. Korekta tworzy nową wersję.</p>
              )}
              {detail.payrollOfficeReference && <p className={styles.hint}>Odniesienie: {detail.payrollOfficeReference}</p>}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="approve-title">
            <header className={styles.panelHead}>
              <h2 id="approve-title" className={styles.panelTitle}>Zatwierdzenie</h2>
              <span className={styles.panelNote}>utrwala wersję kosztu</span>
            </header>
            <div className={styles.panelBody}>
              {isDraft && s.approvalBlockers.length > 0 && (
                <ul className={styles.blockers} data-testid="approval-blockers">
                  {s.approvalBlockers.map((code) => <li key={code}>{BLOCKER_LABELS[code]}</li>)}
                </ul>
              )}
              {isDraft && s.approvalBlockers.length === 0 && <p className={styles.okLine}>Gotowe do zatwierdzenia.</p>}
              {s.warnings.length > 0 && (
                <ul className={`${styles.blockers} ${styles.warn}`}>
                  {s.warnings.map((code) => <li key={code}>{WARNING_LABELS[code]}</li>)}
                </ul>
              )}
              {isDraft ? (
                <form className={styles.form} onSubmit={submitForm((form) => ({ action: 'approve', note: form.get('note') || null }))}>
                  <label className={`${styles.field} ${styles.full}`}>Notatka do wersji (opcjonalnie)<input name="note" maxLength={500} /></label>
                  <div className={`${styles.full} ${styles.rowActions}`}>
                    <button type="submit" className={styles.btn} disabled={pending || s.approvalBlockers.length > 0}>
                      Zatwierdź wersję {detail.currentVersionNumber + 1}
                    </button>
                  </div>
                  {detail.currentVersionNumber > 0 && (
                    <p className={`${styles.hint} ${styles.full}`}>
                      Do czasu zatwierdzenia w kosztach liczy się wersja {detail.currentVersionNumber}. Nowa wersja ją zastąpi — koszt nie zostanie zdublowany.
                    </p>
                  )}
                </form>
              ) : (
                <form className={styles.form} onSubmit={submitForm((form) => ({ action: 'reopen', reason: form.get('reason') }))}>
                  <label className={`${styles.field} ${styles.full}`}>
                    Powód korekty
                    <input name="reason" required minLength={3} />
                    <span className={styles.hint}>Wersja {detail.currentVersionNumber} nadal liczy się w kosztach, dopóki nie zatwierdzisz nowej.</span>
                  </label>
                  <div className={`${styles.full} ${styles.rowActions}`}>
                    <button type="submit" className={`${styles.btn} ${styles.ghost}`} disabled={pending}>Otwórz korektę</button>
                  </div>
                </form>
              )}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="ver-title">
            <header className={styles.panelHead}>
              <h2 id="ver-title" className={styles.panelTitle}>Wersje</h2>
              <span className={styles.panelNote}>niezmienne po zatwierdzeniu</span>
            </header>
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
                  </div>
                  <span className={styles.tag}>{version.supersededAt ? 'zastąpiona' : 'obowiązuje'}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
