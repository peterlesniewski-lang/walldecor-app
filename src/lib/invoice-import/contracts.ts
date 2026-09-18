import { z } from 'zod'
import { aiInvoiceResultSchema } from '../ai/contracts'
import { invoiceEurConversionSchema } from './eur-conversion'

export const INVOICE_IMPORT_MAX_FILES = 20
export const INVOICE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const INVOICE_ATTACHMENT_MAX_PDF_PAGES = 10
export const INVOICE_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type InvoiceAttachmentMimeType = (typeof INVOICE_ATTACHMENT_ALLOWED_MIME_TYPES)[number]

const optionalAiField = {
  documentType: aiInvoiceResultSchema.shape.documentType.optional(),
  supplierName: aiInvoiceResultSchema.shape.supplierName.optional(),
  taxId: aiInvoiceResultSchema.shape.taxId.optional(),
  invoiceNumber: aiInvoiceResultSchema.shape.invoiceNumber.optional(),
  issueDate: aiInvoiceResultSchema.shape.issueDate.optional(),
  dueDate: aiInvoiceResultSchema.shape.dueDate.optional(),
  currency: aiInvoiceResultSchema.shape.currency.optional(),
  gross: aiInvoiceResultSchema.shape.gross.optional(),
  net: aiInvoiceResultSchema.shape.net.optional(),
  vat: aiInvoiceResultSchema.shape.vat.optional(),
  bankAccount: aiInvoiceResultSchema.shape.bankAccount.optional(),
  paymentStatus: aiInvoiceResultSchema.shape.paymentStatus.optional(),
}

const boundedIdSchema = z.string().trim().min(1).max(191)

export const invoiceDraftDataSchema = z.strictObject({
  ...optionalAiField,
  paidAt: z.iso.date().nullable().optional(),
  costCenterId: z.enum(['JAG', 'PUL', 'GLOBAL']).nullable().optional(),
  tagIds: z.array(boundedIdSchema)
    .max(22)
    .refine((tagIds) => new Set(tagIds).size === tagIds.length, 'Tag IDs must be unique')
    .optional(),
  notes: z.string().max(10_000).nullable().optional(),
  reportingGross: z.number().finite().nullable().optional(),
  reportingNet: z.number().finite().nullable().optional(),
  reportingVat: z.number().finite().nullable().optional(),
  conversionNote: z.string().max(2_000).nullable().optional(),
  conversionConfirmed: z.boolean().optional(),
  conversion: invoiceEurConversionSchema.nullable().optional(),
})

export type InvoiceDraftData = z.infer<typeof invoiceDraftDataSchema>

export const INVOICE_AI_MERGE_FIELDS = [
  'documentType',
  'supplierName',
  'taxId',
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'currency',
  'gross',
  'net',
  'vat',
  'bankAccount',
  'paymentStatus',
] as const satisfies ReadonlyArray<keyof InvoiceDraftData>

export type InvoiceAiMergeField = (typeof INVOICE_AI_MERGE_FIELDS)[number]

export const INVOICE_MANUAL_FIELD_NAMES = [
  ...INVOICE_AI_MERGE_FIELDS,
  'paidAt',
  'costCenterId',
  'tagIds',
  'notes',
  'reportingGross',
  'reportingNet',
  'reportingVat',
  'conversionNote',
  'conversionConfirmed',
  'conversion',
] as const satisfies ReadonlyArray<keyof InvoiceDraftData>

export type InvoiceManualField = (typeof INVOICE_MANUAL_FIELD_NAMES)[number]

export const invoiceManualFieldsSchema = z.array(z.enum(INVOICE_MANUAL_FIELD_NAMES))
  .max(INVOICE_MANUAL_FIELD_NAMES.length)
  .refine((fields) => new Set(fields).size === fields.length, 'Manual field names must be unique')

export function applyInvoiceAiFields(
  currentData: unknown,
  manualFields: unknown,
  aiResult: unknown,
): InvoiceDraftData {
  const current = invoiceDraftDataSchema.parse(currentData)
  const protectedFields = new Set(invoiceManualFieldsSchema.parse(manualFields))
  const extracted = aiInvoiceResultSchema.parse(aiResult)
  const aiUpdates = Object.fromEntries(
    INVOICE_AI_MERGE_FIELDS
      .filter((field) => !protectedFields.has(field))
      .map((field) => [field, extracted[field]]),
  )

  return invoiceDraftDataSchema.parse({ ...current, ...aiUpdates })
}
