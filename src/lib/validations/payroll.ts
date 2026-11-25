import { z } from 'zod'
import { parsePlnToGrosze } from '@/lib/payroll/money'
import { ADJUSTMENT_KINDS, OVERTIME_RESOLUTIONS, PAYROLL_BASES } from '@/lib/payroll/types'
import { PAYROLL_SETTLEMENT_TYPES } from '@/lib/payroll/employer-cost'

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
    // Omitted → calculated from gross and employer rates; given → an explicit override.
    employerCost: plnAmount('Pełny koszt pracodawcy').nullish(),
    reference: optionalText(200),
  }).strict(),
  z.object({ action: z.literal('approve'), expectedRevision, note: optionalText(500) }).strict(),
  z.object({ action: z.literal('reopen'), expectedRevision, reason }).strict(),
])

export type PayrollSettlementAction = z.infer<typeof PayrollSettlementActionSchema>

// ─── Employer cost settings ──────────────────────────────────────────────────

const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Miesiąc w formacie RRRR-MM')

/** "9,76" (percent, max 2 decimals) → 976 basis points. */
function percentRate(label: string) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const basisPoints = parsePlnToGrosze(String(value))
      if (basisPoints === null || basisPoints < 0 || basisPoints > 5_000) {
        ctx.addIssue({ code: 'custom', message: `${label}: podaj procent od 0 do 50 (maks. 2 miejsca po przecinku).` })
        return z.NEVER
      }
      return basisPoints
    })
}

export const PayrollEmployerRateCreateSchema = z.object({
  settlementType: z.enum(PAYROLL_SETTLEMENT_TYPES),
  effectiveFrom: monthKey,
  pension: percentRate('Emerytalna'),
  disability: percentRate('Rentowa'),
  accident: percentRate('Wypadkowa'),
  labourFund: percentRate('Fundusz Pracy'),
  guaranteeFund: percentRate('FGŚP'),
  ppk: percentRate('PPK'),
  note: optionalText(500),
}).strict()

export const PayrollCostProfileSchema = z.object({
  employeeId: z.string().min(1),
  withoutFunds: z.boolean(),
  withoutContributions: z.boolean(),
}).strict()

export const PayrollCostSplitCreateSchema = z.object({
  employeeId: z.string().min(1),
  effectiveFrom: monthKey,
  jagPercent: z.number().int().min(0).max(100),
}).strict()

export const PayrollRevokeSchema = z.object({ reason }).strict()

// ─── Month sheet ─────────────────────────────────────────────────────────────

/** One row of the month sheet; validated separately so one bad row is reported as INVALID alone. */
export const PayrollSheetRowSchema = z.object({
  employeeId: z.string().min(1),
  finalGross: plnAmount('Brutto'),
  finalNet: plnAmount('Netto do wypłaty'),
  // Omitted → calculated on the server from gross and current rates; given → manual override.
  employerCost: plnAmount('Pełny koszt pracodawcy').nullish(),
  // The settlement revision the sheet showed; omitted when the row had no settlement yet.
  expectedRevision: expectedRevision.nullish(),
}).strict()
  .refine((row) => row.finalGross > 0, { message: 'Brutto musi być większe od zera.', path: ['finalGross'] })
  .refine((row) => row.employerCost == null || row.employerCost > 0, {
    message: 'Pełny koszt pracodawcy musi być większy od zera.',
    path: ['employerCost'],
  })

export type PayrollSheetRowInput = z.infer<typeof PayrollSheetRowSchema>

export const PayrollSheetSubmitSchema = z.object({
  month: monthKey,
  rows: z.array(z.unknown()).min(1, 'Wybierz co najmniej jeden wiersz.').max(300),
}).strict()

export const PayrollMonthUpdateSchema = z.object({
  listReference: optionalText(200),
}).strict()

/** The payroll automat switch (ADMIN). Enabling never runs the current month (D10). */
export const PayrollAutomationUpdateSchema = z.object({
  enabled: z.boolean(),
}).strict()

/** "Kwota aktualna": the signature of the change after approval the ADMIN saw on the sheet. */
export const PayrollChangesAcknowledgeSchema = z.object({
  signature: z.string().regex(/^[0-9a-f]{64}$/, 'Nieprawidłowa sygnatura zmiany.'),
}).strict()

/** "Zatwierdź godziny" on the sheet: every waiting time entry of one hourly person in the month. */
export const PayrollApproveHoursSchema = z.object({
  employeeId: z.string().min(1),
  month: monthKey,
}).strict()
