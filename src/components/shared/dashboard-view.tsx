'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, ArrowRight, CalendarDays } from 'lucide-react'
import { CashFlowRow, type CashFlowRowProps } from '@/components/shared/cash-flow-row'
import { AlertsWidget, type AlertNotification, type PaymentReminderWithDays } from '@/components/alerts/alerts-widget'
import type { ActualDashboardModel, DashboardPeriod } from '@/lib/finance/actual-dashboard'
import styles from './dashboard-theme.module.css'

interface DashboardViewProps extends Omit<CashFlowRowProps, 'initialAccounts'> {
  model: ActualDashboardModel
  cashAccounts: CashFlowRowProps['initialAccounts']
  userName: string
  budgetAlerts?: AlertNotification[]
  paymentAlerts?: PaymentReminderWithDays[]
}

const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień']
const CENTER_NAMES: Record<string, string> = { PUL: 'Puławska', JAG: 'Jagiellońska', GLOBAL: 'GLOBAL · koszty wspólne' }
const money = (amount: number | null) => amount === null ? '—' : `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
const signedMoney = (amount: number) => `${amount > 0 ? '+' : ''}${money(amount)}`
function resultColor(result: number | null, complete: boolean) {
  if (result !== null && result < 0) return styles.negative
  return complete && result !== null && result > 0 ? styles.positive : 'text-[var(--wd-dark)]'
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
          <p className="mt-2 flex items-center gap-2 text-sm text-[var(--wd-text-muted)]"><CalendarDays size={15} />{periodTitle} · rzeczywiste kwoty brutto</p>
        </div>
        <PeriodSelector key={`${period.year}-${period.month}`} {...period} />
      </header>

      <section aria-label="Wynik wybranego miesiąca" className="overflow-hidden rounded-2xl border border-[var(--wd-border)] bg-white">
        <div className="grid gap-7 p-5 sm:p-7 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${selected.complete ? 'border-[var(--wd-border)] bg-[var(--wd-surface-2)]' : styles.warningBadge}`}>{periodStatus}</span>
            <h2 className="mt-5 text-sm font-semibold text-[var(--wd-text-muted)]">Wynik orientacyjny brutto</h2>
            {selected.result === null ? <p className="my-4 text-2xl font-bold">Brak danych przychodowych</p> : (
              <p className={`num my-3 break-words text-3xl font-semibold tracking-tight sm:text-5xl ${resultColor(selected.result, selected.complete)}`}>{money(selected.result)}</p>
            )}
            <p className="text-xs leading-relaxed text-[var(--wd-text-muted)]">Zapisane przychody po korektach minus rozpoznane koszty. To orientacyjna różnica kwot brutto, nie zysk księgowy.</p>
            {!selected.complete && <p className={`mt-2 text-xs font-medium ${styles.warning}`}>Wynik wymaga uzupełnienia lub potwierdzenia aktualności danych.</p>}
          </div>
          <div className="flex flex-col justify-center">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--wd-border)] py-4">
              <Link href={revenueHref} className="inline-flex items-center gap-1 text-sm font-semibold">Przychody brutto <ArrowUpRight size={15} /></Link>
              <strong className="num text-xl">{money(selected.revenue)}</strong>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--wd-border)] py-4">
              <Link href={costsHref} className="inline-flex items-center gap-1 text-sm font-semibold">Koszty rozpoznane <ArrowUpRight size={15} /></Link>
              <strong className="num text-xl">{money(selected.costs)}</strong>
            </div>
            <p className={`mt-2 text-xs ${selected.costsConfirmed ? 'text-[var(--wd-text-muted)]' : styles.warning}`}>
              {selected.costsConfirmed ? 'Koszty potwierdzone: okres zamknięty, brak oczekujących dokumentów kosztowych.'
                : selected.pendingDocumentCount > 0 ? `Koszty niepotwierdzone: dokumenty oczekujące na decyzję — ${selected.pendingDocumentCount}.${!selected.periodClosed ? ' Okres nie został zamknięty.' : ''}`
                  : 'Koszty niepotwierdzone: okres nie został zamknięty.'}
            </p>
            {!selected.hasCosts && !selected.costsConfirmed && <p className={`mt-2 text-xs ${styles.warning}`}>Brak zapisanych kosztów dla tego miesiąca. Zero nie potwierdza zamknięcia kosztów.</p>}
            <p className="mt-4 text-xs leading-relaxed text-[var(--wd-text-muted)]">{yoy ? `Rok do roku (${period.year - 1}): przychody ${signedMoney(yoy.revenueDelta)}, wynik ${signedMoney(yoy.resultDelta)}. Porównanie pełnych miesięcy.` : `Rok do roku: ${model.yoyReason}`}</p>
          </div>
        </div>
        <div className="border-t border-[var(--wd-border)] bg-[var(--wd-surface-2)] px-5 py-4 sm:px-7">
          <p className="mb-3 text-xs font-semibold">Aktualność przychodów · każdy kanał osobno</p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {selected.channels.map((channel) => <li key={`${channel.costCenterId}-${channel.channel}`} className="text-xs">
              <p className="font-semibold">{CENTER_NAMES[channel.costCenterId] ?? channel.costCenterId} · {channel.label}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[var(--wd-text-muted)]"><span className="num">{money(channel.amount)}</span><span>{channel.status === 'missing' ? 'Brak wpisu' : channel.status === 'unknown' ? 'Data aktualności nieznana' : `Stan na ${channel.asOfDate}${channel.status === 'partial' ? ' · część miesiąca' : ''}`}</span></p>
            </li>)}
          </ul>
        </div>
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
          <thead className="border-y border-[var(--wd-border)] bg-[var(--wd-surface-2)]"><tr>{['Salon / centrum', 'Przychody', 'Koszty', 'Wynik brutto'].map((label, index) => <th key={label} className={`px-5 py-3 text-xs font-semibold ${index ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
          <tbody>{model.byCenter.map((row) => <tr key={row.costCenterId} className="border-b border-[var(--wd-border)] last:border-0"><th scope="row" className="px-5 py-4 text-left font-semibold">{CENTER_NAMES[row.costCenterId]}</th><td className="num px-5 py-4 text-right">{money(row.revenue)}</td><td className="num px-5 py-4 text-right">{money(row.costs)}</td><td className={`num px-5 py-4 text-right font-semibold ${resultColor(row.result, row.complete)}`}>{money(row.result)}{!row.complete && row.costCenterId !== 'GLOBAL' && <span className="mt-1 block text-[10px] font-normal text-[var(--wd-text-muted)]">dane niepełne</span>}</td></tr>)}</tbody>
        </table></div>
        <p className="border-t border-[var(--wd-border)] px-5 py-3 text-xs text-[var(--wd-text-muted)]">Koszty według zapisanych alokacji. GLOBAL pozostaje osobno; nie doliczamy go ponownie do salonów.</p>
      </section>

      <section aria-label="Sumy narastające" className="rounded-2xl border border-[var(--wd-border)] bg-white p-5">
        <div className="flex flex-wrap justify-between gap-4"><div><h2 className="font-bold">Narastająco: styczeń–{MONTHS[period.month - 1].toLowerCase()} · {period.year}</h2><p className="mt-1 text-xs text-[var(--wd-text-muted)]">{ytd.complete ? 'Pełne zapisane miesiące' : 'Suma dostępnych danych; niepełne miesiące oznaczono poniżej.'}</p></div><p className={`num text-xl font-semibold ${resultColor(ytd.result, ytd.complete)}`}>{money(ytd.result)}</p></div>
        <p className="mt-3 text-xs text-[var(--wd-text-muted)]">Przychody {money(ytd.revenue)} · koszty {money(ytd.costs)}</p>
        <details className="mt-4 border-t border-[var(--wd-border)] pt-3"><summary className="cursor-pointer text-xs font-semibold">Rozwiń miesiące i kompletność</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[480px] text-xs"><thead><tr><th className="p-2 text-left">Miesiąc</th><th className="p-2 text-right">Przychody</th><th className="p-2 text-right">Koszty</th><th className="p-2 text-left">Dane</th></tr></thead><tbody>{model.months.map((row) => <tr key={row.month} className="border-t border-[var(--wd-border)]"><th className="p-2 text-left font-medium">{MONTHS[row.month - 1]}</th><td className="num p-2 text-right">{money(row.revenue)}</td><td className="num p-2 text-right">{money(row.costs)}</td><td className="p-2">{row.partialMonth ? 'W toku' : row.complete ? 'Pełne' : 'Niepełne'}</td></tr>)}</tbody></table></div></details>
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
