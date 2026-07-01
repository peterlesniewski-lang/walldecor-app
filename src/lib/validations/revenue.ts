import { z } from 'zod'

export const REVENUE_CHANNELS = ['SALON', 'MONTAZ', 'ECOMMERCE'] as const
export type RevenueChannel = (typeof REVENUE_CHANNELS)[number]

export const CHANNEL_LABELS: Record<RevenueChannel, string> = {
  SALON: 'Sprzedaż towaru',
  MONTAZ: 'Montaż',
  ECOMMERCE: 'Ecommerce',
}

// Channels available per cost center
export const COST_CENTER_CHANNELS: Record<string, RevenueChannel[]> = {
  JAG: ['SALON', 'MONTAZ'],
  PUL: ['SALON', 'MONTAZ', 'ECOMMERCE'],
  GLOBAL: [],
}

export const RevenueEntrySchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  costCenterId: z.string().min(1),
  channel: z.enum(REVENUE_CHANNELS),
  amount: z.number().min(0, 'Kwota nie może być ujemna'),
})

export const AreaRevenueEntrySchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  costCenterId: z.enum(['JAG', 'PUL']),
  areaTagId: z.string().min(1),
  amount: z.number().min(0, 'Kwota nie może być ujemna'),
})

export const RevenueQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  costCenterId: z.string().min(1),
})

export type RevenueEntryInput = z.infer<typeof RevenueEntrySchema>
export type AreaRevenueEntryInput = z.infer<typeof AreaRevenueEntrySchema>
