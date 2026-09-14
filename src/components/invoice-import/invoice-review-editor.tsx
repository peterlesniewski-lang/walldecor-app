'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Lightbulb, RotateCcw } from 'lucide-react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InvoiceEurConversion, type InvoiceEurRateRequest } from './invoice-eur-conversion'
import { TagChips, type TagChipsGroup } from '@/components/shared/tag-chips'
import { invoiceClassificationHint, type InvoiceClassificationRule } from '@/lib/invoice-import/classification-hint'
import type { InvoiceDraftData } from '@/lib/invoice-import/contracts'
import type { InvoiceDraftAction, InvoiceDraftDetail, InvoiceReviewIssue } from '@/lib/invoice-import/client-contracts'
import {
  invoiceDataToForm,
  invoiceFormPatch,
  invoiceEurConversionIssue,
  invoiceReviewFormSchema,
  type InvoiceReviewFormValues,
} from '@/lib/invoice-import/review-form'

export interface InvoiceReviewEditorProps {
  draft: InvoiceDraftDetail
  costCenters: { id: string; name: string }[]
  tagGroups: TagChipsGroup[]
  rules: InvoiceClassificationRule[]
  busy: boolean
  issues?: InvoiceReviewIssue[]
  approvalBlockReason?: string | null
  onSave(patch: InvoiceDraftData, expectedVersion: number): Promise<void>
  onApprove(patch: InvoiceDraftData, expectedVersion: number): Promise<void>
  onRevoke(expectedVersion: number): Promise<void>
  onAction(action: InvoiceDraftAction, expectedVersion: number): Promise<void>
  onDirtyChange?(dirty: boolean): void
  eurRate?: InvoiceEurRateRequest
}

interface FormBase {
  draftId: string
  version: number
  sourceKey: string
  values: InvoiceReviewFormValues
}

interface ChoiceOption {
  value: string
  label: string
}

type ConversionBasis = Pick<InvoiceReviewFormValues, 'gross' | 'net' | 'vat' | 'currency' | 'paidAt'
  | 'conversion' | 'conversionRate' | 'conversionMode' | 'reportingGross' | 'reportingNet' | 'reportingVat'>

interface RebaseNotice {
  basis: ConversionBasis
  requiresFxConfirmation: boolean
}

const EMPTY_CHOICE = '__invoice_empty_choice__'
const DOCUMENT_TYPES: ChoiceOption[] = [
  { value: '', label: 'Wybierz rodzaj' },
  { value: 'INVOICE', label: 'Faktura' },
  { value: 'CORRECTION', label: 'Faktura korygująca' },
  { value: 'CREDIT_NOTE', label: 'Nota uznaniowa' },
  { value: 'PROFORMA', label: 'Pro forma' },
  { value: 'OTHER', label: 'Inny dokument' },
]
const PAYMENT_STATUSES: ChoiceOption[] = [
  { value: '', label: 'Wybierz status' },
  { value: 'PAID', label: 'Zapłacona' },
  { value: 'UNPAID', label: 'Niezapłacona' },
  { value: 'PARTIAL', label: 'Częściowo zapłacona' },
  { value: 'UNKNOWN', label: 'Nie wiadomo' },
]
const inputClassName = 'border-[var(--wd-border)] bg-[var(--wd-surface-2)] text-[var(--wd-dark)] focus-visible:ring-[var(--wd-dark)]/20'
const textareaClassName = 'min-h-24 w-full resize-y rounded-md border border-[var(--wd-border)] bg-[var(--wd-surface-2)] px-3 py-2 text-sm text-[var(--wd-dark)] outline-none transition-colors placeholder:text-[var(--wd-text-muted)] focus:border-[var(--wd-dark)] focus:ring-2 focus:ring-[var(--wd-dark)]/20 disabled:cursor-not-allowed disabled:opacity-50'

function draftSourceKey(draft: InvoiceDraftDetail): string {
  return JSON.stringify([draft.id, draft.version, draft.state, draft.invoiceId, draft.data])
}

function baseFromDraft(draft: InvoiceDraftDetail): FormBase {
  return {
    draftId: draft.id,
    version: draft.version,
    sourceKey: draftSourceKey(draft),
    values: invoiceDataToForm(draft.data),
  }
}

function isCostCenter(value: string): value is InvoiceReviewFormValues['costCenterId'] {
  return value === '' || value === 'JAG' || value === 'PUL' || value === 'GLOBAL'
}

function polishValidationMessage(message: unknown): string | undefined {
  if (typeof message !== 'string') return undefined
  return /^(Wpisz|Wybierz|Sprawdź)/u.test(message) ? message : 'Sprawdź wartość tego pola.'
}

function ChoiceField({
  id,
  label,
  value,
  options,
  disabled,
  invalid,
  describedBy,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: ChoiceOption[]
  disabled: boolean
  invalid: boolean
  describedBy?: string
  onChange(value: string): void
}) {
  const selected = options.find((option) => option.value === value) ?? options[0]

  return (
    <DropdownMenu key={disabled ? 'disabled' : 'enabled'}>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          disabled={disabled}
          className="w-full justify-between border-[var(--wd-border)] bg-[var(--wd-surface-2)] px-3 font-normal text-[var(--wd-dark)] hover:bg-[var(--wd-sand-light)]"
        >
          <span className={value ? '' : 'text-[var(--wd-text-muted)]'}>{selected.label}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)] border-[var(--wd-border)] bg-white">
        <DropdownMenuRadioGroup
          value={value || EMPTY_CHOICE}
          onValueChange={(next) => {
            if (!disabled) onChange(next === EMPTY_CHOICE ? '' : next)
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value || EMPTY_CHOICE} value={option.value || EMPTY_CHOICE} disabled={disabled}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Field({
  id,
  label,
  message,
  children,
  className = '',
}: {
  id: string
  label: string
  message?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label htmlFor={id} className="text-sm font-medium text-[var(--wd-dark)]">{label}</Label>
      {children}
      {message && <p id={`${id}-message`} className="text-xs font-medium text-red-700">{message}</p>}
    </div>
  )
}

function dirtyValuesOnLatest(
  base: InvoiceReviewFormValues,
  current: InvoiceReviewFormValues,
  latest: InvoiceReviewFormValues,
): InvoiceReviewFormValues {
  const merged = { ...latest }
  for (const key of Object.keys(current) as Array<keyof InvoiceReviewFormValues>) {
    if (JSON.stringify(base[key]) !== JSON.stringify(current[key])) {
      Object.assign(merged, { [key]: current[key] })
    }
  }
  return merged
}

function conversionBasis(values: InvoiceReviewFormValues): ConversionBasis {
  return {
    gross: values.gross,
    net: values.net,
    vat: values.vat,
    currency: values.currency,
    paidAt: values.paidAt,
    conversion: values.conversion,
    conversionRate: values.conversionRate,
    conversionMode: values.conversionMode,
    reportingGross: values.reportingGross,
    reportingNet: values.reportingNet,
    reportingVat: values.reportingVat,
  }
}

function sameConversionBasis(left: ConversionBasis, right: ConversionBasis): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function shownBasisValue(value: string): string {
  return value.trim() || '—'
}

function isForeignCurrency(value: string): boolean {
  const normalized = value.trim().toUpperCase()
  return normalized !== '' && normalized !== 'PLN'
}

export function InvoiceReviewEditor({
  draft,
  costCenters,
  tagGroups,
  rules,
  busy,
  issues = [],
  approvalBlockReason = null,
  onSave,
  onApprove,
  onRevoke,
  onAction,
  onDirtyChange,
  eurRate,
}: InvoiceReviewEditorProps) {
  const [initialBase] = useState(() => baseFromDraft(draft)) // Parent keys the editor by draft id.
  const baseRef = useRef<FormBase>(initialBase)
  const explicitlyConfirmedConversionRef = useRef(false)
  const confirmedConversionBasisRef = useRef<ConversionBasis | null>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const [staleDraft, setStaleDraft] = useState<InvoiceDraftDetail | null>(null)
  const [rebaseNotice, setRebaseNotice] = useState<RebaseNotice | null>(null)
  const [localBusy, setLocalBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [formEpoch, setFormEpoch] = useState(0)
  const form = useForm<InvoiceReviewFormValues>({
    resolver: zodResolver(invoiceReviewFormSchema),
    defaultValues: initialBase.values,
    mode: 'onSubmit',
  })
  const { errors, isDirty } = form.formState
  const locked = busy || localBusy
  const readOnly = draft.state !== 'OPEN'
  const paymentStatus = useWatch({ control: form.control, name: 'paymentStatus' })
  const currency = useWatch({ control: form.control, name: 'currency' })
  const conversionConfirmed = useWatch({ control: form.control, name: 'conversionConfirmed' })
  const supplierName = useWatch({ control: form.control, name: 'supplierName' })
  const taxId = useWatch({ control: form.control, name: 'taxId' })
  const currentSourceKey = draftSourceKey(draft)
  const watchedValues = useWatch({ control: form.control }) as InvoiceReviewFormValues
  const isEur = currency.trim().toUpperCase() === 'EUR'
  const eurIssue = isEur ? invoiceEurConversionIssue(watchedValues) : null

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    const base = baseRef.current
    if (currentSourceKey === base.sourceKey) return
    const incomingBase = baseFromDraft(draft)
    if (!isDirty || draft.id !== base.draftId) {
      baseRef.current = incomingBase
      explicitlyConfirmedConversionRef.current = false
      confirmedConversionBasisRef.current = null
      form.reset(incomingBase.values)
      setFormEpoch((epoch) => epoch + 1)
      setStaleDraft(null)
      setRebaseNotice(null)
      return
    }
    setStaleDraft(draft)
    setRebaseNotice(null)
  }, [currentSourceKey, draft, form, isDirty])

  const issueMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const issue of issues) {
      if (!map.has(issue.field)) map.set(issue.field, issue.messagePolish)
    }
    return map
  }, [issues])

  function messageFor(field: keyof InvoiceReviewFormValues): string | undefined {
    return issueMap.get(field) ?? polishValidationMessage(errors[field]?.message)
  }

  function inputA11y(field: keyof InvoiceReviewFormValues, id: string) {
    const message = messageFor(field)
    return {
      'aria-invalid': Boolean(message),
      'aria-describedby': message ? `${id}-message` : undefined,
    }
  }

  const fxHasError = (['reportingGross', 'reportingNet', 'reportingVat', 'conversionNote', 'conversionConfirmed'] as const)
    .some((field) => Boolean(messageFor(field)))
  const detailsHaveError = (['net', 'vat', 'bankAccount', 'notes'] as const)
    .some((field) => Boolean(messageFor(field)))

  useEffect(() => {
    if (detailsHaveError && detailsRef.current) detailsRef.current.open = true
  }, [detailsHaveError])

  const hint = useMemo(() => invoiceClassificationHint(
    { ...draft.data, supplierName: supplierName || null, taxId: taxId || null },
    rules,
  ), [draft.data, rules, supplierName, taxId])

  async function invoke(operation: () => Promise<void>, failureMessage: string): Promise<boolean> {
    setLocalBusy(true)
    setLocalError(null)
    try {
      await operation()
      return true
    } catch {
      setLocalError(failureMessage)
      return false
    } finally {
      setLocalBusy(false)
    }
  }

  function submit(kind: 'SAVE' | 'APPROVE') {
    if (kind === 'APPROVE' && approvalBlockReason) return
    if (kind === 'APPROVE' && isEur && (eurIssue || !conversionConfirmed)) {
      setLocalError(eurIssue?.message ?? 'Potwierdź przeliczenie na PLN przed zatwierdzeniem.')
      return
    }
    setLocalError(null)
    void form.handleSubmit(async (values) => {
      const base = baseRef.current
      const patch = invoiceFormPatch(base.values, values, explicitlyConfirmedConversionRef.current)
      const succeeded = await invoke(
        () => kind === 'SAVE' ? onSave(patch, base.version) : onApprove(patch, base.version),
        kind === 'SAVE' ? 'Nie udało się zapisać szkicu. Spróbuj ponownie.' : 'Nie udało się zatwierdzić faktury. Spróbuj ponownie.',
      )
      if (succeeded) {
        baseRef.current = { ...base, values }
        explicitlyConfirmedConversionRef.current = false
        confirmedConversionBasisRef.current = null
        form.reset(values)
        setFormEpoch((epoch) => epoch + 1)
        setRebaseNotice(null)
      }
    }, () => {
      setLocalError('Popraw oznaczone pola przed zapisaniem.')
    })()
  }

  const invalidateConversion = useCallback(() => {
    explicitlyConfirmedConversionRef.current = false
    confirmedConversionBasisRef.current = null
    if (form.getValues('conversionConfirmed')) {
      form.setValue('conversionConfirmed', false, { shouldDirty: true })
    }
    setRebaseNotice((previous) => previous ? {
      basis: conversionBasis(form.getValues()), requiresFxConfirmation: isForeignCurrency(form.getValues('currency')),
    } : null)
  }, [form])

  function updateBasisField(field: 'gross' | 'net' | 'vat' | 'currency' | 'paidAt' | 'reportingGross' | 'reportingNet' | 'reportingVat', value: string) {
    form.setValue(field, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
    if (field === 'currency') {
      if (value.trim().toUpperCase() !== 'EUR') {
        form.setValue('conversion', null, { shouldDirty: true })
      } else if (!form.getValues('conversion')) {
        const manualAmounts = ['reportingGross', 'reportingNet', 'reportingVat'] as const
        form.setValue('conversionMode', manualAmounts.some((name) => form.getValues(name) !== '') ? 'MANUAL_AMOUNT' : 'NBP', { shouldDirty: true })
      }
    }
    invalidateConversion()
  }

  function applyHint() {
    if (hint.status !== 'MATCHED') return
    if (isCostCenter(hint.rule.costCenterId)) {
      form.setValue('costCenterId', hint.rule.costCenterId, { shouldDirty: true })
    }
    form.setValue('tagIds', [...hint.rule.tagIds], { shouldDirty: true })
  }

  function loadLatest() {
    if (!staleDraft) return
    const nextBase = baseFromDraft(staleDraft)
    baseRef.current = nextBase
    explicitlyConfirmedConversionRef.current = false
    confirmedConversionBasisRef.current = null
    form.reset(nextBase.values)
    setFormEpoch((epoch) => epoch + 1)
    setStaleDraft(null)
    setRebaseNotice(null)
    setLocalError(null)
  }

  function saveOnLatest() {
    if (!staleDraft || staleDraft.state !== 'OPEN' || draft.state !== 'OPEN') return
    const previousBase = baseRef.current
    const currentValues = form.getValues()
    const latestValues = invoiceDataToForm(staleDraft.data)
    const rebasedValues = dirtyValuesOnLatest(previousBase.values, currentValues, latestValues)
    const confirmedBasis = confirmedConversionBasisRef.current
    const effectiveBasis = conversionBasis(rebasedValues)
    const localConfirmationSupportsBasis = Boolean(
      explicitlyConfirmedConversionRef.current
      && confirmedBasis
      && sameConversionBasis(confirmedBasis, effectiveBasis),
    )
    const latestConfirmationSupportsBasis = latestValues.conversionConfirmed
      && sameConversionBasis(conversionBasis(latestValues), effectiveBasis)
    const unsupportedConfirmation = rebasedValues.conversionConfirmed
      && !localConfirmationSupportsBasis
      && !latestConfirmationSupportsBasis

    rebasedValues.conversionConfirmed = Boolean(
      rebasedValues.conversionConfirmed
      && (localConfirmationSupportsBasis || latestConfirmationSupportsBasis),
    )
    if (!localConfirmationSupportsBasis) {
      explicitlyConfirmedConversionRef.current = false
      confirmedConversionBasisRef.current = null
    }

    baseRef.current = {
      draftId: staleDraft.id,
      version: staleDraft.version,
      sourceKey: draftSourceKey(staleDraft),
      values: latestValues,
    }
    form.reset(latestValues)
    form.reset(rebasedValues, { keepDefaultValues: true })
    setFormEpoch((epoch) => epoch + 1)
    setStaleDraft(null)
    setRebaseNotice({
      basis: effectiveBasis,
      requiresFxConfirmation: isForeignCurrency(effectiveBasis.currency) && unsupportedConfirmation,
    })
  }

  function runDraftAction(action: InvoiceDraftAction, failureMessage: string) {
    if (isDirty || staleDraft) return
    if (action === 'RESTORE' ? draft.state !== 'ARCHIVED' : draft.state !== 'OPEN') return
    void invoke(() => onAction(action, draft.version), failureMessage)
  }

  function runRevoke() {
    if (draft.state !== 'APPROVED' || isDirty || staleDraft) return
    void invoke(() => onRevoke(draft.version), 'Nie udało się cofnąć faktury z kosztów.')
  }

  const openActionDisabled = locked || isDirty || Boolean(staleDraft)
  const fxNoteField = <Field id="invoice-conversion-note" label="Podstawa i uwaga do przeliczenia" message={messageFor('conversionNote')} className="mt-4">
    <textarea id="invoice-conversion-note" disabled={readOnly || locked} className={textareaClassName} rows={2} {...form.register('conversionNote')} {...inputA11y('conversionNote', 'invoice-conversion-note')} />
  </Field>
  const fxConfirmationField = isForeignCurrency(currency) && <Controller control={form.control} name="conversionConfirmed" render={({ field }) => (
    <div className="mt-4 flex items-start gap-3">
      <input id="invoice-conversion-confirmed" type="checkbox" className="mt-0.5 size-4 rounded border-[var(--wd-border)] accent-[var(--wd-dark)]"
        checked={field.value} disabled={readOnly || locked || Boolean(staleDraft) || Boolean(eurIssue)}
        onChange={(event) => {
          field.onChange(event.target.checked)
          explicitlyConfirmedConversionRef.current = event.target.checked
          confirmedConversionBasisRef.current = event.target.checked ? conversionBasis(form.getValues()) : null
        }} />
      <Label htmlFor="invoice-conversion-confirmed" className="text-sm leading-5">Potwierdzam przeliczenie na PLN i jego opisaną podstawę</Label>
    </div>
  )} />

  return (
    <section aria-label="Dane faktury" className="text-[var(--wd-dark)]">
      <form className="space-y-6" onSubmit={(event) => event.preventDefault()} noValidate>
        <header className="border-b border-[var(--wd-border)] pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--wd-text-muted)]">Weryfikacja dokumentu</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Dane do zaksięgowania</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--wd-text-muted)]">
                Porównaj każde pole z oryginałem. Puste pole oznacza brak pewnej informacji.
              </p>
            </div>
            <span className="rounded-full border border-[var(--wd-border)] bg-[var(--wd-surface-2)] px-3 py-1 text-xs font-semibold">
              {draft.state === 'OPEN' ? 'Szkic' : draft.state === 'APPROVED' ? 'Zatwierdzona' : 'Archiwum'}
            </span>
          </div>
        </header>

        {issues.length > 0 && (
          <div role="alert" className="border-l-4 border-red-700 bg-red-50 px-4 py-3 text-sm text-red-900">
            <p className="font-semibold">Sprawdź dane wskazane przez system</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {[...new Set(issues.map((issue) => issue.messagePolish))].map((message) => <li key={message}>{message}</li>)}
            </ul>
          </div>
        )}

        {localError && (
          <div role="alert" className="border-l-4 border-red-700 bg-red-50 px-4 py-3 text-sm font-medium text-red-900">
            {localError}
          </div>
        )}

        {draft.state === 'OPEN' && draft.invoiceId && (
          <div className="border-l-4 border-amber-600 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            <p className="font-semibold">Istnieje wcześniejszy zapis tego kosztu</p>
            <p>Poprzedni koszt został unieważniony. Ten szkic pozostaje poza aktywnymi kosztami i nie wpływa na sumy do czasu ponownego zatwierdzenia. Historia dokumentu pozostaje zachowana.</p>
          </div>
        )}

        {staleDraft && (
          <div role="status" className="border-l-4 border-amber-600 bg-amber-50 px-4 py-4 text-sm text-amber-950">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{staleDraft.state === 'OPEN' ? 'Dostępna jest nowsza wersja odczytu' : 'Dokument zmienił stan'}</p>
                <p className="mt-1 leading-6">
                  {staleDraft.state === 'OPEN'
                    ? 'Twoje poprawki pozostały bez zmian. Wybierz, czy je odrzucić, czy najpierw nałożyć tylko zmienione pola na aktualne dane.'
                    : 'Dokument nie jest już szkicem. Lokalnych poprawek nie można zapisać; wczytaj aktualne dane, aby przejść do dostępnych działań.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={locked} onClick={loadLatest}>Wczytaj aktualne dane</Button>
                  <Button type="button" size="sm" disabled={locked || staleDraft.state !== 'OPEN' || draft.state !== 'OPEN'} onClick={saveOnLatest} className="bg-[var(--wd-dark)] text-white hover:bg-black">
                    Zapisz moje poprawki na aktualnej wersji
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {rebaseNotice && (
          <div role="status" className="border-l-4 border-amber-600 bg-amber-50 px-4 py-4 text-sm text-amber-950">
            <p className="font-semibold">
              {rebaseNotice.requiresFxConfirmation
                ? 'Przeliczenie wymaga ponownego potwierdzenia'
                : 'Poprawki nałożono na aktualne dane'}
            </p>
            <p className="mt-1 leading-6">
              {rebaseNotice.requiresFxConfirmation
                ? 'Podstawa zmieniła się po zaznaczeniu potwierdzenia. Sprawdź widoczne wartości i potwierdź przeliczenie ponownie przed zatwierdzeniem.'
                : 'Sprawdź wynik połączenia danych, a następnie wybierz „Zapisz szkic” albo „Zatwierdź i następna”.'}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-amber-700/20 pt-3 text-xs sm:grid-cols-4">
              <div><dt className="text-amber-800">Waluta</dt><dd className="font-mono font-semibold">{shownBasisValue(rebaseNotice.basis.currency)}</dd></div>
              <div><dt className="text-amber-800">Brutto</dt><dd className="font-mono font-semibold">{shownBasisValue(rebaseNotice.basis.gross)}</dd></div>
              <div><dt className="text-amber-800">Netto</dt><dd className="font-mono font-semibold">{shownBasisValue(rebaseNotice.basis.net)}</dd></div>
              <div><dt className="text-amber-800">VAT</dt><dd className="font-mono font-semibold">{shownBasisValue(rebaseNotice.basis.vat)}</dd></div>
            </dl>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="documentType"
            render={({ field }) => {
              const message = messageFor('documentType')
              return (
                <Field id="invoice-document-type" label="Rodzaj dokumentu" message={message}>
                  <ChoiceField id="invoice-document-type" label="Rodzaj dokumentu" value={field.value} options={DOCUMENT_TYPES} disabled={readOnly || locked} invalid={Boolean(message)} describedBy={message ? 'invoice-document-type-message' : undefined} onChange={field.onChange} />
                </Field>
              )
            }}
          />

          <Field id="invoice-number" label="Numer dokumentu" message={messageFor('invoiceNumber')}>
            <Input id="invoice-number" disabled={readOnly || locked} className={inputClassName} {...form.register('invoiceNumber')} {...inputA11y('invoiceNumber', 'invoice-number')} />
          </Field>

          <Field id="invoice-supplier" label="Nazwa dostawcy" message={messageFor('supplierName')} className="sm:col-span-2">
            <Input id="invoice-supplier" disabled={readOnly || locked} className={inputClassName} {...form.register('supplierName')} {...inputA11y('supplierName', 'invoice-supplier')} />
          </Field>

          <Field id="invoice-tax-id" label="NIP / identyfikator podatkowy" message={messageFor('taxId')}>
            <Input id="invoice-tax-id" disabled={readOnly || locked} className={inputClassName} autoComplete="off" {...form.register('taxId')} {...inputA11y('taxId', 'invoice-tax-id')} />
          </Field>

          <Field id="invoice-currency" label="Waluta" message={messageFor('currency')}>
            <Input
              id="invoice-currency"
              disabled={readOnly || locked}
              className={`${inputClassName} uppercase`}
              maxLength={3}
              placeholder="np. PLN"
              value={form.watch('currency')}
              onChange={(event) => updateBasisField('currency', event.target.value)}
              {...inputA11y('currency', 'invoice-currency')}
            />
          </Field>

          <Field id="invoice-issue-date" label="Data wystawienia" message={messageFor('issueDate')}>
            <Input id="invoice-issue-date" disabled={readOnly || locked} className={inputClassName} inputMode="numeric" placeholder="RRRR-MM-DD" {...form.register('issueDate')} {...inputA11y('issueDate', 'invoice-issue-date')} />
          </Field>

          <Field id="invoice-due-date" label="Termin płatności" message={messageFor('dueDate')}>
            <Input id="invoice-due-date" disabled={readOnly || locked} className={inputClassName} inputMode="numeric" placeholder="RRRR-MM-DD" {...form.register('dueDate')} {...inputA11y('dueDate', 'invoice-due-date')} />
          </Field>

          {!isEur && <Field id="invoice-gross" label="Kwota brutto" message={messageFor('gross')}>
            <Input
              id="invoice-gross"
              disabled={readOnly || locked}
              className={`${inputClassName} font-mono tabular-nums`}
              inputMode="decimal"
              value={form.watch('gross')}
              onChange={(event) => updateBasisField('gross', event.target.value)}
              {...inputA11y('gross', 'invoice-gross')}
            />
          </Field>}

          <Controller
            control={form.control}
            name="paymentStatus"
            render={({ field }) => {
              const message = messageFor('paymentStatus')
              return (
                <Field id="invoice-payment-status" label="Status płatności" message={message}>
                  <ChoiceField id="invoice-payment-status" label="Status płatności" value={field.value} options={PAYMENT_STATUSES} disabled={readOnly || locked} invalid={Boolean(message)} describedBy={message ? 'invoice-payment-status-message' : undefined} onChange={field.onChange} />
                </Field>
              )
            }}
          />

          {(isEur || paymentStatus === 'PAID' || Boolean(messageFor('paidAt'))) && (
            <Field id="invoice-paid-at" label="Data zapłaty (opcjonalnie)" message={messageFor('paidAt')}>
              <Input id="invoice-paid-at" disabled={readOnly || locked} className={inputClassName} inputMode="numeric" placeholder="RRRR-MM-DD" value={form.watch('paidAt')} onChange={(event) => updateBasisField('paidAt', event.target.value)} {...inputA11y('paidAt', 'invoice-paid-at')} />
            </Field>
          )}
        </div>

        {isEur && <InvoiceEurConversion key={`${draft.id}:${formEpoch}`} form={form} disabled={readOnly || locked || Boolean(staleDraft)}
          scopeKey={currentSourceKey} onBasisChange={invalidateConversion} messageFor={messageFor} eurRate={eurRate}>
          {fxNoteField}{fxConfirmationField}
        </InvoiceEurConversion>}

        <div className="border-y border-[var(--wd-border)] bg-[var(--wd-off-white)] px-4 py-4">
          {hint.status === 'MATCHED' ? (
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="flex gap-3">
                <Lightbulb className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">Podpowiedź na podstawie reguły dostawcy</p>
                  <p className="mt-0.5 text-xs leading-5 text-[var(--wd-text-muted)]">Zastosowanie zmieni miejsce kosztu i tagi wyłącznie w tym formularzu. Nic nie zapisze się automatycznie.</p>
                </div>
              </div>
              {!readOnly && <Button type="button" variant="outline" size="sm" disabled={locked} onClick={applyHint}>Użyj podpowiedzi</Button>}
            </div>
          ) : hint.status === 'CONFLICT' ? (
            <div className="flex gap-3 text-sm">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden="true" />
              <div>
                <p className="font-semibold">Kilka reguł pasuje z tym samym priorytetem</p>
                <p className="mt-0.5 text-xs leading-5 text-[var(--wd-text-muted)]">Wybierz miejsce kosztu i tagi ręcznie. Reguły nie zostały zmienione.</p>
              </div>
            </div>
          ) : (
            <p className="text-xs leading-5 text-[var(--wd-text-muted)]">Brak jednoznacznej podpowiedzi dla tego dostawcy. Klasyfikację wybierz ręcznie.</p>
          )}
        </div>

        <div className="space-y-5">
          <Controller
            control={form.control}
            name="costCenterId"
            render={({ field }) => {
              const message = messageFor('costCenterId')
              const options = [
                { value: '', label: 'Wybierz miejsce kosztu' },
                ...costCenters.filter((center) => isCostCenter(center.id)).map((center) => ({ value: center.id, label: center.name })),
              ]
              return (
                <Field id="invoice-cost-center" label="Miejsce kosztu" message={message}>
                  <ChoiceField
                    id="invoice-cost-center"
                    label="Miejsce kosztu"
                    value={field.value}
                    options={options}
                    disabled={readOnly || locked}
                    invalid={Boolean(message)}
                    describedBy={message ? 'invoice-cost-center-message' : undefined}
                    onChange={(value) => { if (isCostCenter(value)) field.onChange(value) }}
                  />
                </Field>
              )
            }}
          />

          <Controller
            control={form.control}
            name="tagIds"
            render={({ field }) => (
              <Field id="invoice-tags" label="Tagi kosztu" message={messageFor('tagIds')}>
                <div id="invoice-tags" aria-invalid={Boolean(messageFor('tagIds'))} aria-describedby={messageFor('tagIds') ? 'invoice-tags-message' : undefined}>
                  <TagChips groups={tagGroups} value={field.value} onChange={field.onChange} disabled={readOnly || locked} size="md" />
                </div>
              </Field>
            )}
          />
        </div>

        {!isEur && (isForeignCurrency(currency) || fxHasError) && (
          <section aria-labelledby="invoice-fx-title" className="border-l-4 border-amber-600 bg-amber-50/70 px-4 py-4">
            <h3 id="invoice-fx-title" className="font-semibold">Wartości raportowe w PLN</h3>
            <p className="mt-1 text-xs leading-5 text-amber-950">Przepisz wartości i podstawę przeliczenia z dokumentacji księgowej. Formularz nie pobiera ani nie oblicza kursu automatycznie.</p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(['reportingGross', 'reportingNet', 'reportingVat'] as const).map((fieldName) => {
                const labels = { reportingGross: 'Brutto w PLN', reportingNet: 'Netto w PLN', reportingVat: 'VAT w PLN' }
                const id = `invoice-${fieldName}`
                return (
                  <Field key={fieldName} id={id} label={labels[fieldName]} message={messageFor(fieldName)}>
                    <Input id={id} disabled={readOnly || locked} className={`${inputClassName} font-mono tabular-nums`} inputMode="decimal" value={form.watch(fieldName)} onChange={(event) => updateBasisField(fieldName, event.target.value)} {...inputA11y(fieldName, id)} />
                  </Field>
                )
              })}
            </div>
            {fxNoteField}{fxConfirmationField}
          </section>
        )}

        <details ref={detailsRef} className="group border-y border-[var(--wd-border)] py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)]/20 [&::-webkit-details-marker]:hidden">
            <span>Dane szczegółowe {detailsHaveError && <span className="ml-2 text-xs font-semibold text-red-700">· sprawdź pola</span>}</span>
            <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
          </summary>
          <div className="grid grid-cols-1 gap-4 border-t border-[var(--wd-border)] py-4 sm:grid-cols-2">
            <Field id="invoice-net" label="Kwota netto" message={messageFor('net')}>
              <Input id="invoice-net" disabled={readOnly || locked} className={`${inputClassName} font-mono tabular-nums`} inputMode="decimal" value={form.watch('net')} onChange={(event) => updateBasisField('net', event.target.value)} {...inputA11y('net', 'invoice-net')} />
            </Field>
            <Field id="invoice-vat" label="Kwota VAT" message={messageFor('vat')}>
              <Input id="invoice-vat" disabled={readOnly || locked} className={`${inputClassName} font-mono tabular-nums`} inputMode="decimal" value={form.watch('vat')} onChange={(event) => updateBasisField('vat', event.target.value)} {...inputA11y('vat', 'invoice-vat')} />
            </Field>
            <Field id="invoice-bank-account" label="Rachunek bankowy" message={messageFor('bankAccount')} className="sm:col-span-2">
              <Input id="invoice-bank-account" disabled={readOnly || locked} className={`${inputClassName} font-mono`} autoComplete="off" {...form.register('bankAccount')} {...inputA11y('bankAccount', 'invoice-bank-account')} />
            </Field>
            <Field id="invoice-notes" label="Uwagi" message={messageFor('notes')} className="sm:col-span-2">
              <textarea id="invoice-notes" disabled={readOnly || locked} className={textareaClassName} {...form.register('notes')} {...inputA11y('notes', 'invoice-notes')} />
            </Field>
          </div>
        </details>

        {draft.state === 'OPEN' && (
          <footer className="space-y-4 border-t border-[var(--wd-border)] pt-5">
            {approvalBlockReason && <p id="invoice-ksef-approval-block" role="status" className="text-sm font-medium leading-6 text-amber-900">{approvalBlockReason}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={locked || Boolean(staleDraft)} onClick={() => submit('SAVE')}>Zapisz szkic</Button>
              <Button type="button" aria-describedby={approvalBlockReason ? 'invoice-ksef-approval-block' : undefined} disabled={locked || Boolean(approvalBlockReason) || Boolean(staleDraft) || Boolean(rebaseNotice?.requiresFxConfirmation && !conversionConfirmed)} onClick={() => submit('APPROVE')} className="bg-[var(--wd-dark)] text-white hover:bg-black">
                <Check aria-hidden="true" />
                Zatwierdź i następna
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--wd-border)] pt-4">
              <Button type="button" size="sm" variant="ghost" disabled={openActionDisabled} onClick={() => runDraftAction('SKIP', 'Nie udało się pominąć szkicu.')}>Pomiń na teraz</Button>
              <Button type="button" size="sm" variant="ghost" disabled={openActionDisabled} onClick={() => runDraftAction('EXTRACT', 'Nie udało się zlecić ponownego odczytu.')}>
                <RotateCcw aria-hidden="true" />
                Odczytaj ponownie
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={openActionDisabled} onClick={() => runDraftAction('ARCHIVE', 'Nie udało się zarchiwizować szkicu.')} className="text-red-800 hover:bg-red-50 hover:text-red-900">Archiwizuj szkic</Button>
              {isDirty && <p className="w-full text-xs text-amber-800 sm:ml-auto sm:w-auto">Aby użyć tych działań, najpierw zapisz poprawki.</p>}
            </div>
          </footer>
        )}

        {draft.state === 'APPROVED' && (
          <footer className="border-t border-[var(--wd-border)] pt-5">
            <p className="text-sm leading-6 text-[var(--wd-text-muted)]">
              Cofnięcie usuwa fakturę z aktywnych kosztów, ale zachowuje ten sam dokument i pełną historię. Nie wykonuje ani nie cofa przelewu bankowego.
            </p>
            {(isDirty || staleDraft) && <p className="mt-2 text-xs font-medium text-amber-800">Wczytaj aktualne dane, aby zobaczyć zatwierdzone wartości i odblokować cofnięcie z kosztów.</p>}
            <Button type="button" variant="outline" disabled={locked || isDirty || Boolean(staleDraft)} onClick={runRevoke} className="mt-3">
              Cofnij z kosztów
            </Button>
          </footer>
        )}

        {draft.state === 'ARCHIVED' && (
          <footer className="border-t border-[var(--wd-border)] pt-5">
            <p className="text-sm leading-6 text-[var(--wd-text-muted)]">Dokument pozostaje w archiwum i nie wpływa na aktywne koszty.</p>
            {(isDirty || staleDraft) && <p className="mt-2 text-xs font-medium text-amber-800">Wczytaj aktualne dane, aby odrzucić lokalne poprawki i odblokować przywrócenie szkicu.</p>}
            <Button type="button" variant="outline" disabled={locked || isDirty || Boolean(staleDraft)} onClick={() => runDraftAction('RESTORE', 'Nie udało się przywrócić szkicu.')} className="mt-3">
              Przywróć szkic
            </Button>
          </footer>
        )}
      </form>
    </section>
  )
}
