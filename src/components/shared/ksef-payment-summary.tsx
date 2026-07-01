interface AgingBucketSummary {
  count: number
  grossAmount: number
}

interface KsefPaymentSummaryProps {
  grossAmountTotal: number
  grossAmountLabel?: string
  unpaidAmountTotal: number
  paymentAging: Record<string, AgingBucketSummary>
  formatMoney: (value: number) => string
}

const LABELS: Record<string, string> = {
  OVERDUE: 'Po terminie',
  DUE_0_7: '0-7 dni',
  DUE_8_14: '8-14 dni',
  DUE_15_30: '15-30 dni',
}

export function KsefPaymentSummary({
  grossAmountTotal,
  grossAmountLabel = 'Suma faktur',
  unpaidAmountTotal,
  paymentAging,
  formatMoney,
}: KsefPaymentSummaryProps) {
  return (
    <div className="grid w-full gap-3 md:grid-cols-[1fr_1fr_2fr]">
      <div>
        <p className="data-label">{grossAmountLabel}</p>
        <p className="num text-sm font-semibold">{formatMoney(grossAmountTotal)}</p>
      </div>
      <div>
        <p className="data-label">Pozostało do zapłaty</p>
        <p className="num text-sm font-semibold">{formatMoney(unpaidAmountTotal)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Object.entries(LABELS).map(([bucket, label]) => (
          <div key={bucket} className="rounded border border-[var(--wd-border)] px-2 py-1">
            <p className="text-[11px] font-semibold" style={{ color: 'var(--wd-text-muted)' }}>{label}</p>
            <p className="num text-xs font-semibold">
              {paymentAging[bucket]?.count ?? 0} / {formatMoney(paymentAging[bucket]?.grossAmount ?? 0)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
