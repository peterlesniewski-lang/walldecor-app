import Link from 'next/link'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, CircleDollarSign, FileCheck2, ReceiptText, Target } from 'lucide-react'
import type { CompanyHealth, CostCenterHealth, FinanceCostCenterId, HealthStatus } from '@/lib/finance/company-health'

const COST_CENTER_LABELS: Record<FinanceCostCenterId | 'COMPANY', string> = {
  COMPANY: 'Firma',
  JAG: 'JAG',
  PUL: 'PUL',
  GLOBAL: 'GLOBAL',
}

const COST_CENTER_SUBTITLES: Record<FinanceCostCenterId | 'COMPANY', string> = {
  COMPANY: 'Całość biznesu',
  JAG: 'Salon Jagiellońska',
  PUL: 'Salon Puławska + eCommerce',
  GLOBAL: 'Koszty centralne',
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('pl-PL')} PLN`
}

function formatCompact(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} mln`
  if (abs >= 1_000) return `${Math.round(value / 1_000)} k`
  return Math.round(value).toLocaleString('pl-PL')
}

function statusLabel(status: HealthStatus) {
  if (status === 'above') return 'Nad progiem'
  if (status === 'below') return 'Pod progiem'
  return 'Break-even'
}

function statusClass(status: HealthStatus) {
  if (status === 'above') return 'text-green-700 bg-green-50 border-green-100'
  if (status === 'below') return 'text-red-700 bg-red-50 border-red-100'
  return 'text-amber-700 bg-amber-50 border-amber-100'
}

function resultClass(value: number) {
  if (value > 0) return 'text-green-700'
  if (value < 0) return 'text-red-600'
  return 'text-gray-500'
}

function HealthCard({ item }: { item: CostCenterHealth }) {
  const cm = item.currentMonth
  const isCompany = item.costCenterId === 'COMPANY'

  return (
    <article
      className={`rounded-lg border bg-white p-4 ${isCompany ? 'border-[#D7C8B5]' : 'border-[var(--wd-border)]'}`}
      style={{ boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--wd-dark)' }}>
            {COST_CENTER_LABELS[item.costCenterId]}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
            {COST_CENTER_SUBTITLES[item.costCenterId]}
          </p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(cm.status)}`}>
          {statusLabel(cm.status)}
        </span>
      </div>

      <div className="mt-5">
        <p className="data-label">Wynik miesiąca</p>
        <div className={`num mt-1 text-2xl font-bold ${resultClass(cm.result)}`}>
          {cm.result > 0 ? '+' : ''}{formatCompact(cm.result)}
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>
          {cm.breakEvenDelta >= 0 ? 'Nadwyżka nad kosztami' : 'Brakuje do pokrycia kosztów'}: {' '}
          <span className={`font-semibold ${resultClass(cm.breakEvenDelta)}`}>
            {formatMoney(Math.abs(cm.breakEvenDelta))}
          </span>
        </p>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="data-label">Przychody</dt>
          <dd className="num mt-1 font-semibold" style={{ color: 'var(--wd-dark)' }}>{formatMoney(cm.revenue)}</dd>
        </div>
        <div>
          <dt className="data-label">Koszty</dt>
          <dd className="num mt-1 font-semibold" style={{ color: 'var(--wd-dark)' }}>{formatMoney(cm.expenses)}</dd>
        </div>
        <div>
          <dt className="data-label">Break-even</dt>
          <dd className="num mt-1 font-semibold" style={{ color: 'var(--wd-dark)' }}>{formatMoney(cm.breakEvenTarget)}</dd>
        </div>
        <div>
          <dt className="data-label">YTD</dt>
          <dd className={`num mt-1 font-semibold ${resultClass(item.ytd.result)}`}>
            {item.ytd.result > 0 ? '+' : ''}{formatCompact(item.ytd.result)}
          </dd>
        </div>
      </dl>
    </article>
  )
}

interface CompanyHealthViewProps {
  role?: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
  health: CompanyHealth
  cashByCurrency: Array<{ currency: string; amount: number }>
  ksefInboxCount?: number
  unpaidInvoiceAmount?: number
  unclassifiedWarningAmount?: number
}

export function CompanyHealthView({
  role = 'EMPLOYEE',
  health,
  cashByCurrency,
  ksefInboxCount = 0,
  unpaidInvoiceAmount = 0,
  unclassifiedWarningAmount = 0,
}: CompanyHealthViewProps) {
  const cards = [
    health.company,
    health.byCostCenter.JAG,
    health.byCostCenter.PUL,
    health.byCostCenter.GLOBAL,
  ]
  const cm = health.company.currentMonth
  const isAdmin = role === 'ADMIN'
  const canViewCostReports = isAdmin

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="data-label mb-1">Kondycja firmy</p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Wynik teraz
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--wd-text-muted)' }}>
            Break-even, koszty i przychody dla firmy oraz punktów na bazie realnych zdarzeń kosztowych.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/finance?year=${health.year - 1}`} className="rounded p-1.5 text-sm hover:bg-gray-100">‹</Link>
          <span className="px-2 text-sm font-semibold">{health.year}</span>
          <Link href={`/finance?year=${health.year + 1}`} className="rounded p-1.5 text-sm hover:bg-gray-100">›</Link>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <div className="flex items-center gap-2">
            <CircleDollarSign size={16} className="text-green-700" />
            <p className="data-label">Przychody miesiąca</p>
          </div>
          <p className="num mt-3 text-xl font-bold">{formatMoney(cm.revenue)}</p>
        </div>
        <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <div className="flex items-center gap-2">
            <ReceiptText size={16} className="text-amber-700" />
            <p className="data-label">Koszty wykonane</p>
          </div>
          <p className="num mt-3 text-xl font-bold">{formatMoney(cm.expenses)}</p>
        </div>
        <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-gray-700" />
            <p className="data-label">Do break-even</p>
          </div>
          <p className={`num mt-3 text-xl font-bold ${resultClass(cm.breakEvenDelta)}`}>
            {cm.breakEvenDelta >= 0 ? '0 PLN' : formatMoney(Math.abs(cm.breakEvenDelta))}
          </p>
        </div>
        {isAdmin && (
          <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
            <div className="flex items-center gap-2">
              <Banknote size={16} className="text-gray-700" />
              <p className="data-label">Kasa</p>
            </div>
            <div className="mt-3 space-y-1">
              {cashByCurrency.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak danych</p>
              ) : cashByCurrency.map((row) => (
                <p key={row.currency} className="num text-sm font-semibold">
                  {Math.round(row.amount).toLocaleString('pl-PL')} {row.currency}
                </p>
              ))}
            </div>
          </div>
        )}
        {isAdmin && (
          <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
            <div className="flex items-center gap-2">
              <FileCheck2 size={16} className="text-blue-700" />
              <p className="data-label">KSeF do obsługi</p>
            </div>
            <p className="num mt-3 text-xl font-bold">{ksefInboxCount.toLocaleString('pl-PL')}</p>
          </div>
        )}
        {isAdmin && (
          <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
            <div className="flex items-center gap-2">
              <Banknote size={16} className="text-gray-700" />
              <p className="data-label">Pozostało do zapłaty</p>
            </div>
            <p className="num mt-3 text-xl font-bold">{formatMoney(unpaidInvoiceAmount)}</p>
          </div>
        )}
        {canViewCostReports && (
          <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-700" />
              <p className="data-label">Koszty oczekujące</p>
            </div>
            <p className="num mt-3 text-xl font-bold">{formatMoney(unclassifiedWarningAmount)}</p>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((item) => <HealthCard key={item.costCenterId} item={item} />)}
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {isAdmin && (
          <Link href="/finance/actuals" className="rounded-lg border border-[var(--wd-border)] bg-white p-4 hover:border-[#D7C8B5]">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Koszty</p>
              <ArrowUpRight size={16} />
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>Wykonanie, różnice i źródła kosztów.</p>
          </Link>
        )}
        {canViewCostReports && (
          <Link href="/finance/cost-events" className="rounded-lg border border-[var(--wd-border)] bg-white p-4 hover:border-[#D7C8B5]">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Zdarzenia kosztowe</p>
              <ArrowUpRight size={16} />
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>Zatwierdzone koszty według tagów i alokacji.</p>
          </Link>
        )}
        {canViewCostReports && (
          <Link href="/finance/break-even" className="rounded-lg border border-[var(--wd-border)] bg-white p-4 hover:border-[#D7C8B5]">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Break-even</p>
              <ArrowUpRight size={16} />
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>Progi rentowności dla JAG i Puławskiej.</p>
          </Link>
        )}
        {isAdmin && (
          <Link href="/finance/ksef" className="rounded-lg border border-[var(--wd-border)] bg-white p-4 hover:border-[#D7C8B5]">
            <div className="flex items-center justify-between">
              <p className="font-semibold">KSeF Inbox</p>
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">{ksefInboxCount}</span>
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>Faktury do klasyfikacji i akceptacji.</p>
          </Link>
        )}
        {isAdmin && (
          <Link href="/dashboard" className="rounded-lg border border-[var(--wd-border)] bg-white p-4 hover:border-[#D7C8B5]">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Kasa i alerty</p>
              <ArrowDownRight size={16} />
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>Szczegóły cash flow w dashboardzie.</p>
          </Link>
        )}
      </section>
    </div>
  )
}
