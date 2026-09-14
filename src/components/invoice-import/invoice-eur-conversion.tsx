'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createInvoiceImportClient } from '@/lib/invoice-import/client'
import { convertEurAmounts, parseCanonicalRate, type InvoiceEurConversion, type NbpEurQuote } from '@/lib/invoice-import/eur-conversion'
import { invoiceEurConversionIssue, invoiceReviewMoneyValue, type InvoiceReviewFormValues } from '@/lib/invoice-import/review-form'

const browserClient = createInvoiceImportClient()
export type InvoiceEurRateRequest = (paymentDate: string, signal?: AbortSignal) => Promise<NbpEurQuote>
interface Props {
  form: UseFormReturn<InvoiceReviewFormValues>
  disabled: boolean
  scopeKey: string
  onBasisChange(): void
  messageFor(field: keyof InvoiceReviewFormValues): string | undefined
  eurRate?: InvoiceEurRateRequest
  children: ReactNode
}
const inputClass = 'border-[var(--wd-border)] bg-[var(--wd-surface-2)] text-[var(--wd-dark)] tabular-nums focus-visible:ring-[var(--wd-dark)]/20'
const REPORTING = ['reportingGross', 'reportingNet', 'reportingVat'] as const
const LABELS = { reportingGross: 'Brutto w PLN', reportingNet: 'Netto w PLN', reportingVat: 'VAT w PLN' }

function paymentDate(value: string): string | null | undefined {
  return value === '' ? null : z.iso.date().safeParse(value).success ? value : undefined
}
function nbpDateProblem(value: string): string | null {
  if (!value) return 'Wybierz datę zapłaty, aby pobrać kurs z ostatniego dnia roboczego przed płatnością. Możesz też przeliczyć ręcznie.'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (!z.iso.date().safeParse(value).success || value <= '2002-01-01' || value > today) {
    return 'Wpisz poprawną datę zapłaty, nie późniejszą niż dziś, lub wybierz przeliczenie ręczne.'
  }
  return null
}
function basisNote(values: InvoiceReviewFormValues, conversion: InvoiceEurConversion | null): string {
  const date = values.paidAt ? `Data zapłaty: ${values.paidAt}.` : 'Data zapłaty nieznana.'
  if (conversion?.mode === 'NBP') return `NBP, tabela ${conversion.tableNumber} z ${conversion.rateDate}; 1 EUR = ${conversion.rate} PLN. ${date}`
  if (values.conversionMode === 'MANUAL_AMOUNT') return `Kwota PLN ustalona ręcznie. ${date}`
  if (conversion?.mode === 'MANUAL_RATE' && conversion.rate != null) return `Kurs ręczny: 1 EUR = ${conversion.rate} PLN. ${date}`
  return 'Kurs ręczny — uzupełnij poprawny kurs przed potwierdzeniem.'
}
function initiallyOwnedNote(values: InvoiceReviewFormValues): string | null {
  const generated = basisNote(values, values.conversion)
  return values.conversionNote === generated || values.conversionNote.startsWith(`${generated}\nPoprzednia uwaga`)
    ? values.conversionNote : null
}

/** EUR source, rate and PLN are one ledger row. Raw input stays in the form;
 * only validated metadata is persisted. Request generations fence late quotes. */
export function InvoiceEurConversion({ form, disabled, scopeKey, onBasisChange, messageFor, eurRate = browserClient.eurRate, children }: Props) {
  const values = useWatch({ control: form.control }) as InvoiceReviewFormValues
  const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'ERROR'>('IDLE')
  const [retry, setRetry] = useState(0)
  const requestRef = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 })
  const ownedNoteRef = useRef<string | null>(initiallyOwnedNote(form.getValues()))
  const sourceKey = JSON.stringify([values.gross, values.net, values.vat, values.paidAt])
  const previousSource = useRef(sourceKey)

  const cancelPending = useCallback(() => {
    requestRef.current.generation += 1
    requestRef.current.controller?.abort()
  }, [])

  const synchronize = useCallback((conversion: InvoiceEurConversion | null, rewriteNote = true) => {
    const current = form.getValues()
    if (JSON.stringify(current.conversion) !== JSON.stringify(conversion)) {
      form.setValue('conversion', conversion, { shouldDirty: true })
      onBasisChange()
    }
    // Incomplete rate modes must never round-trip as legacy manual PLN values.
    // Manual-amount mode (including legacy values) remains entirely untouched.
    if (current.conversionMode !== 'MANUAL_AMOUNT' && (!conversion || conversion.rate == null)) {
      for (const name of REPORTING) {
        if (form.getValues(name) !== '') { form.setValue(name, '', { shouldDirty: true }); onBasisChange() }
      }
    }
    if (conversion && conversion.mode !== 'MANUAL_AMOUNT' && conversion.rate != null) {
      try {
        const gross = invoiceReviewMoneyValue(current.gross)
        if (gross != null) {
          const converted = convertEurAmounts({ gross, net: invoiceReviewMoneyValue(current.net), vat: invoiceReviewMoneyValue(current.vat) }, conversion.rate)
          for (const name of REPORTING) {
            const text = converted[name] == null ? '' : String(converted[name])
            if (form.getValues(name) !== text) { form.setValue(name, text, { shouldDirty: true }); onBasisChange() }
          }
        }
      } catch { /* Partial amount edits remain visible and cannot be confirmed. */ }
    }
    if (!rewriteNote) return
    const note = form.getValues('conversionNote')
    const generated = basisNote(form.getValues(), conversion)
    const preserved = note.includes('\nPoprzednia uwaga') ? note.slice(note.indexOf('\nPoprzednia uwaga')) : ''
    if (!note || note === ownedNoteRef.current) {
      const nextNote = `${generated}${preserved}`
      form.setValue('conversionNote', nextNote, { shouldDirty: true })
      ownedNoteRef.current = nextNote
    } else if (current.conversionMode !== 'NBP' && /\bNBP\b/iu.test(note) && !preserved) {
      const nextNote = `${generated}\nPoprzednia uwaga (nie określa bieżącego przeliczenia): ${note}`
      form.setValue('conversionNote', nextNote, { shouldDirty: true })
      ownedNoteRef.current = nextNote
    }
  }, [form, onBasisChange])

  const manualConversion = useCallback((): InvoiceEurConversion | null => {
    const current = form.getValues()
    const date = paymentDate(current.paidAt)
    if (date === undefined) return null
    if (current.conversionMode === 'MANUAL_AMOUNT') return { mode: 'MANUAL_AMOUNT', paymentDate: date, rate: null, rateDate: null, tableNumber: null }
    try {
      return { mode: 'MANUAL_RATE', paymentDate: date, rate: parseCanonicalRate(current.conversionRate.replace(',', '.')), rateDate: null, tableNumber: null }
    } catch { return { mode: 'MANUAL_RATE', paymentDate: date, rate: null, rateDate: null, tableNumber: null } }
  }, [form])

  useEffect(() => {
    if (sourceKey === previousSource.current) return
    previousSource.current = sourceKey
    if (disabled) return
    onBasisChange()
    const current = form.getValues()
    if (current.conversionMode !== 'NBP') {
      synchronize(manualConversion())
    } else if (current.conversion?.mode === 'NBP' && current.conversion.paymentDate === current.paidAt) {
      synchronize(current.conversion)
    } else {
      synchronize(null, false)
    }
  }, [sourceKey, disabled, form, manualConversion, onBasisChange, synchronize])

  useEffect(() => {
    if (disabled || values.conversionMode !== 'NBP' || nbpDateProblem(values.paidAt)) return
    const current = form.getValues()
    if (current.conversion?.mode === 'NBP' && current.conversion.paymentDate === values.paidAt) return
    cancelPending()
    const controller = new AbortController()
    requestRef.current.controller = controller
    const generation = requestRef.current.generation
    const requestedDate = values.paidAt
    // Start on the next microtask so a reset/unmount can cancel before transport.
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return null
      setStatus('LOADING')
      return eurRate(requestedDate, controller.signal)
    }).then((quote) => {
      if (!quote) return
      const latest = form.getValues()
      if (controller.signal.aborted || requestRef.current.generation !== generation
        || latest.conversionMode !== 'NBP' || latest.paidAt !== requestedDate) return
      form.setValue('conversionRate', quote.rate, { shouldDirty: true })
      synchronize({ mode: 'NBP', paymentDate: quote.paymentDate, rate: quote.rate, rateDate: quote.rateDate, tableNumber: quote.tableNumber })
      setStatus('IDLE')
    }, () => {
      if (!controller.signal.aborted && requestRef.current.generation === generation) setStatus('ERROR')
    })
    return () => controller.abort()
  }, [cancelPending, disabled, eurRate, form, retry, scopeKey, synchronize, values.conversionMode, values.paidAt])

  useEffect(() => () => cancelPending(), [cancelPending, scopeKey])

  function selectMode(mode: InvoiceReviewFormValues['conversionMode']) {
    if (disabled) return
    cancelPending()
    setStatus('IDLE')
    form.setValue('conversionMode', mode, { shouldDirty: true })
    onBasisChange()
    if (mode === 'NBP') {
      form.setValue('conversionRate', '', { shouldDirty: true })
      synchronize(null, false)
      setRetry((value) => value + 1)
    } else {
      if (mode === 'MANUAL_AMOUNT') form.setValue('conversionRate', '', { shouldDirty: true })
      synchronize(manualConversion())
    }
  }
  function editRate(value: string) {
    if (disabled) return
    cancelPending()
    form.setValue('conversionRate', value, { shouldDirty: true })
    form.setValue('conversionMode', 'MANUAL_RATE', { shouldDirty: true })
    onBasisChange()
    synchronize(manualConversion())
  }
  function editReporting(name: typeof REPORTING[number], value: string) {
    selectMode('MANUAL_AMOUNT')
    form.setValue(name, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
  }
  const issue = invoiceEurConversionIssue(values)
  const dateProblem = values.conversionMode === 'NBP' ? nbpDateProblem(values.paidAt) : null
  const fieldMessage = (name: keyof InvoiceReviewFormValues) => messageFor(name)
    ?? (issue?.field === name && !(name === 'conversionRate' && values.conversionMode === 'NBP') ? issue.message : undefined)
  function amount(name: typeof REPORTING[number]) {
    const id = `invoice-${name}`
    const message = fieldMessage(name)
    return <div key={name} className="space-y-2">
      <Label htmlFor={id} className="text-xs text-[var(--wd-text-muted)]">{LABELS[name]}</Label>
      <Input id={id} value={values[name]} onChange={(event) => editReporting(name, event.target.value)} disabled={disabled} inputMode="decimal"
        className={`${inputClass} ${name === 'reportingGross' ? 'font-semibold' : ''}`} aria-invalid={Boolean(message)} aria-describedby={message ? `${id}-message` : undefined} />
      {message && <p id={`${id}-message`} className="text-xs text-red-700">{message}</p>}
    </div>
  }

  return <section aria-labelledby="invoice-eur-title" className="rounded-md border border-[var(--wd-border)] bg-[var(--wd-off-white)] p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--wd-border)] pb-3">
      <h3 id="invoice-eur-title" className="font-semibold">Płatność EUR · koszt w PLN</h3>
      <span className="text-xs text-[var(--wd-text-muted)]">{values.conversionMode === 'NBP' ? 'Średni kurs NBP · tabela A' : 'Przeliczenie ręczne'}</span>
    </div>
    <div role="group" aria-label="Sposób przeliczenia" className="mt-4 flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={disabled} aria-pressed={values.conversionMode === 'NBP'} onClick={() => selectMode('NBP')}>{values.conversionMode === 'NBP' ? 'Kurs NBP' : 'Wróć do kursu NBP'}</Button>
      <Button type="button" size="sm" variant="outline" disabled={disabled} aria-pressed={values.conversionMode === 'MANUAL_RATE'} onClick={() => selectMode('MANUAL_RATE')}>Wpisz kurs ręcznie</Button>
      <Button type="button" size="sm" variant="outline" disabled={disabled} aria-pressed={values.conversionMode === 'MANUAL_AMOUNT'} onClick={() => selectMode('MANUAL_AMOUNT')}>Kwota PLN ręcznie</Button>
    </div>
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="space-y-2">
        <Label htmlFor="invoice-gross" className="text-xs text-[var(--wd-text-muted)]">Kwota do zapłaty (EUR)</Label>
        <Input id="invoice-gross" value={values.gross} onChange={(event) => { form.setValue('gross', event.target.value, { shouldDirty: true }); onBasisChange() }}
          disabled={disabled} inputMode="decimal" className={`${inputClass} font-semibold`} aria-invalid={Boolean(fieldMessage('gross'))} aria-describedby={fieldMessage('gross') ? 'invoice-gross-message' : undefined} />
        {fieldMessage('gross') && <p id="invoice-gross-message" className="text-xs text-red-700">{fieldMessage('gross')}</p>}
      </div>
      {values.conversionMode !== 'MANUAL_AMOUNT' ? <div className="space-y-2">
        <Label htmlFor="invoice-conversion-rate" className="text-xs text-[var(--wd-text-muted)]">1 EUR = … PLN</Label>
        <Input id="invoice-conversion-rate" value={values.conversionRate} onChange={(event) => editRate(event.target.value)} disabled={disabled}
          readOnly={values.conversionMode === 'NBP'} inputMode="decimal" placeholder="np. 4,25" className={inputClass}
          aria-invalid={Boolean(fieldMessage('conversionRate'))} aria-describedby={fieldMessage('conversionRate') ? 'invoice-rate-message' : undefined} />
        {fieldMessage('conversionRate') && <p id="invoice-rate-message" className="text-xs text-red-700">{fieldMessage('conversionRate')}</p>}
      </div> : <p className="self-center text-xs leading-5 text-[var(--wd-text-muted)]">Kwota PLN wpisana przez Ciebie. Zmiana EUR nie nadpisze tej wartości.</p>}
      {amount('reportingGross')}
    </div>
    <div aria-live="polite" className="mt-3 text-xs leading-5 text-[var(--wd-text-muted)]">
      {values.conversionMode === 'NBP' && (dateProblem ? <p>{dateProblem}</p>
        : status === 'LOADING' ? <p>Pobieram kurs NBP dla daty zapłaty…</p>
          : status === 'ERROR' ? <div><p role="alert">Nie udało się pobrać kursu NBP. Spróbuj ponownie lub wpisz kurs ręcznie.</p>
            <Button type="button" size="sm" variant="outline" className="mt-2" disabled={disabled} onClick={() => { synchronize(null, false); setRetry((value) => value + 1) }}>Ponów pobranie kursu</Button></div>
            : values.conversion?.mode === 'NBP' ? <p>Tabela {values.conversion.tableNumber} · kurs z {values.conversion.rateDate}, przed płatnością {values.conversion.paymentDate}.</p> : null)}
      {fieldMessage('conversion') && <p className="mt-1 text-amber-900">{fieldMessage('conversion')}</p>}
    </div>
    <div className="mt-4 grid grid-cols-1 gap-4 border-t border-[var(--wd-border)] pt-4 sm:grid-cols-2">{amount('reportingNet')}{amount('reportingVat')}</div>
    <p className="mt-2 text-xs leading-5 text-[var(--wd-text-muted)]">Netto i VAT pozostają puste, jeśli dokument nie podaje tych wartości. Zmiana kwoty PLN włącza przeliczenie ręczne.</p>
    {children}
  </section>
}
