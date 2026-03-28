import { z } from 'zod'

export const budgetThresholdSchema = z
  .object({
    name: z.string().min(1, 'Nazwa jest wymagana'),
    warningPercent: z
      .number()
      .int()
      .min(1, 'Minimum 1%')
      .max(200, 'Maksimum 200%'),
    criticalPercent: z
      .number()
      .int()
      .min(1, 'Minimum 1%')
      .max(200, 'Maksimum 200%'),
    costCenterId: z.string().min(1).optional(),
    subCategoryId: z.string().min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => data.warningPercent < data.criticalPercent, {
    message: 'warningPercent must be less than criticalPercent',
    path: ['warningPercent'],
  })

export const budgetThresholdPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    warningPercent: z.number().int().min(1).max(200).optional(),
    criticalPercent: z.number().int().min(1).max(200).optional(),
    costCenterId: z.string().min(1).nullable().optional(),
    subCategoryId: z.string().min(1).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (
        data.warningPercent !== undefined &&
        data.criticalPercent !== undefined
      ) {
        return data.warningPercent < data.criticalPercent
      }
      return true
    },
    {
      message: 'warningPercent must be less than criticalPercent',
      path: ['warningPercent'],
    }
  )

export const paymentReminderSchema = z.object({
  name: z.string().min(1, 'Nazwa jest wymagana'),
  amount: z.number().min(0, 'Kwota nie może być ujemna'),
  dayOfMonth: z
    .number()
    .int()
    .min(1, 'Minimalnie 1')
    .max(31, 'Maksymalnie 31'),
  costCenterId: z.string().min(1, 'Centrum kosztów jest wymagane'),
  alertDaysInAdvance: z.number().int().min(1).max(30).optional(),
  active: z.boolean().optional(),
})

export const paymentReminderPatchSchema = z.object({
  name: z.string().min(1).optional(),
  amount: z.number().min(0).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  costCenterId: z.string().min(1).optional(),
  alertDaysInAdvance: z.number().int().min(1).max(30).optional(),
  active: z.boolean().optional(),
})

export type BudgetThresholdInput = z.infer<typeof budgetThresholdSchema>
export type PaymentReminderInput = z.infer<typeof paymentReminderSchema>
