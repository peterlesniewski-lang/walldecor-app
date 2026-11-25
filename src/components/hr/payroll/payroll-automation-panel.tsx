'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { dayMonthGenitive, monthGenitive, monthNominative } from '@/lib/payroll/month-names'
import styles from './payroll.module.css'

// The payroll automat switch (D10) on the payroll settings page. State always comes from
// GET /api/hr/payroll/automation; the switch writes through PUT and shows what the server saved.

type RunDate = { month: string; date: string }
type Status = {
  enabled: boolean
  lastMonth: string | null
  nextRun: RunDate | null
  firstRunIfEnabled: RunDate
  lastResult: { month: string; ranAt: string; approved: number; attention: number; errors: number } | null
  schedulerActive: boolean
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })

export function PayrollAutomationPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/hr/payroll/automation', { cache: 'no-store' })
      .then(async (res) => {
        if (!active) return
        if (!res.ok) { setError('Nie udało się pobrać ustawień automatu.'); return }
        setStatus((await res.json()) as Status)
      })
      .catch(() => active && setError('Błąd połączenia.'))
    return () => { active = false }
  }, [])

  async function toggle() {
    if (!status || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/hr/payroll/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) { setError(json?.error ?? 'Nie udało się zapisać — przełącznik bez zmian.'); return }
      setStatus(json as Status)
    } catch {
      setError('Błąd połączenia — przełącznik bez zmian.')
    } finally {
      setSaving(false)
    }
  }

  const result = status?.lastResult ?? null

  return (
    <section id="automat" className={`${styles.panel} ${styles.autoPanel}`} aria-labelledby="automat-title">
      <header className={styles.panelHead}>
        <h2 id="automat-title" className={styles.panelTitle}>Automatyczne przenoszenie wynagrodzeń</h2>
        <span className={styles.panelNote}>1. dnia miesiąca, 6:00 · tylko stała pensja</span>
      </header>
      <div className={styles.panelBody}>
        {status === null && !error && <p className={styles.hint}>Ładowanie…</p>}
        {status && (
          <div className={styles.autoGrid}>
            <div className={styles.stack} style={{ gap: 12 }}>
              <button
                type="button"
                role="switch"
                aria-checked={status.enabled}
                className={styles.switch}
                disabled={saving}
                onClick={() => void toggle()}
              >
                <span className={styles.switchTrack} aria-hidden />
                {status.enabled ? 'Automat włączony' : 'Automat wyłączony'}
              </button>
              <p className={styles.hint} data-testid="payroll-automation-next">
                {status.enabled && status.nextRun
                  ? <>Następny przebieg: <strong className={styles.num}>{dayMonthGenitive(status.nextRun.date, true)}, 6:00</strong> — za {monthNominative(status.nextRun.month)}.</>
                  : <>Nic nie jest zatwierdzane automatycznie. Włączenie nie zatwierdza bieżącego miesiąca — pierwszy przebieg byłby {dayMonthGenitive(status.firstRunIfEnabled.date, true)}.</>}
              </p>
              {!status.schedulerActive && (
                <p className={styles.banner} role="status">
                  W tym środowisku harmonogram nie działa (zmienna PAYROLL_AUTO_CARRYOVER) — ustawienie się zapisuje, ale przebieg się nie wykona.
                </p>
              )}
              <ol className={styles.rules}>
                <li>Zatwierdza osoby ze stałą pensją, których wiersz na arkuszu jest gotowy, kwotami z poprzedniego miesiąca; koszt pracodawcy liczy z aktualnych stawek.</li>
                <li>Pomija osoby ze znacznikiem lub blokadą, na stawce godzinowej i każdego, kto ma już rozliczenie — także robocze.</li>
                <li>Nigdy nie otwiera zatwierdzonego rozliczenia. Zmiana po zatwierdzeniu daje etykietę na arkuszu i jedno powiadomienie o 7:00 rano — także za poprzedni miesiąc.</li>
              </ol>
            </div>
            <dl className={styles.kv} data-testid="payroll-automation-last">
              <div>
                <dt>Ostatni przebieg</dt>
                <dd>{result ? `${monthNominative(result.month)} ${result.month.slice(0, 4)}` : '—'}</dd>
                {result && <dd className={styles.sub}>{dateTime(result.ranAt)}</dd>}
              </div>
              <div>
                <dt>Zatwierdzone automatycznie</dt>
                <dd>{result ? result.approved : '—'}</dd>
              </div>
              <div>
                <dt>Wymaga uwagi</dt>
                <dd className={result && result.attention + result.errors > 0 ? styles.attention : undefined}>
                  {result ? result.attention + result.errors : '—'}
                </dd>
                {result && (
                  <dd className={styles.sub}>
                    <Link className={styles.autoLink} href={`/hr/payroll?month=${result.month}`}>arkusz {monthGenitive(result.month)}</Link>
                  </dd>
                )}
              </div>
            </dl>
          </div>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </section>
  )
}
