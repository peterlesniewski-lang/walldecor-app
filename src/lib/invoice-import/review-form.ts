import { z } from 'zod'
import { invoiceDraftDataSchema, type InvoiceDraftData } from './contracts'
import { EUR_CONVERSION_BASIS_FIELDS, hasEurSourceCentPrecision, invoiceEurConversionSchema, isValidConfirmedEurConversion, parseCanonicalRate } from './eur-conversion'

const MONEY_FIELDS = ['gross', 'net', 'vat', 'reportingGross', 'reportingNet', 'reportingVat'] as const
const TEXT_FIELDS = ['supplierName', 'taxId', 'invoiceNumber', 'issueDate', 'dueDate', 'currency', 'bankAccount', 'paidAt', 'notes', 'conversionNote'] as const
const BASIS_FIELDS = [...EUR_CONVERSION_BASIS_FIELDS, 'conversionRate', 'conversionMode'] as const
const UI_ONLY_FIELDS = ['conversionRate', 'conversionMode'] as const

export function invoiceReviewMoneyValue(value: string): number | null {
  const normalized = value.replace(/\s/gu, '').replace(',', '.')
  if (!normalized) return null
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) || !Number.isFinite(Number(normalized))) {
    throw new Error('Wpisz poprawną kwotę, np. 1234,50.')
  }
  return Number(normalized)
}

const moneyField = z.string().refine((value) => {
  try { invoiceReviewMoneyValue(value); return true } catch { return false }
}, 'Wpisz poprawną kwotę, np. 1234,50.')
const dateField = z.union([z.literal(''), z.iso.date({ error: 'Wpisz datę w formacie RRRR-MM-DD.' })])
const invoiceReviewFormBaseSchema = z.strictObject({
  documentType: z.enum(['', 'INVOICE', 'CORRECTION', 'CREDIT_NOTE', 'PROFORMA', 'OTHER']),
  supplierName: z.string().max(500), taxId: z.string().max(64), invoiceNumber: z.string().max(160),
  issueDate: dateField, dueDate: dateField, paidAt: dateField,
  currency: z.string().refine((value) => value === '' || /^[A-Za-z]{3}$/.test(value.trim()), 'Wpisz trzy litery waluty, np. PLN.'),
  gross: moneyField, net: moneyField, vat: moneyField,
  paymentStatus: z.enum(['', 'PAID', 'UNPAID', 'PARTIAL', 'UNKNOWN']),
  bankAccount: z.string().max(100),
  costCenterId: z.enum(['', 'JAG', 'PUL', 'GLOBAL']), tagIds: z.array(z.string()).max(22),
  notes: z.string().max(10_000), reportingGross: moneyField, reportingNet: moneyField, reportingVat: moneyField,
  conversionNote: z.string().max(2_000), conversionConfirmed: z.boolean(),
  conversion: invoiceEurConversionSchema.nullable(),
  conversionMode: z.enum(['NBP', 'MANUAL_RATE', 'MANUAL_AMOUNT']),
  conversionRate: z.string().max(40),
})
export type InvoiceReviewFormValues = z.infer<typeof invoiceReviewFormBaseSchema>

export function invoiceEurConversionIssue(values: InvoiceReviewFormValues): { field: keyof InvoiceReviewFormValues; message: string } | null {
  if (values.currency.trim().toUpperCase() !== 'EUR') return null
  let data: InvoiceDraftData
  try {
    data = { currency: 'EUR', paidAt: values.paidAt || null, conversion: values.conversion,
      ...Object.fromEntries(MONEY_FIELDS.map((field) => [field, invoiceReviewMoneyValue(values[field])])) }
  } catch { return { field: 'gross', message: 'Wpisz poprawne kwoty przed potwierdzeniem przeliczenia.' } }
  if (data.gross == null || data.gross < 0) return { field: 'gross', message: 'Wpisz kwotę do zapłaty w EUR.' }
  if (values.conversionMode !== 'MANUAL_AMOUNT') {
    let rate: string
    try { rate = parseCanonicalRate(values.conversionRate.replace(',', '.')) }
    catch { return { field: 'conversionRate', message: 'Wpisz dodatni kurs, np. 4,25 (maksymalnie 8 miejsc po przecinku).' } }
    if (!values.conversion || values.conversion.mode !== values.conversionMode || values.conversion.rate !== rate) {
      return { field: 'conversion', message: 'Sprawdź datę i pobierz kurs NBP lub wpisz kurs ręcznie.' }
    }
    if (!hasEurSourceCentPrecision(data)) return { field: 'gross', message: 'Wpisz kwoty źródłowe EUR z dokładnością do grosza przed potwierdzeniem kursu.' }
  }
  if (data.reportingGross == null || data.reportingGross < 0) return { field: 'reportingGross', message: 'Wpisz kwotę brutto w PLN lub uzupełnij kurs.' }
  if (!isValidConfirmedEurConversion(data)) return { field: 'conversion', message: 'Sprawdź podstawę przeliczenia, datę płatności i kwoty PLN.' }
  return null
}

export const invoiceReviewFormSchema = invoiceReviewFormBaseSchema.superRefine((values, context) => {
  if (!values.conversionConfirmed || values.conversionMode === 'MANUAL_AMOUNT') return
  const issue = invoiceEurConversionIssue(values)
  if (issue) context.addIssue({ code: 'custom', path: [issue.field], message: issue.message })
})

export function invoiceDataToForm(data: InvoiceDraftData): InvoiceReviewFormValues {
  return invoiceReviewFormBaseSchema.parse({
    ...Object.fromEntries(TEXT_FIELDS.map((field) => [field, data[field] ?? ''])),
    ...Object.fromEntries(MONEY_FIELDS.map((field) => [field, data[field] == null ? '' : String(data[field])])),
    documentType: data.documentType ?? '', paymentStatus: data.paymentStatus ?? '',
    costCenterId: data.costCenterId ?? '', tagIds: [...(data.tagIds ?? [])],
    conversionConfirmed: data.conversionConfirmed ?? false,
    conversion: data.conversion ?? null,
    conversionMode: data.conversion?.mode ?? ([data.reportingGross, data.reportingNet, data.reportingVat].some((value) => value != null) ? 'MANUAL_AMOUNT' : 'NBP'),
    conversionRate: data.conversion?.rate ?? '',
  })
}

/** Only actual edits become protected manual fields. Empty optional controls
 * stay unknown, never zero/today/paid. Explicit reconfirmation is user input. */
export function invoiceFormPatch(
  initial: InvoiceReviewFormValues,
  input: InvoiceReviewFormValues,
  explicitlyConfirmedConversion = false,
): InvoiceDraftData {
  const current = invoiceReviewFormSchema.parse(input)
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(current) as Array<keyof InvoiceReviewFormValues>) {
    if ((UI_ONLY_FIELDS as readonly string[]).includes(key)) continue
    if (JSON.stringify(current[key]) === JSON.stringify(initial[key])) continue
    const value = current[key]
    patch[key] = (MONEY_FIELDS as readonly string[]).includes(key)
      ? invoiceReviewMoneyValue(value as string)
      : typeof value === 'string' ? value.trim() || null : value
  }
  if (typeof patch.currency === 'string') patch.currency = patch.currency.toUpperCase()
  if (BASIS_FIELDS.some((field) => JSON.stringify(initial[field]) !== JSON.stringify(current[field])) && (initial.conversionConfirmed || current.conversionConfirmed)) {
    patch.conversionConfirmed = current.conversionConfirmed && (explicitlyConfirmedConversion || !initial.conversionConfirmed)
  } else if (explicitlyConfirmedConversion) {
    patch.conversionConfirmed = current.conversionConfirmed
  }
  return invoiceDraftDataSchema.parse(patch)
}
