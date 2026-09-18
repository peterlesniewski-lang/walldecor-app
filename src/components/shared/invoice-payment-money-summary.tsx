import type { InvoiceMoneySummary } from '@/lib/finance/invoice-money'

interface AgingBucketSummary extends InvoiceMoneySummary {
  count: number
  grossAmount?: number
}

interface InvoicePaymentMoneySummaryProps {
  gross: InvoiceMoneySummary
  grossLabel?: string
  unpaid: InvoiceMoneySummary
  unpaidCount: number | null
  uncertainPaymentCount: number
  paymentAging: Record<string, AgingBucketSummary>
  formatMoney: (value: number, currency?: string) => string
}

const LABELS: Record<string, string> = {
  OVERDUE: 'Po terminie',
  DUE_0_7: '0-7 dni',
  DUE_8_14: '8-14 dni',
  DUE_15_30: '15-30 dni',
  LATER: 'Później',
  MISSING_DUE_DATE: 'Brak terminu',
}

export function invoiceDocumentLabel(count: number) {
  if (count === 1) return 'dokument'
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo < 12 || lastTwo > 14) {
    if (last >= 2 && last <= 4) return 'dokumenty'
  }
  return 'dokumentów'
}

export function InvoiceMoneyUnconverted({
  summary,
  formatMoney,
}: {
  summary: InvoiceMoneySummary
  formatMoney: (value: number, currency?: string) => string
}) {
  if (summary.unconvertedCount === 0) return null

  return (
    <div className="mt-1 space-y-0.5 text-[11px] text-amber-700">
      <p className="font-semibold">
        Bez przeliczenia: {summary.unconvertedCount} {invoiceDocumentLabel(summary.unconvertedCount)}
      </p>
      {summary.unconvertedByCurrency.map((row) => (
        <p key={row.currency} className="num">
          {formatMoney(row.amount, row.currency)} · {row.count} {invoiceDocumentLabel(row.count)}
        </p>
      ))}
    </div>
  )
}

export function InvoicePaymentMoneySummary({
  gross,
  grossLabel = 'Suma faktur',
  unpaid,
  unpaidCount,
  uncertainPaymentCount,
  paymentAging,
  formatMoney,
}: InvoicePaymentMoneySummaryProps) {
  return (
    <div className="w-full space-y-2">
      <div className="grid w-full gap-3 md:grid-cols-[1fr_1fr_3fr]">
        <div>
          <p className="data-label">{grossLabel}</p>
          <p className="num text-sm font-semibold">{formatMoney(gross.plnAmount)}</p>
          <p className="text-[11px] text-[var(--wd-text-muted)]">Znana kwota w PLN</p>
          <InvoiceMoneyUnconverted summary={gross} formatMoney={formatMoney} />
        </div>
        <div>
          <p className="data-label">Niezapłacone dokumenty</p>
          <p className="num text-sm font-semibold">
            {unpaidCount == null ? formatMoney(unpaid.plnAmount) : `${unpaidCount} / ${formatMoney(unpaid.plnAmount)}`}
          </p>
          <p className="text-[11px] text-[var(--wd-text-muted)]">
            {unpaidCount == null ? 'Liczba dokumentów niedostępna · pełne kwoty dokumentów' : 'Pełne kwoty dokumentów'}
          </p>
          <InvoiceMoneyUnconverted summary={unpaid} formatMoney={formatMoney} />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
          {Object.entries(LABELS).map(([bucket, label]) => {
            const summary = paymentAging[bucket]
            return (
              <div key={bucket} className="rounded border border-[var(--wd-border)] px-2 py-1">
                <p className="text-[11px] font-semibold text-[var(--wd-text-muted)]">{label}</p>
                <p className="num text-xs font-semibold">
                  {summary?.count ?? 0} / {formatMoney(summary?.plnAmount ?? summary?.grossAmount ?? 0)}
                </p>
                {summary && <InvoiceMoneyUnconverted summary={summary} formatMoney={formatMoney} />}
              </div>
            )
          })}
        </div>
      </div>
      {uncertainPaymentCount > 0 && (
        <p className="text-xs font-semibold text-amber-700">
          {uncertainPaymentCount} {invoiceDocumentLabel(uncertainPaymentCount)} z niepewnym statusem płatności — pokazujemy pełne kwoty dokumentów, nie wyliczone saldo.
        </p>
      )}
    </div>
  )
}
