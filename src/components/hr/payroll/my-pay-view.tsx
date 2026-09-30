import { formatGrosze } from '@/lib/payroll/money'
import styles from './payroll.module.css'

export type MyPayStatement = {
  year: number
  month: number
  versionNumber: number
  approvedAt: string
  finalGrossGrosze: number
  finalNetGrosze: number
}

const monthLabel = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dateLabel = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' })

function periodLabel({ year, month }: { year: number; month: number }) {
  return monthLabel.format(new Date(Date.UTC(year, month - 1, 1)))
}

export function MyPayView({ statements, hasEmployeeProfile }: { statements: MyPayStatement[]; hasEmployeeProfile: boolean }) {
  const [latest, ...earlier] = statements

  return (
    <div className={`${styles.page} ${styles.reveal}`}>
      <header className={styles.masthead}>
        <div>
          <p className={styles.eyebrow}>Moje wynagrodzenie</p>
          <h1 className={styles.title}>Pasek <em>wynagrodzenia</em></h1>
          <p className={styles.lede}>
            Kwoty z zatwierdzonej listy płac: brutto i netto do wypłaty za każdy miesiąc.
            Szczegóły składek i potrąceń ma kadrowa.
          </p>
        </div>
      </header>

      {!hasEmployeeProfile && (
        <section className={styles.panel}>
          <p className={styles.empty}>Twoje konto nie jest połączone z kartą pracownika. Poproś administratora o powiązanie.</p>
        </section>
      )}

      {hasEmployeeProfile && !latest && (
        <section className={styles.panel}>
          <p className={styles.empty}>Nie ma jeszcze zatwierdzonej listy płac z Twoim wynagrodzeniem.</p>
        </section>
      )}

      {latest && (
        <section className={styles.slip} aria-label={`Ostatni pasek: ${periodLabel(latest)}`}>
          <div className={styles.slipTop}>
            <div>
              <p className={`${styles.slipName} ${styles.period}`}>{periodLabel(latest)}</p>
              <p className={styles.slipMeta}>
                Zatwierdzono {dateLabel.format(new Date(latest.approvedAt))}
                {latest.versionNumber > 1 ? ` · korekta nr ${latest.versionNumber - 1}` : ''}
              </p>
            </div>
          </div>
          <div className={`${styles.figures} ${styles.payFigures}`}>
            <div className={styles.figure}>
              <p className={styles.figureLabel}>Brutto</p>
              <p className={styles.figureValue}>{formatGrosze(latest.finalGrossGrosze)}</p>
            </div>
            <div className={styles.figure}>
              <p className={styles.figureLabel}>Netto do wypłaty</p>
              <p className={styles.figureValue}>{formatGrosze(latest.finalNetGrosze)}</p>
            </div>
          </div>
        </section>
      )}

      {earlier.length > 0 && (
        <section className={`${styles.ledger} ${styles.payLedger}`} aria-label="Wcześniejsze miesiące">
          <div className={styles.ledgerHead}>
            <span>Miesiąc</span>
            <span>Brutto</span>
            <span>Netto</span>
          </div>
          {earlier.map((statement) => (
            <div key={`${statement.year}-${statement.month}`} className={styles.ledgerRow}>
              <div>
                <p className={`${styles.name} ${styles.period}`}>{periodLabel(statement)}</p>
                {statement.versionNumber > 1 && <p className={styles.sub}>korekta nr {statement.versionNumber - 1}</p>}
              </div>
              <span className={styles.num}>{formatGrosze(statement.finalGrossGrosze)}</span>
              <span className={styles.num}>{formatGrosze(statement.finalNetGrosze)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
