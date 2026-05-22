import { z } from 'zod'

export const RUN_STATUSES = ['open', 'closed', 'archived'] as const
export const RUN_ITEM_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const

export const CreateChecklistRunSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(3).max(200).trim().optional(),
  periodYear: z.number().int().min(2020).max(2100),
  periodMonth: z.number().int().min(1).max(12).optional(),
})

export const UpdateChecklistRunItemSchema = z.object({
  status: z.enum(RUN_ITEM_STATUSES).optional(),
  note: z.string().max(2000).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
})

export type CreateChecklistRunInput = z.infer<typeof CreateChecklistRunSchema>
export type UpdateChecklistRunItemInput = z.infer<typeof UpdateChecklistRunItemSchema>
