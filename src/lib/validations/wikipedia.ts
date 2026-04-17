import { z } from 'zod'

export const CATEGORIES = [
  'management',
  'finance',
  'sales',
  'marketing',
  'processes',
  'psychology',
  'strategy',
  'company',
] as const

export const TYPES = ['knowledge', 'procedure', 'note'] as const
export const VISIBILITIES = ['manager', 'public'] as const

export const ArticleCreateSchema = z.object({
  title: z.string().min(3).max(200).trim(),
  slug: z.string().min(3).max(200).trim().regex(/^[a-z0-9-]+$/, 'Slug może zawierać tylko małe litery, cyfry i myślniki'),
  content: z.string().min(10),
  category: z.enum(CATEGORIES),
  visibility: z.enum(VISIBILITIES).default('manager'),
  type: z.enum(TYPES).default('knowledge'),
  tags: z.array(z.string()).default([]),
  authorNote: z.string().optional().nullable(),
})

export const ArticleUpdateSchema = ArticleCreateSchema.partial().omit({ slug: true })

export const ArticleQuerySchema = z.object({
  category: z.enum([...CATEGORIES, 'all']).optional(),
  type: z.enum([...TYPES, 'all']).optional(),
  q: z.string().optional(),
})

export const AuthorNoteSchema = z.object({
  note: z.string().max(2000),
})

export type ArticleCreateInput = z.infer<typeof ArticleCreateSchema>
export type ArticleUpdateInput = z.infer<typeof ArticleUpdateSchema>
export type ArticleQuery = z.infer<typeof ArticleQuerySchema>
