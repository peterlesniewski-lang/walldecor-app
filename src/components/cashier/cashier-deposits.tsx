'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CashierAccount, CashierDeposit } from '@/lib/cashier/contracts'
import { CashCheck, CashChoice, CashError, CashField, CashNote, type CommandHandler } from './cashier-ui'
import { cashFormat, cashInput, parseCashierMoney } from './money'
import styles from './cashier.module.css'

const statusLabels = { WAITING: 'Czeka na odbiór', RECEIVED: 'Odebrany — do przeliczenia', VERIFIED: 'Przeliczony — zgodny', DISCREPANCY: 'Przeliczony — różnica', VOID: 'Wycofany korektą' }

function DepositCard({ deposit, accounts, isAdmin, busy, onCommand }: { deposit: CashierDeposit; accounts: CashierAccount[]; isAdmin: boolean; busy: boolean; onCommand: CommandHandler }) {
  const [destination, setDestination] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [actual, setActual] = useState(cashInput(deposit.actualCents))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  return <article className={styles.panel} aria-label={`Depozyt ${deposit.businessDate}`}>
    <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>{deposit.costCenterId} · {deposit.businessDate}</p><h3 className="num">{cashFormat(deposit.declaredCents)}</h3></div><span className={styles.badge}>{statusLabels[deposit.status]}</span></header>
    <p className={styles.help}>Nr {deposit.id.slice(-8)} · wersja {deposit.version}. Kwota zadeklarowana w zamknięciu dnia; może zawierać kaucje.</p>
    {deposit.receivedAt && <p className={styles.help}>Odbiór: {new Date(deposit.receivedAt).toLocaleString('pl-PL')} → {deposit.destinationAccountName}.</p>}
    {deposit.actualCents !== null && <p>Przeliczono: <strong className="num">{cashFormat(deposit.actualCents)}</strong> · różnica <span className={deposit.actualCents !== deposit.declaredCents ? styles.warning : undefined}>{cashFormat(deposit.actualCents - deposit.declaredCents)}</span></p>}
    {deposit.verificationNote && <p className={styles.help}>{deposit.verificationNote}</p>}
    {isAdmin && deposit.status === 'WAITING' && <form className={styles.inset} onSubmit={async (event) => {
      event.preventDefault()
      await onCommand({ action: 'receiveDeposit', costCenterId: deposit.costCenterId, depositId: deposit.id, version: deposit.version, destinationAccountId: destination, physicalReceiptConfirmed: true })
    }}>
      <CashChoice label={`Rachunek docelowy ${deposit.businessDate}`} value={destination} onChange={setDestination} options={accounts.filter((account) => !account.managedByCostCenterId).map((account) => ({ value: account.id, label: account.name }))} />
      {accounts.every((account) => account.managedByCostCenterId) && <p className={styles.help}>Brak docelowego rachunku gotówkowego PLN. Utwórz go w sekcji rachunków dashboardu; nie może być kasą innego salonu.</p>}
      <CashCheck checked={confirmed} onChange={setConfirmed}>Potwierdzam fizyczny odbiór paczki. Zawartość nie została jeszcze przeliczona.</CashCheck>
      <Button type="submit" disabled={busy || !destination || !confirmed}>Potwierdź odbiór paczki</Button>
    </form>}
    {isAdmin && deposit.status === 'RECEIVED' && <form className={styles.inset} onSubmit={async (event) => {
      event.preventDefault(); setError('')
      try {
        const actualCents = parseCashierMoney(actual)
        if (actualCents === null) throw new Error('Wpisz faktycznie przeliczoną kwotę. Zero wpisz jawnie.')
        if (!confirmed) throw new Error('Potwierdź przeliczenie zawartości.')
        await onCommand({ action: 'verifyDeposit', costCenterId: deposit.costCenterId, depositId: deposit.id, version: deposit.version, actualCents, countedConfirmed: true, reason })
      } catch (error) { setError(error instanceof Error ? error.message : 'Sprawdź przeliczoną kwotę.') }
    }}>
      <CashField label={`Przeliczona zawartość ${deposit.businessDate}`} value={actual} onChange={(value) => { setActual(value); setConfirmed(false) }} required />
      <CashNote label={`Wyjaśnienie różnicy ${deposit.businessDate}`} value={reason} onChange={setReason} />
      <CashCheck checked={confirmed} onChange={setConfirmed}>Potwierdzam, że przeliczyłem zawartość paczki.</CashCheck>
      <Button type="submit" disabled={busy || !confirmed || !actual.trim()}>Zapisz przeliczenie</Button>
    </form>}
    <CashError error={error} />
  </article>
}

export function CashierDeposits({ deposits, accounts, isAdmin, busy, onCommand }: { deposits: CashierDeposit[]; accounts: CashierAccount[]; isAdmin: boolean; busy: boolean; onCommand: CommandHandler }) {
  return <section className={styles.stack} aria-label="Depozyty salonu"><p className={styles.help}>Odbiór paczki to przeniesienie istniejącej gotówki między rachunkami. Nie zwiększa przychodu ani sumy środków firmy. Przeliczenie jest oddzielnym potwierdzeniem.</p>{deposits.length ? deposits.map((deposit) => <DepositCard key={`${deposit.id}:${deposit.version}`} deposit={deposit} accounts={accounts} isAdmin={isAdmin} busy={busy} onCommand={onCommand} />) : <div className={styles.empty}><h2>Brak depozytów w tym okresie</h2><p className={styles.help}>Depozyt pojawi się po zamknięciu dnia, jeżeli policzona gotówka przekroczy kasę stałą.</p></div>}</section>
}
