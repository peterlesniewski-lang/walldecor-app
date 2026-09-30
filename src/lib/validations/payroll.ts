import { z } from 'zod'
import { parsePlnToGrosze } from '@/lib/payroll/money'
import { ADJUSTMENT_KINDS, OVERTIME_RESOLUTIONS, PAYROLL_BASES } from '@/lib/payroll/types'

const MAX_GROSZE = 100_000_000

function plnAmount(label: string, options: { allowNegative?: boolean } = {}) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const grosze = parsePlnToGrosze(String(value))
      if (grosze === null || Math.abs(grosze) > MAX_GROSZE || (!options.allowNegative && grosze < 0)) {
        ctx.addIssue({ code: 'custom', message: `${label}: podaj kwotę w PLN (maks. 2 miejsca po przecinku).` })
        return z.NEVER
      }
      return grosze
    })
}

const isoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data w formacie RRRR-MM-DD')
const reason = z.string().trim().min(3, 'Podaj powód (min. 3 znaki).').max(500)
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const expectedRevision = z.number().int().min(1)

export const PayrollBaseSalaryCreateSchema = z.object({
  employeeId: z.string().min(1),
  effectiveFrom: isoDate,
  amount: plnAmount('Podstawa'),
  basis: z.enum(PAYROLL_BASES),
  note: optionalText(500),
}).strict().refine((data) => data.amount > 0, { message: 'Podstawa musi być większa od zera.', path: ['amount'] })

export const PayrollBaseSalaryRevokeSchema = z.object({ reason }).strict()

export const PayrollSettlementCreateSchema = z.object({
  employeeId: z.string().min(1),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Miesiąc w formacie RRRR-MM'),
}).strict()

export const PayrollSettlementActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('calendar.sync'), expectedRevision }).strict(),
  z.object({
    action: z.literal('overtime.resolve'),
    expectedRevision,
    lineId: z.string().min(1),
    resolution: z.enum(OVERTIME_RESOLUTIONS),
  }).strict(),
  z.object({
    action: z.literal('adjustment.add'),
    expectedRevision,
    kind: z.enum(ADJUSTMENT_KINDS),
    label: z.string().trim().min(2).max(120),
    amount: plnAmount('Kwota', { allowNegative: true }),
    note: optionalText(500),
  }).strict(),
  z.object({
    action: z.literal('adjustment.update'),
    expectedRevision,
    adjustmentId: z.string().min(1),
    label: z.string().trim().min(2).max(120),
    amount: plnAmount('Kwota', { allowNegative: true }),
    note: optionalText(500),
    reason,
  }).strict(),
  z.object({
    action: z.literal('adjustment.delete'),
    expectedRevision,
    adjustmentId: z.string().min(1),
    reason,
  }).strict(),
  z.object({
    action: z.literal('payrollOffice.confirm'),
    expectedRevision,
    finalGross: plnAmount('Brutto'),
    finalNet: plnAmount('Netto do wypłaty'),
    employerCost: plnAmount('Pełny koszt pracodawcy'),
    reference: optionalText(200),
  }).strict(),
  z.object({ action: z.literal('approve'), expectedRevision, note: optionalText(500) }).strict(),
  z.object({ action: z.literal('reopen'), expectedRevision, reason }).strict(),
])

export type PayrollSettlementAction = z.infer<typeof PayrollSettlementActionSchema>
