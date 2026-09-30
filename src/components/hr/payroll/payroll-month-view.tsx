'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatGrosze } from '@/lib/payroll/money'
import { PAYROLL_BASIS_LABELS, type PayrollBasis } from '@/lib/payroll/types'
import { BaseSalaryDialog } from './base-salary-dialog'
import styles from './payroll.module.css'

type Row = {
  employee: { id: string; firstName: string; lastName: string; position: string; costCenterId: string; employmentType: string | null; active: boolean }
  currentBase: { amountGrosze: number; basis: PayrollBasis; effectiveFrom: string } | null
  settlement: { id: string; status: 'DRAFT' | 'APPROVED'; currentVersionNumber: number; payrollOfficeConfirmedAt: string | null } | null
  effectiveVersion: { versionNumber: number; employerCostGrosze: number } | null
}

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function StatusStamp({ settlement }: { settlement: Row['settlement'] }) {
  if (!settlement) return <span className={`${styles.stamp} ${styles.stampNone}`}>brak rozliczenia</span>
  if (settlement.status === 'APPROVED') {
    return <span className={`${styles.stamp} ${styles.stampApproved}`}>Zatwierdzone · v{settlement.currentVersionNumber}</span>
  }
  if (settlement.payrollOfficeConfirmedAt) {
    return <span className={`${styles.stamp} ${styles.stampReady}`}>Kadrowa potwierdziła</span>
  }
  return <span className={`${styles.stamp} ${styles.stampDraft}`}>Robocze</span>
}

export function PayrollMonthView({ initialMonth, maxMonth }: { initialMonth: string; maxMonth: string }) {
  const router = useRouter()
  const [month, setMonth] = useState(initialMonth)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [baseFor, setBaseFor] = useState<Row['employee'] | null>(null)

  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    fetch(`/api/hr/payroll/settlements?month=${month}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!active) return
        if (!res.ok) {
          setError('Nie udało się pobrać listy rozliczeń.')
          return
        }
        const json = await res.json()
        if (active) {
          setError(null)
          setRows(json)
        }
      })
      .catch(() => active && setError('Błąd połączenia.'))
    return () => { active = false }
  }, [month, reloadKey])

  function goTo(next: string) {
    if (next > maxMonth) return
    setRows(null)
    setMonth(next)
    router.replace(`/hr/payroll?month=${next}`, { scroll: false })
  }

  async function createSettlement(employeeId: string) {
    setBusy(employeeId)
    setError(null)
    const res = await fetch('/api/hr/payroll/settlements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, month }),
    })
    const json = await res.json()
    setBusy(null)
    if (res.ok || json.details?.settlementId) {
      router.push(`/hr/payroll/${json.id ?? json.details.settlementId}`)
      return
    }
    setError(json.error ?? 'Nie udało się utworzyć rozliczenia.')
  }

  const [y, m] = month.split('-').map(Number)
  const approvedCost = (rows ?? []).reduce((sum, row) => sum + (row.effectiveVersion?.employerCostGrosze ?? 0), 0)
  const approvedCount = (rows ?? []).filter((row) => row.effectiveVersion).length

  return (
    <div className={`${styles.page} ${styles.reveal}`}>
      <header className={styles.masthead}>
        <div>
          <p className={styles.eyebrow}>HR · Wynagrodzenia · tylko administrator</p>
          <h1 className={styles.title}>
            {MONTHS[m - 1]} <em>{y}</em>
          </h1>
          <p className={styles.lede}>
            Rozliczenie jest robocze, dopóki kadrowa nie potwierdzi brutto, netto i pełnego kosztu pracodawcy.
            Nadgodziny pochodzą z kalendarza czasu pracy i liczą się dopiero po zatwierdzeniu wpisu.
          </p>
        </div>
        <nav className={styles.monthNav} aria-label="Wybór miesiąca">
          <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => goTo(shiftMonth(month, -1))} aria-label="Poprzedni miesiąc">
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

      <dl className={styles.kv}>
        <div>
          <dt>Zatwierdzone rozliczenia</dt>
          <dd>{rows ? `${approvedCount} / ${rows.length}` : '…'}</dd>
        </div>
        <div>
          <dt>Pełny koszt pracodawcy (zatwierdzony)</dt>
          <dd>{rows ? formatGrosze(approvedCost) : '…'}</dd>
        </div>
      </dl>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <section className={styles.ledger} aria-label="Pracownicy w miesiącu">
        <div className={styles.ledgerHead} aria-hidden>
          <span>Pracownik</span>
          <span>Podstawa</span>
          <span>Status</span>
          <span>Koszt pracodawcy</span>
          <span />
        </div>
        {rows === null && <p className={styles.empty}>Ładowanie…</p>}
        {rows?.length === 0 && <p className={styles.empty}>Brak pracowników zatrudnionych w tym miesiącu.</p>}
        {rows?.map((row) => (
          <div key={row.employee.id} className={styles.ledgerRow} data-testid={`payroll-row-${row.employee.id}`}>
            <div>
              <div className={styles.name}>{row.employee.lastName} {row.employee.firstName}</div>
              <div className={styles.sub}>
                {row.employee.position} · {row.employee.costCenterId} · {row.employee.employmentType ?? 'umowa?'}
              </div>
            </div>
            <div>
              {row.currentBase ? (
                <>
                  <div className={styles.num}>{formatGrosze(row.currentBase.amountGrosze)}</div>
                  <div className={styles.sub}>{PAYROLL_BASIS_LABELS[row.currentBase.basis]} · od {row.currentBase.effectiveFrom}</div>
                </>
              ) : (
                <span className={styles.sub}>nie ustawiono</span>
              )}
            </div>
            <div><StatusStamp settlement={row.settlement} /></div>
            <div className={styles.num}>
              {row.effectiveVersion ? formatGrosze(row.effectiveVersion.employerCostGrosze) : '—'}
            </div>
            <div className={styles.rowActions}>
              <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setBaseFor(row.employee)}>
                Podstawa
              </button>
              {row.settlement ? (
                <Link className={styles.btn} href={`/hr/payroll/${row.settlement.id}`}>Otwórz</Link>
              ) : (
                <button type="button" className={styles.btn} disabled={busy === row.employee.id} onClick={() => createSettlement(row.employee.id)}>
                  {busy === row.employee.id ? 'Tworzę…' : 'Przygotuj rozliczenie'}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      {baseFor && (
        <BaseSalaryDialog
          employee={baseFor}
          onClose={() => setBaseFor(null)}
          onChanged={() => setReloadKey((key) => key + 1)}
        />
      )}
    </div>
  )
}
