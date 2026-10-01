import { z } from 'zod'
import { parsePlnToGrosze } from '@/lib/payroll/money'

const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Miesiąc w formacie RRRR-MM')
const amount = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const grosze = parsePlnToGrosze(String(value))
  if (grosze === null || grosze < 0 || grosze > 100_000_000) {
    ctx.addIssue({ code: 'custom', message: 'Kwota: podaj PLN, np. 3000,00 lub 3.000,00.' })
    return z.NEVER
  }
  return grosze
})
const jagPercent = z.number().int().min(0).max(100)
const text = (min: number, max: number) => z.string().trim().min(min).max(max)

export const CostContractCreateSchema = z.object({
  counterparty: text(2, 200),
  description: text(2, 500),
  startMonth: monthKey,
  endMonth: monthKey.nullish(),
  amount,
  jagPercent,
  isConfidential: z.boolean(),
}).strict().refine((data) => !data.endMonth || data.endMonth >= data.startMonth, {
  message: 'Koniec umowy nie może być przed jej początkiem.', path: ['endMonth'],
})

export const CostContractActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    counterparty: text(2, 200),
    description: text(2, 500),
    endMonth: monthKey.nullable(),
    isConfidential: z.boolean(),
  }).strict(),
  z.object({ action: z.literal('amount.add'), effectiveFrom: monthKey, amount }).strict(),
  z.object({ action: z.literal('amount.revoke'), amountId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('split.add'), effectiveFrom: monthKey, jagPercent }).strict(),
  z.object({ action: z.literal('split.revoke'), splitId: z.string().min(1) }).strict(),
])

export type CostContractCreate = z.infer<typeof CostContractCreateSchema>
export type CostContractAction = z.infer<typeof CostContractActionSchema>
