import { z } from 'zod'

export const aiJobKindSchema = z.enum(['FINANCE_CHAT', 'WIKI_CHAT', 'INVOICE_EXTRACT'])
export type AiJobKind = z.infer<typeof aiJobKindSchema>
export const aiJobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED'])
export type AiJobStatus = z.infer<typeof aiJobStatusSchema>

export const aiChatPayloadSchema = z.strictObject({
  question: z.string().trim().min(1).max(500),
  context: z.string().max(80_000),
})
export const aiInvoicePayloadSchema = z.strictObject({
  draftId: z.string().trim().min(1).max(191),
  revision: z.number().int().positive(),
  attachmentId: z.string().trim().min(1).max(191),
})
export const aiJobInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('FINANCE_CHAT'), payload: aiChatPayloadSchema }),
  z.strictObject({ kind: z.literal('WIKI_CHAT'), payload: aiChatPayloadSchema }),
  z.strictObject({ kind: z.literal('INVOICE_EXTRACT'), payload: aiInvoicePayloadSchema }),
])
export type AiJobInput = z.infer<typeof aiJobInputSchema>

export const aiChatResultSchema = z.strictObject({ answer: z.string().trim().min(1).max(40_000) })
// Unknown values must be explicit nulls. No amount or payment-state defaults.
export const aiInvoiceResultSchema = z.strictObject({
  documentType: z.enum(['INVOICE', 'CORRECTION', 'CREDIT_NOTE', 'PROFORMA', 'OTHER']).nullable(),
  supplierName: z.string().trim().min(1).max(500).nullable(),
  taxId: z.string().trim().min(1).max(64).nullable(),
  invoiceNumber: z.string().trim().min(1).max(160).nullable(),
  issueDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  gross: z.number().finite().nullable(),
  net: z.number().finite().nullable(),
  vat: z.number().finite().nullable(),
  bankAccount: z.string().trim().min(1).max(100).nullable(),
  paymentStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL', 'UNKNOWN']).nullable(),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(30),
})
export type AiChatResult = z.infer<typeof aiChatResultSchema>
export type AiInvoiceResult = z.infer<typeof aiInvoiceResultSchema>
export type AiJobResult = AiChatResult | AiInvoiceResult

function resultSchema(kind: AiJobKind) {
  return kind === 'INVOICE_EXTRACT' ? aiInvoiceResultSchema : aiChatResultSchema
}

export function parseAiJobResult(kind: AiJobKind, result: unknown): AiJobResult {
  return resultSchema(aiJobKindSchema.parse(kind)).parse(result)
}

export function aiJobResultJsonSchema(kind: AiJobKind): Record<string, unknown> {
  return z.toJSONSchema(resultSchema(aiJobKindSchema.parse(kind)))
}
