import { z } from 'zod'

const id = z.string().trim().min(1).max(120)
const salon = z.enum(['JAG', 'PUL'])
const period = {
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
}
const monthKey = z.string().regex(/^(20[2-9]\d|2100)-(0[1-9]|1[0-2])$/, 'Miesiąc musi mieć format RRRR-MM (2020–2100).')
const money = z.number().finite().refine((value) => Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, 'Kwota może mieć najwyżej dwa miejsca po przecinku.')
const nonnegativeMoney = money.refine((value) => value >= 0, 'Kwota nie może być ujemna.')
const text = z.string().trim().max(240).nullish().transform((value) => value || null)
const nip = z.string().trim().max(40).nullish().transform((value) => value?.replace(/[\s-]/g, '').toUpperCase() || null)
  .refine((value) => value == null || /^[A-Z0-9]{5,24}$/.test(value), 'Wpisz poprawny identyfikator podatkowy dostawcy.')

export const BreakEvenSettingsActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('margin.save'), id: id.optional(), margin: z.number().finite().gt(0).max(1), effectiveFrom: monthKey, note: z.string().trim().max(1000).nullish().transform((value) => value || null) }).strict(),
  z.object({ action: z.literal('margin.delete'), id }).strict(),
  z.object({ action: z.literal('fixed.save'), id: id.optional(), name: z.string().trim().min(1).max(120), costCenterId: salon, expectedNetAmount: nonnegativeMoney, effectiveFrom: monthKey, effectiveTo: monthKey.nullish(), supplierNip: nip, supplierName: text }).strict(),
  z.object({ action: z.literal('fixed.archive'), id }).strict(),
  z.object({ action: z.literal('revenue.save'), ...period, costCenterId: salon, netAmount: nonnegativeMoney }).strict(),
  z.object({ action: z.literal('revenue.delete'), id }).strict(),
  z.object({ action: z.literal('match.save'), ...period, fixedCostId: id, costEventPartId: id, actualNetAmount: money.nullish() }).strict(),
  z.object({ action: z.literal('match.delete'), id }).strict(),
]).superRefine((value, ctx) => {
  if (value.action === 'fixed.save' && value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'Koniec obowiązywania nie może poprzedzać początku.' })
  }
})

export const BreakEvenPeriodQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})
export type BreakEvenSettingsAction = z.infer<typeof BreakEvenSettingsActionSchema>
