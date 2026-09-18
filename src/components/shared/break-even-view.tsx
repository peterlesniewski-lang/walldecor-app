'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { InvoiceMoneyUnconverted } from '@/components/shared/invoice-payment-money-summary'
import type { BreakEvenFixedCost, BreakEvenFixedCostMatch, BreakEvenFixedCostRow, BreakEvenMarginSetting, BreakEvenReport, BreakEvenSalonReport, BreakEvenSource } from '@/lib/finance/break-even-types'
import { BreakEvenSettings, isRecurringInvoice, money, numberInput, periodValue, salonName, type BreakEvenAction, type SaveBreakEvenAction } from './break-even-settings'
import { revenueWarsawToday } from '@/lib/validations/revenue'
import styles from './revenue-ui.module.css'
import ui from './break-even-ui.module.css'

type Settings = { margins: BreakEvenMarginSetting[]; fixedCosts: BreakEvenFixedCost[] }
async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, options)
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Nie udało się pobrać danych. Spróbuj ponownie.')
  return data
}

export function BreakEvenView({ initialReport = null }: { initialReport?: BreakEvenReport | null }) {
  const [period, setPeriod] = useState(initialReport ? periodValue(initialReport) : revenueWarsawToday().slice(0, 7))
  const [report, setReport] = useState(initialReport)
  const [settings, setSettings] = useState<Settings>({ margins: [], fixedCosts: [] })
  const [sources, setSources] = useState<BreakEvenSource[]>([])
  const [tab, setTab] = useState<'report' | 'settings'>('report')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(!initialReport)
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)
  const [year, month] = period.split('-').map(Number)

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    const query = `year=${year}&month=${month}`
    Promise.all([request(`/api/finance/break-even?${query}`), request(`/api/finance/break-even/settings?${query}`), request(`/api/finance/break-even/sources?${query}`)])
      .then(([data, currentSettings, sourceData]) => { if (active) { setReport(data.report); setSettings(currentSettings); setSources(sourceData.sources); setLoading(false) } })
      .catch((cause) => { if (active) { setError(cause instanceof Error ? cause.message : 'Błąd połączenia.'); setLoading(false); setReport(null) } })
    return () => { active = false }
  }, [year, month, reload])

  async function save(action: BreakEvenAction) {
    if (saving) return false
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await request('/api/finance/break-even/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) })
      if (result.ok !== true) throw new Error('Serwer nie potwierdził zapisu. Odśwież dane przed kolejną próbą.')
      setNotice('Zapisano zmianę.'); setReload((value) => value + 1)
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Błąd połączenia.'); return false }
    finally { setSaving(false) }
  }
  const busy = saving || loading
  return <div className={`${styles.theme} ${ui.page}`}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Break-even</p><h1 className={styles.title}>Próg sprzedaży salonów</h1><p className={styles.description}>Ile sprzedaży pokrywa koszty miesiąca — przy wspólnej marży firmy.</p></div><label className={styles.field}>Miesiąc raportu<input type="month" min="2020-01" max="2100-12" className={styles.input} value={period} disabled={saving} onChange={(event) => { const next = event.target.value; if (/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(next)) { setPeriod(next); setNotice('') } }} /></label></header>
    <nav className={styles.tabs} aria-label="Widok progu sprzedaży"><button className={styles.tab} aria-pressed={tab === 'report'} onClick={() => setTab('report')}>Podsumowanie miesiąca</button><button className={styles.tab} aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}>Ustawienia i koszty stałe</button></nav>
    {error && <div className={styles.error} role="alert"><p>{error}</p>{!report && <button className={styles.button} onClick={() => setReload((value) => value + 1)}>Spróbuj ponownie</button>}</div>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {loading ? <p role="status" className={styles.notice}>Ładuję dane miesiąca…</p> : report && <>
      <div className={ui.strip}><div><p className={styles.eyebrow}>Marża dla całej firmy</p><strong>{report.margin ? `${(report.margin.margin * 100).toLocaleString('pl-PL')}%` : 'Nie ustawiono'}</strong>{report.margin && <p className={styles.help}>Obowiązuje od {report.margin.effectiveFrom}</p>}</div><button className={styles.button} onClick={() => setTab('settings')}>Ustaw marżę i koszty</button></div>
      {tab === 'settings' ? <BreakEvenSettings report={report} {...settings} sources={sources} busy={busy} save={save} /> : <>
        <p className={styles.warning}>Wynik orientacyjny. Koszty HR nie są jeszcze uwzględnione. Próg obejmuje znane koszty zmienne; kolejne wydatki w miesiącu mogą go zwiększyć.</p>
        {report.warnings.length > 0 && <ul className={ui.warnings}>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <div className={ui.salons}>{Object.values(report.byCostCenter).map((row) => <Salon key={`${period}:${row.costCenterId}`} row={row} report={report} sources={sources} busy={busy} save={save} />)}</div>
        <section className={styles.panel}><h2 className="font-semibold">Dokumenty oczekujące i niepewne</h2><p className={styles.amount}>{money(report.warningSummary?.plnAmount ?? report.warningAmount)}</p><p className={styles.help}>Znana kwota brutto w PLN. Dokumenty niezatwierdzone nie zwiększają kosztów raportu.</p><InvoiceMoneyUnconverted summary={report.warningSummary} formatMoney={money} /></section>
      </>}
    </>}
  </div>
}

function Salon({ row, report, sources, busy, save }: { row: BreakEvenSalonReport; report: BreakEvenReport; sources: BreakEvenSource[]; busy: boolean; save: SaveBreakEvenAction }) {
  const [revenueEditor, setRevenueEditor] = useState(false)
  const [matching, setMatching] = useState<{ fixed: BreakEvenFixedCostRow; match?: BreakEvenFixedCostMatch } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const remaining = row.deltaGross == null ? null : Math.max(0, -row.deltaGross)
  return <section className={ui.salon} data-testid={`salon-${row.costCenterId}`} aria-label={salonName(row.costCenterId)}>
    <div className={ui.salonHead}><div className={styles.header}><h2>{salonName(row.costCenterId)}</h2><span className={ui.badge}>Wynik orientacyjny · bez HR</span></div><p className={styles.eyebrow}>Próg przy kosztach ujętych w raporcie</p><p className={ui.target}>{money(row.targetGross)}</p><p className={styles.help}>Sprzedaż brutto · netto: {money(row.targetNet)}</p>{row.targetGross == null && <p className={styles.help}>Do przeliczenia na brutto potrzebne są aktualne, porównywalne kwoty sprzedaży netto i brutto oraz ustawiona marża.</p>}</div>
    <div className={ui.content}>
      <dl className={ui.metrics}><div><dt>Stałe potwierdzone netto</dt><dd>{money(row.actualFixedNet)}</dd></div><div><dt>Stałe oczekiwane netto</dt><dd>{money(row.expectedFixedNet)}</dd></div><div><dt>Zmienne ujęte netto</dt><dd>{money(row.variableNet)}</dd></div><div><dt>Koszty HR</dt><dd className={ui.warning}>Brak danych</dd></div><div><dt>Sprzedaż brutto</dt><dd>{money(row.revenueGross)}</dd></div><div><dt>Sprzedaż netto</dt><dd>{money(row.revenueNet)}</dd></div></dl>
      <div className={ui.gap}><p className={styles.eyebrow}>{row.deltaGross != null && row.deltaGross >= 0 ? 'Próg pokryty · nadwyżka sprzedaży brutto' : 'Brakuje do progu brutto'}</p><strong>{money(row.deltaGross != null && row.deltaGross >= 0 ? row.deltaGross : remaining)}</strong><p className={styles.help}>Wynik netto po ujętych kosztach: {money(row.operatingResultNet)}</p></div>
      {row.warnings.length > 0 && <ul className={ui.warnings}>{row.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      <div className={styles.toolbar}><button disabled={busy} className={styles.button} onClick={() => setRevenueEditor((value) => !value)}>Uzupełnij sprzedaż netto — {salonName(row.costCenterId)}</button><a className={styles.textButton} href={`/finance/revenue?year=${report.year}&costCenterId=${row.costCenterId}`}>Edytuj sprzedaż brutto</a></div>
      {revenueEditor && <RevenueForm row={row} report={report} busy={busy} save={save} close={() => setRevenueEditor(false)} />}
      {row.revenueBasis && <button disabled={busy} className={styles.textButton} onClick={() => setConfirmClear(true)}>Usuń wpis netto — {salonName(row.costCenterId)}</button>}
      {confirmClear && row.revenueBasis && <div className={styles.warning}><p>Usunąć wpis sprzedaży netto? Kwota brutto pozostanie w przychodach.</p><div className={styles.actions}><button disabled={busy} className={styles.button} onClick={() => setConfirmClear(false)}>Anuluj</button><button disabled={busy} className={styles.button} onClick={async () => { if (await save({ action: 'revenue.delete', id: row.revenueBasis!.id })) setConfirmClear(false) }}>Potwierdź usunięcie netto</button></div></div>}
      <details className={ui.disclosure}><summary>Szczegóły kosztów stałych ({row.fixedCosts.length})</summary><div className={ui.list}>
        {!row.fixedCosts.length && <p className={styles.help}>Dodaj koszty stałe w ustawieniach. Brak szablonów nie oznacza braku kosztów.</p>}
        {row.fixedCosts.map((fixed) => <div className={ui.row} key={fixed.id} data-testid={`fixed-${fixed.id}`}><div><p className={ui.rowName}>{fixed.name}</p><p className={ui.rowMeta}>{fixed.status === 'actual' ? 'Potwierdzony fakturą' : fixed.status === 'expected' ? 'Oczekuje na fakturę' : 'Sprawdź przypisanie'}{fixed.netEstimated ? ' · netto oszacowane' : ''}</p><p className={ui.rowAmount}>{money(fixed.includedNetAmount)} netto</p>{fixed.status === 'actual' && <p className={ui.rowMeta}>W miejsce oczekiwanych {money(fixed.expectedNetAmount)}</p>}</div><button disabled={busy} className={styles.button} onClick={() => setMatching({ fixed })}>Przypisz fakturę — {fixed.name}</button>{fixed.matches.map((match) => <div className={styles.toolbar} key={match.id}><span className={ui.rowMeta}>{sources.find((source) => source.partId === match.costEventPartId && source.costCenterId === row.costCenterId)?.title ?? 'Przypisany dokument'}</span><button disabled={busy} className={styles.button} onClick={() => setMatching({ fixed, match })}>Edytuj kwotę — {fixed.name}</button><button disabled={busy} className={styles.textButton} onClick={() => save({ action: 'match.delete', id: match.id })}>Odłącz fakturę — {fixed.name}</button></div>)}</div>)}
      </div></details>
      {matching && <MatchForm key={`${matching.fixed.id}:${matching.match?.id ?? "new"}`} fixed={matching.fixed} existing={matching.match} row={row} report={report} sources={sources} busy={busy} save={save} close={() => setMatching(null)} />}
      <details className={ui.disclosure}><summary>Jak powstał wynik?</summary><dl className={`${ui.metrics} ${ui.list}`}><div><dt>Próg tylko dla kosztów stałych netto</dt><dd>{money(row.fixedOnlyTargetNet)}</dd></div><div><dt>Stałe razem netto</dt><dd>{money(row.fixedNet)}</dd></div><div><dt>Zakupy towarów netto</dt><dd>{money(row.goodsNet)}</dd></div><div><dt>Jednorazowe netto</dt><dd>{money(row.oneOffNet)}</dd></div></dl><p className={styles.help}>Próg netto = (koszty stałe + ujęte zmienne) / marża. Towary są uwzględnione w marży. Koszty jednorazowe pokazujemy osobno. Brutto wynika z relacji zapisanej sprzedaży brutto do netto, bez zakładania stawki VAT.</p>{row.omittedFixedCount > 0 && <p className={styles.help}>Pozostałe dokumenty kosztów stałych: {row.omittedFixedCount}, netto {money(row.omittedFixedNet)}. Sprawdź przypisanie do szablonów.</p>}</details>
    </div>
  </section>
}

function RevenueForm({ row, report, busy, save, close }: { row: BreakEvenSalonReport; report: BreakEvenReport; busy: boolean; save: SaveBreakEvenAction; close: () => void }) {
  const [amount, setAmount] = useState(row.revenueBasis ? String(row.revenueBasis.netAmount) : '')
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = numberInput(amount)
    if (!amount.trim() || !Number.isFinite(value) || value < 0) { setError('Wpisz kwotę netto nie mniejszą niż zero.'); return }
    if (await save({ action: 'revenue.save', year: report.year, month: report.month, costCenterId: row.costCenterId, netAmount: value })) close()
  }
  return <form className={ui.formBox} onSubmit={submit}><h3>Sprzedaż netto — {salonName(row.costCenterId)}</h3><p className={styles.help}>Wpisz netto dla tych samych kanałów i na ten sam dzień co sprzedaż brutto {money(row.revenueGross)}. Zmiana kwoty brutto wymaga ponownego potwierdzenia netto.</p><label className={styles.field}>Sprzedaż netto — {salonName(row.costCenterId)}<input className={styles.input} required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} /></label>{error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.actions}><button type="button" className={styles.button} disabled={busy} onClick={close}>Anuluj</button><button disabled={busy} className={`${styles.button} ${styles.primary}`}>Zapisz sprzedaż netto</button></div></form>
}

function MatchForm({ fixed, existing, row, report, sources, busy, save, close }: { fixed: BreakEvenFixedCostRow; existing?: BreakEvenFixedCostMatch; row: BreakEvenSalonReport; report: BreakEvenReport; sources: BreakEvenSource[]; busy: boolean; save: SaveBreakEvenAction; close: () => void }) {
  const [sourceId, setSourceId] = useState(existing?.costEventPartId ?? '')
  const [override, setOverride] = useState(existing?.actualNetAmount != null ? String(existing.actualNetAmount) : '')
  const [error, setError] = useState('')
  const available = sources.filter((source) => source.costCenterId === row.costCenterId && (!source.matchedFixedCostId || (source.partId === existing?.costEventPartId && source.matchedFixedCostId === fixed.id)) && isRecurringInvoice(source))
  const source = available.find((item) => item.partId === sourceId)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!source) { setError('Wybierz zatwierdzoną fakturę.'); return }
    const value = override.trim() ? numberInput(override) : null
    if (value != null && (!Number.isFinite(value) || Math.abs(value) > Math.abs(source.grossAmount) || (value !== 0 && Math.sign(value) !== Math.sign(source.grossAmount)))) { setError('Kwota netto musi mieć znak zgodny z dokumentem i nie przekraczać jego kwoty brutto dla salonu.'); return }
    if (source.netAmount == null && value == null) { setError('Dokument nie ma kwoty netto. Wpisz ją przed przypisaniem.'); return }
    if (await save({ action: 'match.save', fixedCostId: fixed.id, year: report.year, month: report.month, costEventPartId: source.partId, actualNetAmount: value })) close()
  }
  return <form className={ui.formBox} onSubmit={submit}><h3>{existing ? "Edytuj kwotę" : "Przypisz fakturę"} — {fixed.name}</h3><label className={styles.field}>Faktura za {periodValue(report)} — {fixed.name}<select className={styles.input} value={sourceId} required disabled={busy || Boolean(existing)} onChange={(event) => { setSourceId(event.target.value); setOverride('') }}><option value="">Wybierz dokument</option>{available.map((item) => <option key={item.partId} value={item.partId}>{item.supplierName} · {item.title} · {money(item.netAmount)} netto</option>)}</select></label>{!available.length && <p className={styles.help}>Brak nieprzypisanych, zatwierdzonych dokumentów dla tego salonu w wybranym miesiącu.</p>}{source && !source.tags.includes('fixed') && <p className={styles.warning}>Dokument nie ma klasyfikacji kosztu stałego. Potwierdź, że dotyczy tego regularnego zobowiązania; przypisanie nie zmienia klasyfikacji faktury.</p>}{source?.netEstimated && <p className={styles.warning}>Netto oszacowano proporcjonalnie z faktury. Możesz podać dokładną kwotę dla tej części i salonu.</p>}<label className={styles.field}>Dokładna kwota netto (opcjonalnie)<input disabled={busy} className={styles.input} inputMode="decimal" value={override} onChange={(event) => setOverride(event.target.value)} placeholder={source?.netAmount != null ? String(source.netAmount) : 'Wpisz, jeśli brak netto'} /></label><p className={styles.help}>Przypisane faktury zastępują całą kwotę oczekiwaną w tym miesiącu. Kwota dotyczy wyłącznie {salonName(row.costCenterId)}.</p>{error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.actions}><button type="button" disabled={busy} className={styles.button} onClick={close}>Anuluj</button><button disabled={busy || !source} className={`${styles.button} ${styles.primary}`}>Zapisz przypisanie</button></div></form>
}
