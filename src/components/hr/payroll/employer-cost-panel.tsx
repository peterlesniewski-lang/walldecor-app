'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import {
  EMPLOYER_RATE_LABELS,
  PAYROLL_SETTLEMENT_TYPE_LABELS,
  defaultCostSplitMonth,
  type EmployerRates,
  type PayrollSettlementType,
} from '@/lib/payroll/employer-cost'
import styles from './payroll.module.css'

export type EmployerCostContextView = {
  settlementType: PayrollSettlementType | null
  rates: EmployerRates | null
  ratesSource: 'SETTINGS' | 'DEFAULT' | null
  ratesEffectiveFrom: string | null
  exemptions: { withoutFunds: boolean; withoutContributions: boolean }
  split: { jagPercent: number; source: 'SPLIT' | 'COST_CENTER' } | null
}

export function totalRatePercent(rates: EmployerRates) {
  const basisPoints = Object.values(rates).reduce((sum, value) => sum + value, 0)
  return (basisPoints / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function describeRates(context: EmployerCostContextView) {
  if (!context.rates || !context.settlementType) return 'brak stawek dla tego rodzaju umowy — koszt wpisujesz ręcznie'
  const origin = context.ratesSource === 'SETTINGS' ? `stawki od ${context.ratesEffectiveFrom}` : 'stawki domyślne (orientacyjne)'
  return `${PAYROLL_SETTLEMENT_TYPE_LABELS[context.settlementType]} · +${totalRatePercent(context.rates)}% · ${origin}`
}

async function send(url: string, method: 'PUT' | 'POST', body: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (res.ok) return null
  const json = await res.json().catch(() => ({}))
  const fieldErrors = json.details?.fieldErrors ? Object.values(json.details.fieldErrors).flat() as string[] : []
  return fieldErrors[0] ?? json.error ?? 'Nie udało się zapisać.'
}

/** Rates, exemptions and the salon split behind one employee's employer cost. ADMIN only. */
export function EmployerCostPanel({
  employeeId,
  employeeStartDate,
  context,
  onChanged,
}: {
  employeeId: string
  employeeStartDate: string
  context: EmployerCostContextView
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function run(request: Promise<string | null>) {
    setPending(true)
    setError(await request)
    setPending(false)
    onChanged()
  }

  function toggleExemption(key: 'withoutFunds' | 'withoutContributions', value: boolean) {
    return run(send('/api/hr/payroll/cost-settings', 'PUT', { employeeId, ...context.exemptions, [key]: value }))
  }

  function addSplit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(send('/api/hr/payroll/cost-splits', 'POST', {
      employeeId,
      effectiveFrom: String(form.get('effectiveFrom')),
      jagPercent: Number(form.get('jagPercent')),
    }))
  }

  const split = context.split

  return (
    <section className={styles.panel} aria-labelledby="employer-cost-title">
      <header className={styles.panelHead}>
        <h2 id="employer-cost-title" className={styles.panelTitle}>Koszt pracodawcy i podział</h2>
        <Link href="/hr/payroll/rates" className={styles.panelNote}>stawki →</Link>
      </header>
      <div className={styles.panelBody}>
        <p className={styles.hint}>{describeRates(context)}</p>
        {context.rates && (
          <p className={`${styles.hint} ${styles.num}`}>
            {(Object.keys(EMPLOYER_RATE_LABELS) as Array<keyof EmployerRates>)
              .filter((key) => context.rates![key] > 0)
              .map((key) => `${EMPLOYER_RATE_LABELS[key]} ${(context.rates![key] / 100).toLocaleString('pl-PL')}%`)
              .join(' · ') || 'bez składek pracodawcy'}
          </p>
        )}

        <fieldset className={styles.checks} disabled={pending}>
          <legend className={styles.figureLabel}>Zwolnienia</legend>
          <label>
            <input type="checkbox" checked={context.exemptions.withoutFunds} onChange={(e) => toggleExemption('withoutFunds', e.target.checked)} />
            bez Funduszu Pracy i FGŚP (np. 55+/60+)
          </label>
          <label>
            <input type="checkbox" checked={context.exemptions.withoutContributions} onChange={(e) => toggleExemption('withoutContributions', e.target.checked)} />
            bez składek pracodawcy (np. student na UZ)
          </label>
        </fieldset>

        <p className={split ? styles.hint : styles.error}>
          {split
            ? `Podział: JAG ${split.jagPercent}% · PUL ${100 - split.jagPercent}%${split.source === 'COST_CENTER' ? ' (z centrum kosztów w karcie)' : ''}`
            : 'Brak podziału — osoba w GLOBAL musi mieć ustawiony podział na salony.'}
        </p>
        <form className={styles.form} onSubmit={addSplit}>
          <label className={styles.field}>Od miesiąca<input name="effectiveFrom" type="month" required defaultValue={defaultCostSplitMonth(employeeStartDate)} /></label>
          <label className={styles.field}>JAG %<input name="jagPercent" type="number" min={0} max={100} step={1} required defaultValue={split?.jagPercent ?? 50} /></label>
          <div className={`${styles.full} ${styles.rowActions}`}>
            <button type="submit" className={`${styles.btn} ${styles.ghost}`} disabled={pending}>Ustaw podział</button>
          </div>
        </form>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </section>
  )
}
