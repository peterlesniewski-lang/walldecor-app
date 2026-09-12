import { z } from 'zod'
import { invoiceDraftDataSchema, type InvoiceDraftData } from './contracts'

const MONEY_FIELDS = ['gross', 'net', 'vat', 'reportingGross', 'reportingNet', 'reportingVat'] as const
const TEXT_FIELDS = ['supplierName', 'taxId', 'invoiceNumber', 'issueDate', 'dueDate', 'currency', 'bankAccount', 'paidAt', 'notes', 'conversionNote'] as const
const BASIS_FIELDS = ['gross', 'net', 'vat', 'currency'] as const

function moneyValue(value: string): number | null {
  const normalized = value.replace(/\s/gu, '').replace(',', '.')
  if (!normalized) return null
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) || !Number.isFinite(Number(normalized))) {
    throw new Error('Wpisz poprawną kwotę, np. 1234,50.')
  }
  return Number(normalized)
}

const moneyField = z.string().refine((value) => {
  try { moneyValue(value); return true } catch { return false }
}, 'Wpisz poprawną kwotę, np. 1234,50.')
const dateField = z.union([z.literal(''), z.iso.date({ error: 'Wpisz datę w formacie RRRR-MM-DD.' })])
export const invoiceReviewFormSchema = z.strictObject({
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
})
export type InvoiceReviewFormValues = z.infer<typeof invoiceReviewFormSchema>

export function invoiceDataToForm(data: InvoiceDraftData): InvoiceReviewFormValues {
  return invoiceReviewFormSchema.parse({
    ...Object.fromEntries(TEXT_FIELDS.map((field) => [field, data[field] ?? ''])),
    ...Object.fromEntries(MONEY_FIELDS.map((field) => [field, data[field] == null ? '' : String(data[field])])),
    documentType: data.documentType ?? '', paymentStatus: data.paymentStatus ?? '',
    costCenterId: data.costCenterId ?? '', tagIds: [...(data.tagIds ?? [])],
    conversionConfirmed: data.conversionConfirmed ?? false,
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
    if (JSON.stringify(current[key]) === JSON.stringify(initial[key])) continue
    const value = current[key]
    patch[key] = (MONEY_FIELDS as readonly string[]).includes(key)
      ? moneyValue(value as string)
      : typeof value === 'string' ? value.trim() || null : value
  }
  if (typeof patch.currency === 'string') patch.currency = patch.currency.toUpperCase()
  if (BASIS_FIELDS.some((field) => Object.hasOwn(patch, field)) && (initial.conversionConfirmed || current.conversionConfirmed)) {
    patch.conversionConfirmed = current.conversionConfirmed && (explicitlyConfirmedConversion || !initial.conversionConfirmed)
  } else if (explicitlyConfirmedConversion) {
    patch.conversionConfirmed = current.conversionConfirmed
  }
  return invoiceDraftDataSchema.parse(patch)
}
