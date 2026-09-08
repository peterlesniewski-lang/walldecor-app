'use client'

import { selectedInvoiceTotals, type SelectableKsefInvoice } from '@/lib/finance/ksef-selection'

interface Props {
  invoices: SelectableKsefInvoice[]
  paidDate: string
  busy: boolean
  disabled: boolean
  onDateChange: (value: string) => void
  onClear: () => void
  onPay: () => void
}

function formatTotals(invoices: SelectableKsefInvoice[]) {
  return selectedInvoiceTotals(invoices).map(({ currency, amount }) =>
    `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} ${currency}`
  ).join(' · ') || '—'
}

export function KsefSelectionBar({ invoices, paidDate, busy, disabled, onDateChange, onClear, onPay }: Props) {
  const unpaid = invoices.filter((invoice) => invoice.paymentStatus !== 'PAID')
  return (
    <section aria-label="Zaznaczone faktury" className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--wd-border)] bg-[var(--wd-surface,#faf9f6)] px-4 py-3 shadow-sm">
      <div aria-live="polite" className="text-sm">
        <p className="font-semibold">Zaznaczono: {invoices.length} <span className="font-normal text-[var(--wd-text-muted)]">· bieżąca strona</span></p>
        <p>Suma brutto: <strong className="num">{formatTotals(invoices)}</strong></p>
        {invoices.length > 0 && (
          <p className="text-xs text-[var(--wd-text-muted)]">Do oznaczenia: {unpaid.length} · {formatTotals(unpaid)}{unpaid.length < invoices.length ? ` · już zapłacone: ${invoices.length - unpaid.length}` : ''}</p>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium">
          Data płatności
          <input type="date" aria-label="Data płatności grupowej" value={paidDate} onChange={(event) => onDateChange(event.target.value)} disabled={disabled} className="mt-1 block rounded border border-[var(--wd-border)] bg-white px-2 py-2 text-sm" />
        </label>
        <button type="button" onClick={onPay} disabled={disabled || unpaid.length === 0 || !paidDate} className="rounded bg-[var(--wd-dark)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? 'Zapisywanie płatności…' : `Oznacz jako zapłacone (${unpaid.length})`}
        </button>
        <button type="button" onClick={onClear} disabled={disabled || invoices.length === 0} className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm disabled:opacity-40">Odznacz</button>
      </div>
    </section>
  )
}
