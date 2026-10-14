'use client'

import { useState } from 'react'
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

// Plain "4523,69" for a single currency (ready to paste into a bank form); full text when mixed.
function copyableTotal(invoices: SelectableKsefInvoice[]) {
  const totals = selectedInvoiceTotals(invoices)
  if (totals.length === 1) return totals[0].amount.toFixed(2).replace('.', ',')
  return formatTotals(invoices)
}

function CopyButton({ text, label, children, className }: { text: string; label: string; children: React.ReactNode; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('error')
    }
    setTimeout(() => setState('idle'), 1500)
  }
  return (
    <button type="button" onClick={() => void copy()} disabled={!text} aria-label={label} title={label} className={className}>
      {state === 'copied' ? 'Skopiowano ✓' : state === 'error' ? 'Nie udało się skopiować' : children}
    </button>
  )
}

const TRANSFER_TITLE_LIMIT = 140

// Keyed by the joined numbers in the parent, so changing the selection resets manual edits.
function InvoiceNumbersField({ initial }: { initial: string }) {
  const [text, setText] = useState(initial)
  const over = text.length > TRANSFER_TITLE_LIMIT
  return (
    <div className="min-w-[16rem] flex-1">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <label htmlFor="ksef-transfer-title" className="font-medium">Tytuł przelewu</label>
        <span className={`num ${over ? 'font-semibold text-red-600' : 'text-[var(--wd-text-muted)]'}`} aria-live="polite">{text.length} / {TRANSFER_TITLE_LIMIT} znaków{over ? ` (za dużo o ${text.length - TRANSFER_TITLE_LIMIT})` : ''}</span>
      </div>
      <div className="flex gap-2">
        <input id="ksef-transfer-title" type="text" value={text} onChange={(event) => setText(event.target.value)} aria-invalid={over} className={`num min-w-0 flex-1 rounded border bg-white px-2 py-2 text-sm ${over ? 'border-red-500 bg-red-50' : 'border-[var(--wd-border)]'}`} />
        <CopyButton text={text} label="Kopiuj numery faktur" className="whitespace-nowrap rounded border border-[var(--wd-border)] px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-40">Kopiuj</CopyButton>
      </div>
    </div>
  )
}

export function KsefSelectionBar({ invoices, paidDate, busy, disabled, onDateChange, onClear, onPay }: Props) {
  const unpaid = invoices.filter((invoice) => invoice.paymentStatus !== 'PAID')
  const numbers = invoices.map((invoice) => invoice.invoiceNumber).join(', ')
  return (
    <section aria-label="Zaznaczone faktury" className="sticky top-0 z-20 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-[var(--wd-border)] bg-[var(--wd-surface,#faf9f6)] px-4 py-3 shadow-sm">
      <div aria-live="polite" className="text-sm">
        <p className="font-semibold">Zaznaczono: {invoices.length} <span className="font-normal text-[var(--wd-text-muted)]">· bieżąca strona</span></p>
        <p>Suma brutto:{' '}
          <CopyButton text={invoices.length ? copyableTotal(invoices) : ''} label="Kopiuj sumę brutto" className="num cursor-pointer rounded font-bold underline decoration-dotted underline-offset-2 hover:bg-black/5 disabled:cursor-default disabled:no-underline">
            {formatTotals(invoices)}
          </CopyButton>
        </p>
        {invoices.length > 0 && (
          <p className="text-xs text-[var(--wd-text-muted)]">Do oznaczenia: {unpaid.length} · {formatTotals(unpaid)}{unpaid.length < invoices.length ? ` · już zapłacone: ${invoices.length - unpaid.length}` : ''}</p>
        )}
      </div>
      {invoices.length > 0 && <InvoiceNumbersField key={numbers} initial={numbers} />}
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
