import { z } from 'zod'
import type { InvoiceDraftKsefReconciliation } from './client-contracts'
import type { KsefResolutionResult } from './ksef-reconciliation-service'

// Browser-only response validation. Do not import the server XML parser here.
const id = z.string().min(1).max(191)
const version = z.number().int().positive()
const value = z.union([z.string(), z.number().finite(), z.null()])
const snapshot = z.object({
  externalId: id,
  documentStatus: z.enum(['ACTIVE', 'CORRECTED', 'CORRECTION', 'CANCELLED']),
  data: z.object({
    documentType: z.enum(['INVOICE', 'CORRECTION', 'CREDIT_NOTE', 'PROFORMA', 'OTHER']),
    supplierName: z.string().min(1).max(500), taxId: z.string().max(64).nullable(),
    invoiceNumber: z.string().min(1).max(160), issueDate: z.iso.date(), currency: z.string().regex(/^[A-Z]{3}$/),
    gross: z.number().finite(), net: z.number().finite().nullable(), vat: z.number().finite().nullable(),
    dueDate: z.iso.date().nullable(), bankAccount: z.string().max(100).nullable(),
    paymentStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL', 'UNKNOWN']), paidAt: z.iso.date().nullable(),
  }),
})
export const invoiceKsefDetailSchema = z.object({
  draftId: id, draftVersion: version, draftState: z.enum(['OPEN', 'APPROVED', 'ARCHIVED']),
  links: z.array(z.object({
    id, externalId: id, version,
    status: z.enum(['MATCHED', 'CONFLICT', 'KEPT_LOCAL', 'APPLIED_TO_DRAFT']), approvalBlocked: z.boolean(),
    differences: z.array(z.object({
      field: z.enum(['documentStatus', 'documentType', 'supplierName', 'taxId', 'invoiceNumber', 'issueDate',
        'currency', 'gross', 'net', 'vat', 'dueDate', 'bankAccount', 'paymentStatus', 'paidAt']),
      localValue: value, ksefValue: value,
    })),
    snapshot, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  })),
}) satisfies z.ZodType<InvoiceDraftKsefReconciliation>

export const invoiceKsefResultSchema = z.object({
  draftId: id, version, reconciliationId: id, reconciliationVersion: version,
  outcome: z.enum(['KEPT_LOCAL', 'APPLIED_TO_DRAFT']),
}) satisfies z.ZodType<KsefResolutionResult>
