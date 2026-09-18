'use client'

import { useState, type FormEvent } from 'react'
import { canMatchFixedCostSource } from '@/lib/finance/break-even-engine'
import type { BreakEvenFixedCost, BreakEvenMarginSetting, BreakEvenReport, BreakEvenSource } from '@/lib/finance/break-even-types'
import styles from './revenue-ui.module.css'
import ui from './break-even-ui.module.css'

export type BreakEvenAction = Record<string, unknown> & { action: string }
export type SaveBreakEvenAction = (action: BreakEvenAction) => Promise<boolean>
export const money = (value: number | null, currency = 'PLN') => value == null ? 'Brak danych' : value.toLocaleString('pl-PL', { style: 'currency', currency, currencyDisplay: currency === 'PLN' ? 'symbol' : 'code' })
export const numberInput = (value: string) => Number(value.replace(/\s/g, '').replace(',', '.'))
export const salonName = (id: string) => id === 'JAG' ? 'Jagiellońska' : id === 'PUL' ? 'Puławska' : 'Firma'
export const periodValue = (report: { year: number; month: number }) => `${report.year}-${String(report.month).padStart(2, '0')}`
export const isRecurringInvoice = (source: BreakEvenSource) => Boolean(source.sourceInvoiceId) && canMatchFixedCostSource(source.tags)
const percentage = (value: number) => `${(value * 100).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%`

export function BreakEvenSettings({ report, margins, fixedCosts, sources, busy, save }: {
  report: BreakEvenReport; margins: BreakEvenMarginSetting[]; fixedCosts: BreakEvenFixedCost[]; sources: BreakEvenSource[]; busy: boolean; save: SaveBreakEvenAction
}) {
  const [marginEditor, setMarginEditor] = useState<BreakEvenMarginSetting | 'new' | null>(null)
  const [fixedEditor, setFixedEditor] = useState<BreakEvenFixedCost | 'new' | null>(null)
  const [confirmation, setConfirmation] = useState<{ action: BreakEvenAction; label: string } | null>(null)
  const suggestion = report.historicalSuggestion
  return <div className={ui.settings}>
    <section className={styles.panel} aria-labelledby="margin-heading">
      <div className={styles.header}><div><p className={styles.eyebrow}>Wspólne założenie</p><h2 id="margin-heading" className="text-xl font-extrabold">Marża firmy</h2><p className={styles.description}>Jedna marża dla obu salonów, po koszcie zakupu towarów. Zmiana obowiązuje od wskazanego miesiąca.</p></div><button className={styles.button} disabled={busy} onClick={() => setMarginEditor('new')}>Dodaj marżę</button></div>
      <div className={styles.notice}>
        <strong>Podpowiedź historyczna: {suggestion?.status === 'available' && suggestion.margin != null ? percentage(suggestion.margin) : 'za mało danych'}</strong>
        <p className={styles.help}>Orientacyjnie: sprzedaż netto pomniejszona o zakupy towarów. Zakupy nie muszą odpowiadać kosztowi sprzedanego towaru; sprawdź zapasy. Ta wartość nie zmienia ustawionej marży.</p>
        {suggestion?.months?.length > 0 && <p className={styles.help}>Okres: {suggestion.months.join(', ')}.</p>}
        {suggestion?.warnings?.map((warning) => <p className={styles.help} key={warning}>{warning}</p>)}
      </div>
      {!margins.length && <p className={styles.help}>Dodaj marżę, aby obliczyć próg sprzedaży.</p>}
      <div className={ui.list}>{margins.map((margin) => <div className={ui.row} key={margin.id}><div><p className={ui.rowName}>{percentage(margin.margin)} <span className={ui.rowMeta}>od {margin.effectiveFrom}</span></p>{margin.note && <p className={ui.rowMeta}>{margin.note}</p>}</div><div className={styles.toolbar}><button disabled={busy} className={styles.button} onClick={() => setMarginEditor(margin)}>Edytuj marżę {margin.effectiveFrom}</button><button disabled={busy} className={styles.textButton} onClick={() => setConfirmation({ action: { action: 'margin.delete', id: margin.id }, label: `Usunąć marżę obowiązującą od ${margin.effectiveFrom}? Raporty dla tego okresu zostaną przeliczone.` })}>Usuń</button></div></div>)}</div>
      {marginEditor && <MarginForm key={typeof marginEditor === 'string' ? 'new' : marginEditor.id} value={marginEditor} period={periodValue(report)} busy={busy} save={save} close={() => setMarginEditor(null)} />}
    </section>
    <section className={styles.panel} aria-labelledby="fixed-heading">
      <div className={styles.header}><div><p className={styles.eyebrow}>Miesięczne zobowiązania</p><h2 id="fixed-heading" className="text-xl font-extrabold">Koszty stałe</h2><p className={styles.description}>Dodaj czynsz, media lub inne regularne koszty. Kwota oczekiwana jest uwzględniona do czasu przypisania faktury za dany miesiąc.</p></div><button disabled={busy} className={styles.button} onClick={() => setFixedEditor('new')}>Dodaj koszt stały</button></div>
      <p className={styles.help}>W podsumowaniu miesiąca przypisz zatwierdzoną fakturę do kosztu. Zastąpi ona kwotę oczekiwaną. Samo pojawienie się faktury nie potwierdza przypisania.</p>
      {!fixedCosts.length && <p className={styles.notice}>Brak zdefiniowanych kosztów stałych. Dodaj pierwszy z listy faktur lub ręcznie.</p>}
      <div className={ui.list}>{fixedCosts.map((fixed) => <div className={ui.row} key={fixed.id}><div><p className={ui.rowName}>{fixed.name} {!fixed.active && <span className={ui.badge}>Archiwum</span>}</p><p className={ui.rowMeta}>{salonName(fixed.costCenterId)} · {money(fixed.expectedNetAmount)} netto / miesiąc · {fixed.effectiveFrom} — {fixed.effectiveTo ?? 'bez daty końcowej'}</p>{fixed.supplierName && <p className={ui.rowMeta}>{fixed.supplierName}</p>}</div><div className={styles.toolbar}><button disabled={busy} className={styles.button} onClick={() => setFixedEditor(fixed)}>{fixed.active ? 'Edytuj' : 'Przywróć'} {fixed.name}</button>{fixed.active && <button disabled={busy} className={styles.textButton} onClick={() => setConfirmation({ action: { action: 'fixed.archive', id: fixed.id }, label: `Zarchiwizować „${fixed.name}”? Szablon przestanie być uwzględniany w raportach. Aby zakończyć go od konkretnego miesiąca, użyj daty końcowej w edycji.` })}>Archiwizuj</button>}</div></div>)}</div>
      {fixedEditor && <FixedForm key={typeof fixedEditor === 'string' ? 'new' : fixedEditor.id} value={fixedEditor} period={periodValue(report)} sources={sources} busy={busy} save={save} close={() => setFixedEditor(null)} />}
    </section>
    {confirmation && <section className={styles.warning} role="alert"><p>{confirmation.label}</p><div className={styles.actions}><button disabled={busy} className={styles.button} onClick={() => setConfirmation(null)}>Anuluj</button><button disabled={busy} className={`${styles.button} ${styles.primary}`} onClick={async () => { if (await save(confirmation.action)) setConfirmation(null) }}>Potwierdź</button></div></section>}
  </div>
}

function MarginForm({ value, period, busy, save, close }: { value: BreakEvenMarginSetting | 'new'; period: string; busy: boolean; save: SaveBreakEvenAction; close: () => void }) {
  const existing = value === 'new' ? null : value
  const [margin, setMargin] = useState(existing ? String(existing.margin * 100) : '')
  const [from, setFrom] = useState(existing?.effectiveFrom ?? period)
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    const amount = numberInput(margin)
    if (!margin.trim() || !Number.isFinite(amount) || amount <= 0 || amount > 100) { setError('Marża musi być większa od 0 i nie większa niż 100%.'); return }
    setError('')
    if (await save({ action: 'margin.save', ...(existing ? { id: existing.id } : {}), margin: amount / 100, effectiveFrom: from, note: note || null })) close()
  }
  return <form className={ui.formBox} onSubmit={submit}><h3>{existing ? 'Edytuj marżę' : 'Nowa marża'}</h3><div className={ui.formGrid}>
    <label className={styles.field}>Marża (%)<input className={styles.input} inputMode="decimal" value={margin} onChange={(event) => setMargin(event.target.value)} required disabled={busy} /></label>
    <label className={styles.field}>Marża obowiązuje od<input className={styles.input} type="month" min="2020-01" max="2100-12" value={from} onChange={(event) => setFrom(event.target.value)} required disabled={busy} /></label>
    <label className={`${styles.field} ${ui.full}`}>Notatka do marży<input className={styles.input} value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} /></label>
  </div>{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.actions}><button type="button" className={styles.button} disabled={busy} onClick={close}>Anuluj</button><button className={`${styles.button} ${styles.primary}`} disabled={busy}>Zapisz marżę</button></div></form>
}

function FixedForm({ value, period, sources, busy, save, close }: { value: BreakEvenFixedCost | 'new'; period: string; sources: BreakEvenSource[]; busy: boolean; save: SaveBreakEvenAction; close: () => void }) {
  const existing = value === 'new' ? null : value
  const [name, setName] = useState(existing?.name ?? '')
  const [center, setCenter] = useState(existing?.costCenterId ?? 'JAG')
  const [amount, setAmount] = useState(existing ? String(existing.expectedNetAmount) : '')
  const [from, setFrom] = useState(existing?.effectiveFrom ?? period)
  const [to, setTo] = useState(existing?.effectiveTo ?? '')
  const [supplierName, setSupplierName] = useState(existing?.supplierName ?? '')
  const [supplierNip, setSupplierNip] = useState(existing?.supplierNip ?? '')
  const [sourceId, setSourceId] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const eligible = sources.filter((source) => ['JAG', 'PUL'].includes(source.costCenterId) && isRecurringInvoice(source))
  const selected = eligible.find((source) => `${source.partId}:${source.costCenterId}` === sourceId)
  function pick(id: string) {
    setSourceId(id)
    const source = eligible.find((row) => `${row.partId}:${row.costCenterId}` === id)
    if (!source) return
    setName(source.title); setCenter(source.costCenterId as 'JAG' | 'PUL'); setAmount(source.netAmount == null ? '' : String(source.netAmount)); setSupplierName(source.supplierName ?? ''); setSupplierNip(source.supplierNip ?? '')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = numberInput(amount)
    if (!name.trim() || !amount.trim() || !Number.isFinite(parsed) || parsed < 0) { setError('Podaj nazwę i miesięczną kwotę netto nie mniejszą niż zero.'); return }
    if (to && to < from) { setError('Miesiąc końcowy nie może poprzedzać początkowego.'); return }
    setError('')
    if (await save({ action: 'fixed.save', ...(existing ? { id: existing.id } : {}), name: name.trim(), costCenterId: center, expectedNetAmount: parsed, effectiveFrom: from, effectiveTo: to || null, supplierName: supplierName || null, supplierNip: supplierNip || null })) close()
  }
  return <form className={ui.formBox} onSubmit={submit}><h3>{existing ? 'Edytuj koszt stały' : 'Nowy koszt stały'}</h3>
    {!existing && <><label className={styles.field}>Znajdź zatwierdzoną fakturę w miesiącu {period}<input className={styles.input} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Dostawca lub numer dokumentu" disabled={busy} /></label><label className={styles.field}>Utwórz na podstawie faktury<select className={styles.input} value={sourceId} onChange={(event) => pick(event.target.value)} disabled={busy}><option value="">Wpisz ręcznie lub wybierz dokument</option>{eligible.filter((source) => `${source.title} ${source.supplierName ?? ''}`.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl'))).map((source) => <option key={`${source.partId}:${source.costCenterId}`} value={`${source.partId}:${source.costCenterId}`}>{salonName(source.costCenterId)} · {source.supplierName} · {source.title} · {money(source.netAmount)} netto</option>)}</select></label><p className={styles.help}>Aby znaleźć starszą fakturę, zmień miesiąc raportu. Wybranie dokumentu uzupełnia szablon; przypisanie do miesiąca wykonasz w podsumowaniu.</p>{selected && !selected.tags.includes('fixed') && <p className={styles.warning}>Dokument nie ma klasyfikacji kosztu stałego. Sprawdź, czy jest regularnym zobowiązaniem. Utworzenie szablonu nie zmienia klasyfikacji faktury.</p>}{selected?.netEstimated && <p className={styles.warning}>Kwota netto tej części faktury jest oszacowana proporcjonalnie. Sprawdź lub popraw kwotę oczekiwaną.</p>}</>}
    <div className={ui.formGrid}>
      <label className={`${styles.field} ${ui.full}`}>Nazwa kosztu<input required className={styles.input} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
      <label className={styles.field}>Salon<select className={styles.input} value={center} onChange={(event) => setCenter(event.target.value as 'JAG' | 'PUL')} disabled={busy}><option value="JAG">Jagiellońska</option><option value="PUL">Puławska</option></select></label>
      <label className={styles.field}>Oczekiwana kwota netto / miesiąc<input required inputMode="decimal" className={styles.input} value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} /></label>
      <label className={styles.field}>Koszt obowiązuje od<input required type="month" min="2020-01" max="2100-12" className={styles.input} value={from} onChange={(event) => setFrom(event.target.value)} disabled={busy} /></label>
      <label className={styles.field}>Ostatni miesiąc (opcjonalnie)<input type="month" min={from} max="2100-12" className={styles.input} value={to} onChange={(event) => setTo(event.target.value)} disabled={busy} /></label>
      <label className={styles.field}>Dostawca (opcjonalnie)<input className={styles.input} value={supplierName} onChange={(event) => setSupplierName(event.target.value)} disabled={busy} /></label>
      <label className={styles.field}>NIP dostawcy (opcjonalnie)<input className={styles.input} value={supplierNip} onChange={(event) => setSupplierNip(event.target.value)} disabled={busy} /></label>
    </div>{error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.actions}><button type="button" disabled={busy} className={styles.button} onClick={close}>Anuluj</button><button disabled={busy} className={`${styles.button} ${styles.primary}`}>Zapisz koszt stały</button></div>
  </form>
}
