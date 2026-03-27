import { z } from 'zod'

export const BudgetEntrySchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  costCenterId: z.string().min(1),
  subCategoryId: z.string().cuid(),
  amount: z.number().min(0, 'Kwota nie może być ujemna'),
})

export const BudgetQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  costCenterId: z.string().min(1),
})

export type BudgetEntryInput = z.infer<typeof BudgetEntrySchema>
