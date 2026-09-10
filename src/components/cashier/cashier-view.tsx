'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CashierBootstrap, CashierCenterId, CashierCommand, CashierCommandResult } from '@/lib/cashier/contracts'
import { CashChoice, CashError, CashField } from './cashier-ui'
import { CashierReportEditor } from './cashier-report-editor'
import { CashierSettingsPanel } from './cashier-settings-panel'
import { CashierDeposits } from './cashier-deposits'
import { cashFormat } from './money'
import styles from './cashier.module.css'

const auditLabels: Record<string, string> = {
  SETUP: 'Uruchomienie kasy', SET_TARGET: 'Zmiana kasy stałej', CREATE_REPORT: 'Otwarcie dnia', UPDATE_REPORT: 'Zapis kwot',
  ADD_OPERATION: 'Dodanie operacji', UPDATE_OPERATION: 'Edycja operacji', CANCEL_OPERATION: 'Anulowanie operacji',
  CLOSE_REPORT: 'Zamknięcie dnia', CORRECT_REPORT: 'Korekta dnia', RECEIVE_DEPOSIT: 'Odbiór paczki', VERIFY_DEPOSIT: 'Przeliczenie paczki',
}

export function CashierView() {
  const [data, setData] = useState<CashierBootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [tab, setTab] = useState('reports')
  const [date, setDate] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false)
  const [editorResetKey, setEditorResetKey] = useState(0)
  const inflight = useRef(false)
  const sequence = useRef(0)

  const reload = useCallback(async (center?: CashierCenterId, reportId?: string, dateFrom = '', dateTo = '', auditPage = 1) => {
    const seq = ++sequence.current
    setLoading(true)
    try {
      const query = new URLSearchParams()
      if (center) query.set('costCenterId', center)
      if (reportId) query.set('reportId', reportId)
      if (dateFrom) query.set('from', dateFrom)
      if (dateTo) query.set('to', dateTo)
      if (auditPage > 1) query.set('auditPage', String(auditPage))
      const response = await fetch(`/api/cashier?${query}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setData(null)
        throw new Error(body.error ?? 'Nie udało się pobrać kasy.')
      }
      if (seq !== sequence.current) return false
      setData(body as CashierBootstrap)
      setNeedsRefresh(false)
      setDate((current) => current || (body as CashierBootstrap).today)
      return true
    } catch (error) {
      setNeedsRefresh(true)
      if (seq === sequence.current) setError(error instanceof Error ? error.message : 'Brak połączenia z kasą. Sprawdź stan przed ponowieniem operacji.')
      return false
    } finally { if (seq === sequence.current) setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const navigate = (action: () => void) => {
    if (hasUnsavedEdits && !window.confirm('Masz niezapisane dane rozliczenia. Odrzucić je i przejść dalej?')) return
    if (hasUnsavedEdits) setEditorResetKey((value) => value + 1)
    setHasUnsavedEdits(false)
    action()
  }
  useEffect(() => {
    if (!hasUnsavedEdits) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const followLink = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest('a[href]')
      if (!anchor || event.defaultPrevented) return
      if (!window.confirm('Masz niezapisane dane rozliczenia. Odrzucić je i opuścić kasę?')) { event.preventDefault(); event.stopPropagation() }
      else setHasUnsavedEdits(false)
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', followLink, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', followLink, true) }
  }, [hasUnsavedEdits])

  const onCommand = async (command: CashierCommand) => {
    if (inflight.current) return false
    inflight.current = true; setBusy(true); setError(''); setStatus('')
    let serverResponded = false
    try {
      const response = await fetch('/api/cashier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) })
      const result = await response.json()
      serverResponded = true
      if (!response.ok) {
        if (response.status === 409) {
          const refreshed = await reload(command.costCenterId, 'reportId' in command ? command.reportId : data?.selectedReport?.id, from, to)
          throw new Error(`${result.error ?? 'Dane zostały zmienione.'} ${refreshed ? 'Pobrano aktualny stan — sprawdź kwoty i potwierdź ponownie.' : 'Nie udało się pobrać aktualnego stanu. Odśwież go przed kolejną operacją.'}`)
        }
        if (response.status === 401 || response.status === 403) setData(null)
        throw new Error(result.error ?? 'Nie udało się zapisać.')
      }
      const saved = result as CashierCommandResult
      const readBack = await reload(command.costCenterId, saved.reportId ?? data?.selectedReport?.id, from, to)
      setStatus(readBack ? (saved.replayed ? 'Operacja była już zapisana. Pobrano aktualny stan.' : 'Zapisano i pobrano aktualny stan.') : 'Serwer przyjął zapis, ale nie udało się pobrać aktualnego stanu. Użyj „Odśwież stan” przed kolejną operacją.')
      return readBack
    } catch (error) {
      if (!serverResponded) setNeedsRefresh(true)
      setError(error instanceof Error ? error.message : 'Nie potwierdzono zapisu. Odśwież stan przed ponowieniem operacji.')
      return false
    } finally { inflight.current = false; setBusy(false) }
  }

  const locked = busy || loading || needsRefresh
  return <div className={styles.root} aria-busy={busy || loading}>
    <header className={styles.header}><div><p className={styles.eyebrow}>WallDecor · codzienne rozliczenie</p><h1>Kasa salonu</h1><p className={styles.help}>Policz. Pozostaw kasę stałą. Przekaż depozyt.</p></div>{data && <CashChoice label="Salon" value={data.selectedCostCenterId} onChange={(value) => navigate(() => { setError(''); setStatus(''); void reload(value as CashierCenterId, undefined, from, to) })} options={data.centers.map((center) => ({ value: center.id, label: center.name }))} disabled={locked || data.actor.role !== 'ADMIN'} />}</header>
    <CashError error={error} />{status && <p role="status" className={styles.status}>{status}</p>}
    <div className={styles.actions}><Button type="button" variant="outline" disabled={busy || loading} onClick={() => navigate(() => { setError(''); void reload(data?.selectedCostCenterId, data?.selectedReport?.id, from, to) })}>Odśwież stan</Button>{loading && <span className={styles.help}>Pobieranie aktualnego stanu…</span>}{needsRefresh && !loading && <span className={styles.warning}>Zapis jest zablokowany do czasu odświeżenia stanu.</span>}</div>
    {!data ? !loading && <div className={styles.empty}><h2>Kasa niedostępna</h2><p className={styles.help}>Dostęp wymaga aktywnego konta administratora albo pracownika przypisanego do salonu. Przy błędzie połączenia spróbuj odświeżyć stan.</p></div> : <>
      <div className={styles.tabs} aria-label="Widoki kasy">{[{ id: 'reports', label: 'Rozliczenia dni' }, { id: 'deposits', label: 'Depozyty' }, ...(data.actor.role === 'ADMIN' ? [{ id: 'settings', label: 'Kasa stała i start' }] : []), { id: 'history', label: 'Historia zmian' }].map((item) => <Button key={item.id} type="button" variant="ghost" aria-pressed={tab === item.id} disabled={locked} onClick={() => navigate(() => setTab(item.id))}>{item.label}</Button>)}</div>
      {!data.settings && tab !== 'settings' && <div className={styles.empty}><h2>Ten salon nie ma jeszcze uruchomionej ewidencji</h2><p className={styles.help}>Administrator musi wskazać datę startu, policzone otwarcie i rachunek gotówkowy. Do tego czasu nie tworzymy raportów ani zerowych sald.</p>{data.actor.role === 'ADMIN' && <Button onClick={() => setTab('settings')}>Skonfiguruj kasę salonu</Button>}</div>}
      {tab !== 'settings' && data.settings && <form className={styles.fields} onSubmit={(event) => { event.preventDefault(); navigate(() => { setError(''); void reload(data.selectedCostCenterId, undefined, from, to) }) }}><CashField label={tab === 'history' ? 'Data zmiany od' : 'Okres od'} value={from} onChange={setFrom} date /><CashField label={tab === 'history' ? 'Data zmiany do' : 'Okres do'} value={to} onChange={setTo} date /><div className={styles.actions}><Button type="submit" variant="outline" disabled={busy || loading}>Zastosuj okres</Button><Button type="button" variant="ghost" disabled={busy || loading} onClick={() => navigate(() => { setFrom(''); setTo(''); setError(''); void reload(data.selectedCostCenterId) })}>Wyczyść okres</Button></div></form>}
      {tab === 'settings' && data.actor.role === 'ADMIN' && <CashierSettingsPanel key={`${data.selectedCostCenterId}:${data.settings?.version ?? 'setup'}`} data={data} busy={locked} onCommand={onCommand} />}
      {tab === 'reports' && data.settings && <div className={styles.layout}><aside className={styles.panel}><h2>Dni pracy</h2><form onSubmit={(event) => { event.preventDefault(); navigate(() => { void onCommand({ action: 'createReport', costCenterId: data.selectedCostCenterId, businessDate: date }) }) }}><CashField label="Dzień rozliczenia" value={date} onChange={setDate} date required /><Button type="submit" disabled={locked}>Otwórz dzień</Button></form><p className={styles.help}>Nie dopisujemy automatycznie pominiętych dni.</p><div className={styles.reportList}>{data.reports.map((report) => <button key={report.id} type="button" disabled={locked} aria-pressed={data.selectedReport?.id === report.id} onClick={() => navigate(() => { setError(''); void reload(data.selectedCostCenterId, report.id, from, to) })}><span>{report.businessDate}</span><small>{report.status === 'DRAFT' ? 'Otwarty' : 'Zamknięty'}</small></button>)}</div>{data.reportsTruncated && <p className={styles.warning}>Pokazano 200 najnowszych raportów. Zawęź okres, aby otworzyć starsze dni.</p>}</aside>{data.selectedReport ? <CashierReportEditor key={`${data.selectedReport.id}:${editorResetKey}`} report={data.selectedReport} isAdmin={data.actor.role === 'ADMIN'} busy={busy} blocked={loading || needsRefresh} onCommand={onCommand} onDirtyChange={setHasUnsavedEdits} /> : <div className={styles.empty}><h2>Brak raportu w tym okresie</h2><p className={styles.help}>Wybierz dzień rozliczenia i otwórz arkusz. Wpływy oraz policzona gotówka pozostaną puste, dopóki nie zostaną zapisane.</p></div>}</div>}
      {tab === 'deposits' && data.settings && <><p className={styles.status}>Gotówka w paczkach oczekujących na odbiór: <strong className="num">{cashFormat(data.waitingDepositsCents)}</strong>. To część istniejącego salda kasy salonu.</p><CashierDeposits deposits={data.deposits} accounts={data.accounts} isAdmin={data.actor.role === 'ADMIN'} busy={locked} onCommand={onCommand} />{data.depositsTruncated && <p className={styles.warning}>Pokazano 500 najnowszych depozytów. Zawęź okres.</p>}</>}
      {tab === 'history' && data.settings && <section className={styles.panel}>
        <h2>Historia zmian · {data.selectedCostCenterId}</h2>
        <p className={styles.help}>Wpisy zachowują wcześniejsze wartości, autora i powód. Filtr dotyczy daty wykonania zmiany, nie dnia rozliczenia. Strefa czasowa: Warszawa.</p>
        <ul className={styles.audit}>{data.audit.map((entry) => <li key={entry.id}>
          <strong>{auditLabels[entry.action] ?? entry.action}</strong>
          <p>{entry.actorName} · {new Date(entry.createdAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}</p>
          {entry.reason && <p>{entry.reason}</p>}
          <details><summary>Pokaż wartości przed i po</summary><pre>Przed: {entry.beforeJson ?? 'brak'}{'\n\n'}Po: {entry.afterJson}</pre></details>
        </li>)}</ul>
        {!data.audit.length && <p className={styles.help}>Brak wpisów historii w tym okresie.</p>}
        <div className={styles.actions} aria-label="Strony historii">
          <Button variant="outline" disabled={locked || data.auditPage <= 1} onClick={() => { void reload(data.selectedCostCenterId, data.selectedReport?.id, from, to, data.auditPage - 1) }}>Nowsze zmiany</Button>
          <span className={styles.help}>Strona {data.auditPage}</span>
          <Button variant="outline" disabled={locked || !data.auditHasMore} onClick={() => { void reload(data.selectedCostCenterId, data.selectedReport?.id, from, to, data.auditPage + 1) }}>Starsze zmiany</Button>
        </div>
      </section>}
    </>}
  </div>
}
