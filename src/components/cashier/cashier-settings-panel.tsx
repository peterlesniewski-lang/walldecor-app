'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CashierBootstrap } from '@/lib/cashier/contracts'
import { CashCheck, CashChoice, CashError, CashField, CashNote, type CommandHandler } from './cashier-ui'
import { cashFormat, cashInput, parseCashierMoney } from './money'
import styles from './cashier.module.css'

export function CashierSettingsPanel({ data, busy, onCommand }: { data: CashierBootstrap; busy: boolean; onCommand: CommandHandler }) {
  const [startDate, setStartDate] = useState(data.today)
  const [initialCash, setInitialCash] = useState('')
  const [target, setTarget] = useState(cashInput(data.settings?.targetFloatCents ?? null))
  const [account, setAccount] = useState('')
  const [name, setName] = useState('')
  const [sourceConfirmed, setSourceConfirmed] = useState(false)
  const [noDuplicate, setNoDuplicate] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const openReport = data.openReport
  let nextTarget: number | null = null
  try { nextTarget = parseCashierMoney(target) } catch { /* save explains invalid value */ }
  return <section className={styles.panel} aria-label="Ustawienia kasy salonu">
    <p className={styles.eyebrow}>Tylko administrator · {data.selectedCostCenterId}</p>
    <h2>{data.settings ? 'Kasa stała' : 'Uruchom kasę salonu'}</h2>
    {data.settings ? <>
      <p className={styles.help}>Rachunek: <strong>{data.settings.cashAccountName}</strong>. Zarejestrowana gotówka razem z nieodebranymi paczkami: {cashFormat(data.settings.balanceCents)}. Salda tego rachunku nie zmieniamy ręcznie.</p>
      <p className={styles.help}>Aktualny cel: <strong>{cashFormat(data.settings.targetFloatCents)}</strong>. Zmiana obejmie aktualnie otwarty raport, a jeśli go nie ma — następny. {openReport ? `W ostatnim odczycie otwarty dzień: ${openReport.businessDate}.` : 'W ostatnim odczycie nie było otwartego dnia.'} Zamknięte dni pozostaną bez zmian.</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); setError('')
        try {
          const targetFloatCents = parseCashierMoney(target)
          if (targetFloatCents === null) throw new Error('Podaj docelową kasę stałą.')
          await onCommand({ action: 'setTarget', costCenterId: data.selectedCostCenterId, version: data.settings!.version, targetFloatCents, reason })
        } catch (error) { setError(error instanceof Error ? error.message : 'Sprawdź kwotę.') }
      }}>
        <CashField label="Nowy poziom kasy stałej" value={target} onChange={setTarget} required />
        {openReport?.countedCents !== null && openReport?.countedCents !== undefined && nextTarget !== null && <div className={styles.cashSplit}><div><span>Po zmianie zostaje</span><strong>{cashFormat(Math.min(openReport.countedCents, nextTarget))}</strong></div><div><span>Po zmianie depozyt</span><strong>{cashFormat(Math.max(openReport.countedCents - nextTarget, 0))}</strong></div></div>}
        <CashNote label="Powód zmiany kasy stałej" value={reason} onChange={setReason} required />
        <Button type="submit" disabled={busy || nextTarget === null || nextTarget === data.settings.targetFloatCents || reason.trim().length < 3}>Zapisz kasę stałą</Button>
      </form>
      <p className={styles.help}>Start ewidencji: {data.settings.startDate}; policzone otwarcie {cashFormat(data.settings.initialCashCents)}. Kwota otwarcia nie jest zmieniana przez nowy cel.</p>
    </> : <>
      <p className={styles.help}>Wskaż rzeczywiste saldo i dzień przejścia z dotychczasowej ewidencji. Nie importujemy starych paczek automatycznie. Rachunek musi przedstawiać tę samą gotówkę, bez dublowania jej w sejfie lub innym saldzie.</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); setError('')
        try {
          const initialCashCents = parseCashierMoney(initialCash), targetFloatCents = parseCashierMoney(target)
          if (initialCashCents === null || targetFloatCents === null) throw new Error('Podaj policzone otwarcie i docelową kasę stałą. Zero wpisz jawnie.')
          if (!sourceConfirmed || (!account || (account === 'new' && !noDuplicate))) throw new Error('Wybierz rachunek i potwierdź źródło danych oraz brak podwójnego salda.')
          await onCommand({ action: 'setup', costCenterId: data.selectedCostCenterId, startDate, initialCashCents, targetFloatCents, sourceReportConfirmed: true, ...(account === 'new' ? { newAccountName: name, noDuplicateCashConfirmed: true } : { cashAccountId: account }) })
        } catch (error) { setError(error instanceof Error ? error.message : 'Sprawdź konfigurację.') }
      }}>
        <div className={styles.fields}><CashField label="Data rozpoczęcia ewidencji" value={startDate} onChange={setStartDate} date required /><CashField label="Policzona gotówka na start" value={initialCash} onChange={setInitialCash} required /><CashField label="Docelowa kasa stała" value={target} onChange={setTarget} required /></div>
        <CashChoice label="Rachunek gotówkowy salonu" value={account} onChange={setAccount} options={[...data.accounts.filter((row) => !row.managedByCostCenterId).map((row) => ({ value: row.id, label: `${row.name} · ${cashFormat(row.balanceCents)}` })), { value: 'new', label: 'Utwórz nowy rachunek gotówkowy' }]} />
        {account === 'new' ? <><label className={styles.field}>Nazwa nowego rachunku<Input aria-label="Nazwa nowego rachunku" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label><CashCheck checked={noDuplicate} onChange={setNoDuplicate}>Potwierdzam: ta gotówka nie jest już wykazana na żadnym innym rachunku.</CashCheck></> : account && <p className={styles.help}>Saldo wybranego rachunku musi być zgodne z policzonym otwarciem. Rozbieżność zatrzyma konfigurację.</p>}
        <CashCheck checked={sourceConfirmed} onChange={setSourceConfirmed}>Potwierdzam źródło: wpisywane wpływy z raportu sprzedaży są przed osobno wykazywanymi zwrotami i nie zawierają kaucji.</CashCheck>
        <Button type="submit" disabled={busy || !sourceConfirmed || !account || (account === 'new' && !noDuplicate)}>Uruchom ewidencję</Button>
      </form>
    </>}
    <CashError error={error} />
  </section>
}
