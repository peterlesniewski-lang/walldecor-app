'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import {
  DEFAULT_EMPLOYER_RATES,
  EMPLOYER_RATE_LABELS,
  PAYROLL_SETTLEMENT_TYPES,
  PAYROLL_SETTLEMENT_TYPE_LABELS,
  type EmployerRates,
  type PayrollSettlementType,
} from '@/lib/payroll/employer-cost'
import { totalRatePercent } from './employer-cost-panel'
import styles from './payroll.module.css'

type RateRow = EmployerRates & {
  id: string
  settlementType: PayrollSettlementType
  effectiveFrom: string
  note: string | null
  createdAt: string
  revokedAt: string | null
}

const RATE_KEYS = Object.keys(EMPLOYER_RATE_LABELS) as Array<keyof EmployerRates>
const FIELD_BY_KEY: Record<keyof EmployerRates, string> = {
  pensionBp: 'pension',
  disabilityBp: 'disability',
  accidentBp: 'accident',
  labourFundBp: 'labourFund',
  guaranteeFundBp: 'guaranteeFund',
  ppkBp: 'ppk',
}

const percent = (basisPoints: number) => (basisPoints / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2 })

function RatesLine({ rates }: { rates: EmployerRates }) {
  const parts = RATE_KEYS.filter((key) => rates[key] > 0).map((key) => `${EMPLOYER_RATE_LABELS[key]} ${percent(rates[key])}%`)
  return <span className={styles.sub}>{parts.join(' · ') || 'bez składek pracodawcy'}</span>
}

export function EmployerRatesView() {
  const [rows, setRows] = useState<RateRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [type, setType] = useState<PayrollSettlementType>('UOP')

  useEffect(() => {
    let active = true
    fetch('/api/hr/payroll/employer-rates', { cache: 'no-store' })
      .then(async (res) => {
        if (!active) return
        if (!res.ok) { setError('Brak dostępu lub błąd pobierania.'); return }
        setRows(await res.json())
      })
      .catch(() => active && setError('Błąd połączenia.'))
    return () => { active = false }
  }, [reloadKey])

  async function request(url: string, body?: unknown) {
    setPending(true)
    setError(null)
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    setPending(false)
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      const fieldErrors = json.details?.fieldErrors ? Object.values(json.details.fieldErrors).flat() as string[] : []
      setError(fieldErrors[0] ?? json.error ?? 'Nie udało się zapisać.')
      return false
    }
    setReloadKey((key) => key + 1)
    return true
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const body: Record<string, unknown> = { settlementType: type, effectiveFrom: form.get('effectiveFrom'), note: form.get('note') || null }
    for (const key of RATE_KEYS) body[FIELD_BY_KEY[key]] = form.get(FIELD_BY_KEY[key])
    if (await request('/api/hr/payroll/employer-rates', body)) formElement.reset()
  }

  const defaults = DEFAULT_EMPLOYER_RATES[type]

  return (
    <div className={`${styles.page} ${styles.reveal}`}>
      <Link href="/hr/payroll" className={`${styles.eyebrow} ${styles.backLink}`}>
        <ArrowLeft size={14} /> Wynagrodzenia
      </Link>
      <header className={styles.masthead}>
        <div>
          <p className={styles.eyebrow}>Ustawienia płac</p>
          <h1 className={styles.title}>Stawki <em>pracodawcy</em></h1>
          <p className={styles.lede}>
            Składki po stronie pracodawcy doliczane do brutto z listy płac. Każda zmiana obowiązuje od wskazanego miesiąca;
            błędny wpis cofasz i dodajesz ponownie. Dopóki nie ma wpisu, liczymy stawkami domyślnymi — potwierdź je z księgową.
          </p>
        </div>
      </header>

      <section className={styles.ledger} aria-label="Obowiązujące i historyczne stawki">
        {PAYROLL_SETTLEMENT_TYPES.map((settlementType) => {
          const typeRows = (rows ?? []).filter((row) => row.settlementType === settlementType)
          return (
            <div key={settlementType} className={styles.ledgerRow}>
              <div>
                <p className={styles.name}>{PAYROLL_SETTLEMENT_TYPE_LABELS[settlementType]}</p>
                {typeRows.length === 0 && <p className={styles.sub}>domyślne: +{totalRatePercent(DEFAULT_EMPLOYER_RATES[settlementType])}%</p>}
              </div>
              <div className={styles.rateHistory}>
                {typeRows.length === 0 && <RatesLine rates={DEFAULT_EMPLOYER_RATES[settlementType]} />}
                {typeRows.map((row) => (
                  <div key={row.id} className={row.revokedAt ? styles.revoked : undefined}>
                    <span className={styles.num}>od {row.effectiveFrom} · +{totalRatePercent(row)}%</span>{' '}
                    <RatesLine rates={row} />
                    {row.revokedAt ? (
                      <span className={styles.sub}> · cofnięte</span>
                    ) : (
                      <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={pending} onClick={() => request(`/api/hr/payroll/employer-rates/${row.id}/revoke`)}>
                        Cofnij
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {rows === null && !error && <p className={styles.empty}>Ładowanie…</p>}
      </section>

      <section className={styles.panel} aria-labelledby="new-rates-title">
        <header className={styles.panelHead}>
          <h2 id="new-rates-title" className={styles.panelTitle}>Nowe stawki</h2>
          <span className={styles.panelNote}>w procentach, np. 9,76</span>
        </header>
        <div className={styles.panelBody}>
          <form className={styles.form} onSubmit={add} key={type}>
            <label className={styles.field}>
              Rodzaj rozliczenia
              <select value={type} onChange={(e) => setType(e.target.value as PayrollSettlementType)}>
                {PAYROLL_SETTLEMENT_TYPES.map((value) => <option key={value} value={value}>{PAYROLL_SETTLEMENT_TYPE_LABELS[value]}</option>)}
              </select>
            </label>
            <label className={styles.field}>Obowiązuje od<input name="effectiveFrom" type="month" required /></label>
            {RATE_KEYS.map((key) => (
              <label key={key} className={styles.field}>
                {EMPLOYER_RATE_LABELS[key]} %
                <input name={FIELD_BY_KEY[key]} inputMode="decimal" required defaultValue={percent(defaults[key])} />
              </label>
            ))}
            <label className={`${styles.field} ${styles.full}`}>Notatka (np. „potwierdzone z księgową”)<input name="note" maxLength={500} /></label>
            <div className={`${styles.full} ${styles.rowActions}`}>
              <button type="submit" className={styles.btn} disabled={pending}>Zapisz stawki</button>
            </div>
          </form>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      </section>
    </div>
  )
}
