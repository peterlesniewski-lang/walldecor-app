'use client'

import { useEffect, useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, ArrowRight, CalendarDays } from 'lucide-react'
import { CashFlowRow, type CashFlowRowProps } from '@/components/shared/cash-flow-row'
import { AlertsWidget, type AlertNotification, type PaymentReminderWithDays } from '@/components/alerts/alerts-widget'
import type { ActualDashboardModel, DashboardMonth, DashboardPeriod } from '@/lib/finance/actual-dashboard'
import type { CenterNet, RevenueNetGap } from '@/lib/finance/ceo-net'
import { employeeCostReadiness } from '@/lib/finance/employee-cost-readiness'
import { parseRevenueAmount } from '@/lib/validations/revenue'
import styles from './dashboard-theme.module.css'

interface DashboardViewProps extends Omit<CashFlowRowProps, 'initialAccounts'> {
  model: ActualDashboardModel
  cashAccounts: CashFlowRowProps['initialAccounts']
  userName: string
  budgetAlerts?: AlertNotification[]
  paymentAlerts?: PaymentReminderWithDays[]
}

const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień']
const SHORT_MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']
const CENTER_NAMES: Record<string, string> = { PUL: 'Puławska', JAG: 'Jagiellońska', GLOBAL: 'GLOBAL · koszty wspólne' }
const SALON_NAMES: Record<string, string> = { PUL: 'Puławska', JAG: 'Jagiellońska', GLOBAL: 'GLOBAL' }
const money = (amount: number | null) => amount === null ? '—' : `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
const signedMoney = (amount: number) => `${amount > 0 ? '+' : ''}${money(amount)}`
function resultColor(result: number | null) {
  if (result !== null && result < 0) return styles.negative
  return 'text-[var(--wd-dark)]'
}
function chartCaption(month: DashboardMonth) {
  if (month.futureMonth) return 'Brak danych'
  if (month.partialMonth) return 'W toku'
  if (month.net.chartValue === null) return month.revenue === null && !month.hasCosts ? 'Brak danych' : 'Niepełne'
  return month.complete ? 'Dane dokumentów' : 'Niepełne'
}

function PeriodSelector({ year, month }: DashboardPeriod) {
  const router = useRouter()
  const [draftYear, setYear] = useState(String(year))
  const [draftMonth, setMonth] = useState(String(month))
  const [pending, startTransition] = useTransition()
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault()
      startTransition(() => router.push(`/dashboard?year=${draftYear}&month=${draftMonth}`))
    }}>
      <label className="text-xs font-semibold text-[var(--wd-text-muted)]">Rok
        <input aria-label="Rok" type="number" min="2020" max="2100" required value={draftYear} onChange={(event) => setYear(event.target.value)} className="num mt-1 block w-24 rounded-lg border border-[var(--wd-border)] bg-white px-3 py-2 text-sm text-[var(--wd-dark)]" />
      </label>
      <label className="text-xs font-semibold text-[var(--wd-text-muted)]">Miesiąc
        <select aria-label="Miesiąc" value={draftMonth} onChange={(event) => setMonth(event.target.value)} className="mt-1 block rounded-lg border border-[var(--wd-border)] bg-white px-3 py-2 text-sm text-[var(--wd-dark)]">
          {MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
        </select>
      </label>
      <button disabled={pending} className="rounded-lg bg-[var(--wd-dark)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Pokaż okres</button>
    </form>
  )
}

function YearChart({ year, selectedMonth, months }: { year: number; selectedMonth: number; months: DashboardMonth[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const magnitudes = months.map((month) => month.net.chartValue).filter((value): value is number => value !== null).map((value) => Math.abs(value))
  const max = Math.max(1, ...magnitudes)
  return (
    <section aria-label="Wykres stycznia do grudnia" className="rounded-2xl border border-[var(--wd-border)] bg-white p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">Styczeń–grudzień {year}</h2>
        <p className="text-xs text-[var(--wd-text-muted)]">Słupek to różnica po znanych kosztach netto, bez kosztów pracowniczych. Pusty słupek oznacza brak policzonej różnicy, nie zero.</p>
      </div>
      <div className={styles.yearChart}>
        {months.map((month) => {
          const value = month.net.chartValue
          const sign = value === null ? 'empty' : value < 0 ? 'neg' : value === 0 ? 'zero' : 'pos'
          const height = value === null ? 0 : value === 0 ? 3 : Math.max(8, Math.round(Math.abs(value) / max * 100))
          const caption = chartCaption(month)
          return (
            <button
              key={month.month}
              type="button"
              aria-pressed={month.month === selectedMonth}
              aria-label={`${MONTHS[month.month - 1]} ${year}, ${caption}${value === null ? '' : `, ${money(value)}`}`}
              disabled={pending}
              className={styles.monthButton}
              onClick={() => startTransition(() => router.push(`/dashboard?year=${year}&month=${month.month}`))}
            >
              <span className={styles.barTrack} aria-hidden="true"><span className={styles.bar} data-sign={sign} style={{ height: value === null ? undefined : `${height}%` }} /></span>
              <span className="text-xs font-semibold">{SHORT_MONTHS[month.month - 1]}</span>
              <span className={`text-[10px] leading-tight ${caption === 'Dane dokumentów' ? 'text-[var(--wd-text-muted)]' : styles.warning}`}>{caption}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function NetRevenueForm({ year, month, gap }: { year: number; month: number; gap: RevenueNetGap }) {
  const router = useRouter()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const salon = SALON_NAMES[gap.costCenterId] ?? gap.costCenterId
  if (gap.status === 'unsupported') {
    return <p className={`text-xs ${styles.warning}`}>Sprzedaż netto — {salon}: brak. Przy ujemnym brutto nie da się zapisać podstawy netto.</p>
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseRevenueAmount(amount)
    if (!amount.trim() || !Number.isFinite(value) || value < 0) {
      setError('Wpisz kwotę netto nie mniejszą niż zero.')
      return
    }
    setError('')
    const response = await fetch('/api/finance/break-even/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revenue.save', year, month, costCenterId: gap.costCenterId, netAmount: value }),
    })
    const body = await response.json().catch(() => null) as { error?: string } | null
    if (!response.ok) {
      setError(typeof body?.error === 'string' ? body.error : 'Nie udało się zapisać sprzedaży netto.')
      return
    }
    startTransition(() => router.refresh())
  }
  return (
    <form className="mt-3 grid gap-2 rounded-xl border border-[var(--wd-border)] bg-[var(--wd-surface-2)] p-3" onSubmit={submit}>
      <p className="text-xs font-semibold">{gap.status === 'stale' ? `Brutto zmieniło się — zapisz netto ponownie. ${salon}` : `Brak netto — ${salon}`}</p>
      <p className="text-xs text-[var(--wd-text-muted)]">Wpisz rzeczywiste netto dla tego salonu i miesiąca. Brutto tego salonu: {money(gap.gross)}. Nie przeliczamy stawki VAT.</p>
      <label className="text-xs font-semibold">Sprzedaż netto — {salon}
        <input className="num mt-1 block w-full rounded-lg border border-[var(--wd-border)] bg-white px-3 py-2 text-sm" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} disabled={pending} />
      </label>
      {error && <p role="alert" className={`text-xs ${styles.warning}`}>{error}</p>}
      <button disabled={pending} className="w-fit rounded-lg bg-[var(--wd-dark)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Zapisz sprzedaż netto</button>
    </form>
  )
}

function revenueText(net: CenterNet) {
  if (net.revenueStatus === 'confirmed') return money(net.revenueNet)
  if (net.revenueStatus === 'missing' || net.revenueStatus === 'stale' || net.revenueStatus === 'unsupported') return 'Brak netto'
  return '—'
}
function costText(net: CenterNet) {
  if (net.costsStatus === 'confirmed') return money(net.costsNet)
  if (net.costsStatus === 'uncertain') return 'Netto niepewne'
  return '—'
}

export function DashboardView({ model, userName, cashAccounts, budgetAlerts = [], paymentAlerts = [], ...cashProps }: DashboardViewProps) {
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 300_000)
    return () => clearInterval(timer)
  }, [router])
  const { period, selected, ytd, yoy, waiting } = model
  const periodTitle = `${MONTHS[period.month - 1]} ${period.year}`
  const revenueHref = `/finance/revenue?year=${period.year}&month=${period.month}`
  const costsHref = '/finance/cost-events'
  const periodStatus = selected.partialMonth ? 'Miesiąc w toku' : selected.futureMonth ? 'Przyszły okres' : selected.complete ? 'Dane za pełny miesiąc' : 'Dane niepełne'
  return (
    <div className={`${styles.root} space-y-7 text-[var(--wd-dark)]`}>
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="data-label mb-1">Przegląd właściciela{userName ? ` · ${userName.split(' ')[0]}` : ''}</p>
          <h1 className="text-3xl font-extrabold tracking-tight">Finanse firmy</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-[var(--wd-text-muted)]"><CalendarDays size={15} />{periodTitle} · netto jest kwotą główną, brutto informacją pomocniczą</p>
        </div>
        <PeriodSelector key={`${period.year}-${period.month}`} {...period} />
      </header>

      <YearChart year={period.year} selectedMonth={period.month} months={model.yearMonths} />

      <section aria-label="Wynik wybranego miesiąca" className="overflow-hidden rounded-2xl border border-[var(--wd-border)] bg-white">
        <div className="grid gap-7 p-5 sm:p-7 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${selected.complete ? 'border-[var(--wd-border)] bg-[var(--wd-surface-2)]' : styles.warningBadge}`}>{periodStatus}</span>
            <h2 className="mt-5 text-sm font-semibold text-[var(--wd-text-muted)]">Różnica po znanych kosztach netto</h2>
            {selected.revenue === null ? <p className="my-4 text-2xl font-bold">Brak danych przychodowych</p> : selected.net.resultNet === null ? <p className="my-4 text-2xl font-bold">Brak pełnego netto</p> : (
              <p className={`num my-3 break-words text-3xl font-semibold tracking-tight sm:text-5xl ${resultColor(selected.net.resultNet)}`}>{money(selected.net.resultNet)}</p>
            )}
            <p className="text-xs leading-relaxed text-[var(--wd-text-muted)]">Brutto: <span className="num">{money(selected.result)}</span>. Zapisane przychody minus rozpoznane koszty. To nie jest zysk księgowy.</p>
            <p className={`mt-2 text-xs ${styles.warning}`}>{employeeCostReadiness().label}</p>
            {!selected.complete && <p className={`mt-2 text-xs font-medium ${styles.warning}`}>Wynik wymaga uzupełnienia lub potwierdzenia aktualności danych.</p>}
          </div>
          <div className="flex flex-col justify-center">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--wd-border)] py-4">
              <Link href={revenueHref} className="inline-flex items-center gap-1 text-sm font-semibold">Przychody netto <ArrowUpRight size={15} /></Link>
              <span className="text-right"><strong className="num text-xl">{selected.revenue === null ? money(null) : selected.net.revenueNetComplete ? money(selected.net.revenueNet) : 'Brak pełnego netto'}</strong><span className="mt-1 block text-xs text-[var(--wd-text-muted)]">Brutto {money(selected.revenue)}</span></span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--wd-border)] py-4">
              <Link href={costsHref} className="inline-flex items-center gap-1 text-sm font-semibold">Koszty netto dokumentów <ArrowUpRight size={15} /></Link>
              <span className="text-right"><strong className="num text-xl">{selected.net.costsNetComplete ? money(selected.net.costsNet) : 'Brak pełnego netto'}</strong><span className="mt-1 block text-xs text-[var(--wd-text-muted)]">Brutto {money(selected.costs)}</span></span>
            </div>
            {!selected.net.costsNetComplete && selected.net.knownDocumentNet !== null && <p className={`mt-2 text-xs ${styles.warning}`}>Znane netto dokumentów: {money(selected.net.knownDocumentNet)}. Bez kwoty netto: {selected.net.missingNetDocumentCount}. Ta suma nie jest kosztem miesiąca.</p>}
            {selected.net.foreignDocumentCount > 0 && <p className={`mt-2 text-xs ${styles.warning}`}>Dokumenty bez przeliczenia na PLN: {selected.net.foreignDocumentCount}. Nie wchodzą do netto.</p>}
            {selected.net.legacyCostUncertain && <p className={`mt-2 text-xs ${styles.warning}`}>Koszty tego miesiąca pochodzą ze starszych wpisów bez kwoty netto.</p>}
            {selected.net.payrollDocumentsIncluded && <p className={`mt-2 text-xs ${styles.warning}`}>Faktury oznaczone jako wynagrodzenia są w kosztach dokumentów. To nie jest rozliczenie płacowe.</p>}
            <p className={`mt-2 text-xs ${selected.costsConfirmed ? 'text-[var(--wd-text-muted)]' : styles.warning}`}>
              {selected.costsConfirmed ? 'Koszty potwierdzone: okres zamknięty, brak oczekujących dokumentów kosztowych.'
                : selected.pendingDocumentCount > 0 ? `Koszty niepotwierdzone: dokumenty oczekujące na decyzję — ${selected.pendingDocumentCount}.${!selected.periodClosed ? ' Okres nie został zamknięty.' : ''}`
                  : 'Koszty niepotwierdzone: okres nie został zamknięty.'}
            </p>
            {!selected.hasCosts && !selected.costsConfirmed && <p className={`mt-2 text-xs ${styles.warning}`}>Brak zapisanych kosztów dla tego miesiąca. Zero nie potwierdza zamknięcia kosztów.</p>}
            <p className="mt-4 text-xs leading-relaxed text-[var(--wd-text-muted)]">{model.yoyNet ? `Rok do roku netto (${period.year - 1}): przychody ${signedMoney(model.yoyNet.revenueDelta)}, różnica ${signedMoney(model.yoyNet.resultDelta)}. Porównanie pełnych miesięcy, bez kosztów pracowniczych.` : `Rok do roku netto: ${model.yoyReason}`}</p>
            {yoy && <p className="mt-1 text-xs text-[var(--wd-text-muted)]">Brutto rok do roku: przychody {signedMoney(yoy.revenueDelta)}, różnica {signedMoney(yoy.resultDelta)}.</p>}
          </div>
        </div>
        <div className="border-t border-[var(--wd-border)] bg-[var(--wd-surface-2)] px-5 py-4 sm:px-7">
          <p className="mb-3 text-xs font-semibold">Aktualność przychodów · każdy kanał osobno, kwoty brutto</p>
          <p className="mb-3 text-xs text-[var(--wd-text-muted)]">Netto jest zapisane łącznie dla salonu. Kanały mogą mieć różne stawki VAT, więc nie wyliczamy ich z brutto.</p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {selected.channels.map((channel) => <li key={`${channel.costCenterId}-${channel.channel}`} className="text-xs">
              <p className="font-semibold">{CENTER_NAMES[channel.costCenterId] ?? channel.costCenterId} · {channel.label}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[var(--wd-text-muted)]"><span className="num">{money(channel.amount)}</span><span>{channel.status === 'missing' ? 'Brak wpisu' : channel.status === 'unknown' ? 'Data aktualności nieznana' : `Stan na ${channel.asOfDate}${channel.status === 'partial' ? ' · część miesiąca' : ''}`}</span></p>
            </li>)}
          </ul>
        </div>
        {selected.net.gaps.map((gap) => <div key={gap.costCenterId} className="border-t border-[var(--wd-border)] px-5 py-4 sm:px-7"><NetRevenueForm year={period.year} month={period.month} gap={gap} /></div>)}
      </section>

      <section aria-label="Sprawy do zajęcia się" className="grid gap-3 sm:grid-cols-2">
        <Link href="/finance/ksef" className="flex items-center gap-4 rounded-xl border border-[var(--wd-border)] bg-white p-5 hover:bg-[var(--wd-surface-2)]">
          <span className="num text-2xl font-semibold">{waiting.count}</span>
          <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Faktury KSeF poza wynikiem</h2><p className="mt-1 text-xs text-[var(--wd-text-muted)]">{periodTitle} · {money(waiting.plnAmount)} oczekuje na decyzję</p>{waiting.unconverted.map((item) => <p key={item.currency} className="mt-1 text-xs text-amber-800">{item.amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {item.currency} · bez przeliczenia</p>)}</div><ArrowUpRight size={18} />
        </Link>
        <Link href="/cashier" className="flex items-center gap-4 rounded-xl border border-[var(--wd-border)] bg-white p-5 hover:bg-[var(--wd-surface-2)]"><div className="flex-1"><h2 className="text-sm font-semibold">Kasa salonu i depozyty</h2><p className="mt-1 text-xs text-[var(--wd-text-muted)]">Rozliczenia dni, odbiór i przeliczenie gotówki</p></div><ArrowUpRight size={18} /></Link>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--wd-border)] bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4"><h2 className="font-bold">Wynik według salonów</h2><span className="text-xs text-[var(--wd-text-muted)]">{periodTitle}</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[570px] text-sm">
          <thead className="border-y border-[var(--wd-border)] bg-[var(--wd-surface-2)]"><tr>{['Salon / centrum', 'Przychody netto', 'Koszty netto', 'Różnica'].map((label, index) => <th key={label} className={`px-5 py-3 text-xs font-semibold ${index ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
          <tbody>{model.byCenter.map((row) => <tr key={row.costCenterId} className="border-b border-[var(--wd-border)] last:border-0"><th scope="row" className="px-5 py-4 text-left font-semibold">{CENTER_NAMES[row.costCenterId]}</th><td className="num px-5 py-4 text-right">{revenueText(row.net)}<span className="mt-1 block text-[10px] font-normal text-[var(--wd-text-muted)]">Brutto {money(row.revenue)}</span></td><td className="num px-5 py-4 text-right">{costText(row.net)}<span className="mt-1 block text-[10px] font-normal text-[var(--wd-text-muted)]">Brutto {money(row.costs)}</span></td><td className={`num px-5 py-4 text-right font-semibold ${resultColor(row.net.resultNet)}`}>{row.net.resultNet === null ? (row.net.revenueStatus === 'none' && row.net.costsStatus === 'none' ? '—' : 'Dane niepełne') : money(row.net.resultNet)}</td></tr>)}</tbody>
        </table></div>
        <p className="border-t border-[var(--wd-border)] px-5 py-3 text-xs text-[var(--wd-text-muted)]">Koszty według zapisanych alokacji. GLOBAL pozostaje osobno; nie doliczamy go ponownie do salonów.</p>
      </section>

      <section aria-label="Sumy narastające" className="rounded-2xl border border-[var(--wd-border)] bg-white p-5">
        <div className="flex flex-wrap justify-between gap-4"><div><h2 className="font-bold">Narastająco: styczeń–{MONTHS[period.month - 1].toLowerCase()} · {period.year}</h2><p className="mt-1 text-xs text-[var(--wd-text-muted)]">{model.ytdNet.complete ? 'Policzona różnica netto od stycznia do wybranego miesiąca. Bez kosztów pracowniczych.' : 'Suma niepełna. Miesiące bez policzonej różnicy netto nie zostały doliczone jako zero.'}</p></div><p className={`num text-xl font-semibold ${resultColor(model.ytdNet.result)}`}>{model.ytdNet.result === null ? 'Brak policzonej różnicy netto' : money(model.ytdNet.result)}</p></div>
        <p className="mt-3 text-xs text-[var(--wd-text-muted)]">Przychody netto {money(model.ytdNet.revenue)} · koszty netto {money(model.ytdNet.costs)}</p>
        <p className="mt-1 text-xs text-[var(--wd-text-muted)]">Brutto: różnica {money(ytd.result)} · przychody {money(ytd.revenue)} · koszty {money(ytd.costs)}.{ytd.complete ? ' Pełne zapisane miesiące brutto.' : ' Suma brutto obejmuje dostępne kwoty i pozostaje orientacyjna.'}</p>
        <details className="mt-4 border-t border-[var(--wd-border)] pt-3"><summary className="cursor-pointer text-xs font-semibold">Rozwiń miesiące i kompletność</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-xs"><thead><tr><th className="p-2 text-left">Miesiąc</th><th className="p-2 text-right">Przychody netto</th><th className="p-2 text-right">Koszty netto</th><th className="p-2 text-right">Różnica netto</th><th className="p-2 text-left">Dane</th></tr></thead><tbody>{model.yearMonths.map((row) => <tr key={row.month} className="border-t border-[var(--wd-border)]"><th className="p-2 text-left font-medium">{MONTHS[row.month - 1]}</th><td className="num p-2 text-right">{row.net.revenueNetComplete ? money(row.net.revenueNet) : '—'}</td><td className="num p-2 text-right">{row.net.costsNetComplete ? money(row.net.costsNet) : '—'}</td><td className="num p-2 text-right">{money(row.net.chartValue)}</td><td className="p-2">{chartCaption(row)}{row.net.legacyCostUncertain ? ' · koszty bez netto' : ''}</td></tr>)}</tbody></table></div></details>
      </section>

      <section aria-label="Bieżący stan rachunków">
        <h2 className="text-lg font-bold">Bieżące środki firmy</h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--wd-text-muted)]">Bieżący stan zarejestrowanych rachunków — nie jest wynikiem wybranego miesiąca. Depozyty salonów są już częścią gotówki firmy; nie dodajemy ich drugi raz.</p>
        <CashFlowRow {...cashProps} initialAccounts={cashAccounts} />
      </section>
      {cashProps.isAdmin && <AlertsWidget budgetAlerts={budgetAlerts} paymentAlerts={paymentAlerts} isAdmin />}
      <Link href="/finance/break-even" className="inline-flex items-center gap-2 text-xs font-semibold">Analiza kosztów i próg rentowności <ArrowRight size={15} /></Link>
    </div>
  )
}
