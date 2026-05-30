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

export const ChecklistTemplateItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(3).max(200).trim(),
  description: z.string().max(2000).optional().nullable(),
  order: z.number().int().min(1),
  procedureId: z.string().optional().nullable(),
  defaultOwnerId: z.string().optional().nullable(),
  dueDayOffset: z.number().int().min(-31).max(31).optional().nullable(),
})

export const CreateChecklistTemplateSchema = z.object({
  moduleId: z.string().min(1),
  name: z.string().min(3).max(200).trim(),
  description: z.string().max(2000).optional().nullable(),
  active: z.boolean().default(true),
  items: z.array(ChecklistTemplateItemSchema).default([]),
})

export const UpdateChecklistTemplateSchema = CreateChecklistTemplateSchema.partial().extend({
  items: z.array(ChecklistTemplateItemSchema).optional(),
})

export type CreateChecklistRunInput = z.infer<typeof CreateChecklistRunSchema>
export type UpdateChecklistRunItemInput = z.infer<typeof UpdateChecklistRunItemSchema>
export type CreateChecklistTemplateInput = z.infer<typeof CreateChecklistTemplateSchema>
export type UpdateChecklistTemplateInput = z.infer<typeof UpdateChecklistTemplateSchema>
