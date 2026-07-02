import { z } from 'zod'
import { VALID_COST_CENTERS } from '@/lib/validations/ksef-inbox'

export const CostAllocationSchema = z.object({
  costCenterId: z.enum(VALID_COST_CENTERS),
  percent: z.coerce.number().positive().max(100),
})

export const KsefInvoicePartInputSchema = z.object({
  label: z.string().trim().min(1).max(120),
  grossAmount: z.coerce.number(),
  tagIds: z.array(z.string().min(1)).default([]),
  allocations: z.array(CostAllocationSchema).min(1),
})

export const KsefInvoicePartsUpdateSchema = z.object({
  parts: z.array(KsefInvoicePartInputSchema).min(1),
})
