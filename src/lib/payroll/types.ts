export const PAYROLL_BASES = ['MONTHLY_GROSS', 'HOURLY_GROSS'] as const
export type PayrollBasis = typeof PAYROLL_BASES[number]

export const PAYROLL_STATUSES = ['DRAFT', 'APPROVED'] as const
export type PayrollStatus = typeof PAYROLL_STATUSES[number]

export const OVERTIME_RESOLUTIONS = ['PAYOUT', 'TIME_OFF'] as const
export type OvertimeResolution = typeof OVERTIME_RESOLUTIONS[number]

export const ADJUSTMENT_KINDS = ['BONUS', 'CORRECTION'] as const
export type AdjustmentKind = typeof ADJUSTMENT_KINDS[number]

export const PAYROLL_BASIS_LABELS: Record<PayrollBasis, string> = {
  MONTHLY_GROSS: 'Miesięczna brutto',
  HOURLY_GROSS: 'Stawka godzinowa brutto',
}
