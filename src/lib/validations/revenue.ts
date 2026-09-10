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
  costCenterId: z.enum(['JAG', 'PUL']),
  channel: z.enum(REVENUE_CHANNELS),
  amount: z.number().finite('Wpisz poprawną kwotę brutto').refine(
    (value) => Number.isSafeInteger(Math.round(value * 100)), 'Kwota jest zbyt duża',
  ),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data musi mieć format RRRR-MM-DD')
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`)
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    }, 'Wpisz istniejącą datę').nullish(),
}).superRefine((entry, ctx) => {
  if (!COST_CENTER_CHANNELS[entry.costCenterId]?.includes(entry.channel)) {
    ctx.addIssue({ code: 'custom', path: ['channel'], message: 'Kanał nie jest dostępny dla tego salonu' })
  }
  if (entry.asOfDate) {
    const month = `${entry.year}-${String(entry.month).padStart(2, '0')}`
    if (!entry.asOfDate.startsWith(`${month}-`)) {
      ctx.addIssue({ code: 'custom', path: ['asOfDate'], message: 'Stan na dzień musi należeć do wybranego miesiąca' })
    }
    if (entry.asOfDate > revenueWarsawToday()) {
      ctx.addIssue({ code: 'custom', path: ['asOfDate'], message: 'Stan na dzień nie może być z przyszłości' })
    }
  }
})

/** A date of revenue coverage, not the time at which the record was saved. */
export function revenueWarsawToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Blank and malformed values remain invalid; never turn them into explicit zero. */
export function parseRevenueAmount(value: string): number {
  const normalized = value.trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  return /^[+-]?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN
}

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
