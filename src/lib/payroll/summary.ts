import type { AdjustmentKind, OvertimeResolution, PayrollBasis } from './types'

export type SummaryLine = {
  overtimeMinutes: number
  entryStatus: string
  resolution: string | null
}

export type SummaryAdjustment = {
  kind: string
  amountGrosze: number
  deletedAt: Date | null
}

export type SummaryInput = {
  baseSalaryGrosze: number | null
  baseBasis: string | null
  baseSegmentCount: number
  pendingEntryCount: number
  openEntryCount: number
  calendarInSync: boolean
  payrollOfficeConfirmedAt: Date | null
  lines: SummaryLine[]
  adjustments: SummaryAdjustment[]
  /** Employee sits in GLOBAL without a JAG/PUL split, so the cost cannot reach a salon. */
  costSplitMissing?: boolean
  /** A calculated employer cost no longer matches current rates or exemptions. */
  employerCostStale?: boolean
}

export type PayrollBlocker =
  | 'BASE_MISSING'
  | 'CALENDAR_OUT_OF_SYNC'
  | 'OVERTIME_PENDING_APPROVAL'
  | 'OVERTIME_UNRESOLVED'
  | 'HOURLY_ENTRIES_PENDING'
  | 'OPEN_TIME_ENTRY'
  | 'PAYROLL_OFFICE_NOT_CONFIRMED'
  | 'COST_SPLIT_MISSING'
  | 'EMPLOYER_COST_STALE'

export type PayrollWarning = 'BASE_CHANGED_MID_MONTH' | 'NON_OVERTIME_ENTRIES_PENDING'

export const BLOCKER_LABELS: Record<PayrollBlocker, string> = {
  BASE_MISSING: 'Brak podstawy wynagrodzenia obowiązującej w tym miesiącu.',
  CALENDAR_OUT_OF_SYNC: 'Kalendarz HR lub podstawa zmieniły się od ostatniego pobrania — odśwież dane.',
  OVERTIME_PENDING_APPROVAL: 'Są nadgodziny w kalendarzu, które nie zostały zatwierdzone przez przełożonego.',
  OVERTIME_UNRESOLVED: 'Nie wszystkie zatwierdzone nadgodziny mają wskazane: wypłata czy czas wolny.',
  HOURLY_ENTRIES_PENDING: 'Stawka godzinowa: w kalendarzu są niezatwierdzone wpisy czasu pracy.',
  OPEN_TIME_ENTRY: 'W kalendarzu jest otwarty wpis (brak wyjścia).',
  PAYROLL_OFFICE_NOT_CONFIRMED: 'Brak potwierdzonych danych od kadrowej (brutto i netto).',
  COST_SPLIT_MISSING: 'Pracownik jest przypisany do GLOBAL — ustaw w karcie podział kosztu na salony JAG/PUL.',
  EMPLOYER_COST_STALE: 'Stawki lub zwolnienia zmieniły się po potwierdzeniu danych kadrowej — potwierdź je ponownie.',
}

export const WARNING_LABELS: Record<PayrollWarning, string> = {
  BASE_CHANGED_MID_MONTH: 'Podstawa zmienia się w trakcie miesiąca — kadrowa musi rozliczyć proporcję.',
  NON_OVERTIME_ENTRIES_PENDING: 'Część wpisów czasu pracy w kalendarzu czeka na zatwierdzenie.',
}

export type SettlementSummary = {
  bonusesGrosze: number
  correctionsGrosze: number
  payoutOvertimeMinutes: number
  timeOffOvertimeMinutes: number
  pendingOvertimeMinutes: number
  rejectedOvertimeMinutes: number
  unresolvedOvertimeMinutes: number
  /** Inputs sent to the payroll office; blockers except the confirmation itself. */
  inputBlockers: PayrollBlocker[]
  /** Everything that must be clear before approval. */
  approvalBlockers: PayrollBlocker[]
  warnings: PayrollWarning[]
}

function sumBy<T>(items: T[], pick: (item: T) => number) {
  return items.reduce((total, item) => total + pick(item), 0)
}

export function summarizeSettlement(input: SummaryInput): SettlementSummary {
  const active = input.adjustments.filter((adjustment) => adjustment.deletedAt === null)
  const byKind = (kind: AdjustmentKind) => sumBy(active.filter((a) => a.kind === kind), (a) => a.amountGrosze)
  const approved = input.lines.filter((line) => line.entryStatus === 'approved')
  const minutes = (lines: SummaryLine[]) => sumBy(lines, (line) => line.overtimeMinutes)
  const withResolution = (resolution: OvertimeResolution) => approved.filter((line) => line.resolution === resolution)

  const pendingOvertimeMinutes = minutes(input.lines.filter((line) => line.entryStatus === 'pending'))
  const unresolvedOvertimeMinutes = minutes(approved.filter((line) => !line.resolution))
  const isHourly = (input.baseBasis as PayrollBasis | null) === 'HOURLY_GROSS'

  const inputBlockers: PayrollBlocker[] = []
  if (input.baseSalaryGrosze === null) inputBlockers.push('BASE_MISSING')
  if (!input.calendarInSync) inputBlockers.push('CALENDAR_OUT_OF_SYNC')
  if (pendingOvertimeMinutes > 0) inputBlockers.push('OVERTIME_PENDING_APPROVAL')
  if (unresolvedOvertimeMinutes > 0) inputBlockers.push('OVERTIME_UNRESOLVED')
  if (isHourly && input.pendingEntryCount > 0) inputBlockers.push('HOURLY_ENTRIES_PENDING')
  if (input.openEntryCount > 0) inputBlockers.push('OPEN_TIME_ENTRY')

  const warnings: PayrollWarning[] = []
  if (input.baseSegmentCount > 1) warnings.push('BASE_CHANGED_MID_MONTH')
  const pendingOvertimeLines = input.lines.filter((line) => line.entryStatus === 'pending').length
  if (!isHourly && input.pendingEntryCount > pendingOvertimeLines) warnings.push('NON_OVERTIME_ENTRIES_PENDING')

  return {
    bonusesGrosze: byKind('BONUS'),
    correctionsGrosze: byKind('CORRECTION'),
    payoutOvertimeMinutes: minutes(withResolution('PAYOUT')),
    timeOffOvertimeMinutes: minutes(withResolution('TIME_OFF')),
    pendingOvertimeMinutes,
    rejectedOvertimeMinutes: minutes(input.lines.filter((line) => line.entryStatus === 'rejected')),
    unresolvedOvertimeMinutes,
    inputBlockers,
    approvalBlockers: [
      ...inputBlockers,
      ...(input.payrollOfficeConfirmedAt ? [] : ['PAYROLL_OFFICE_NOT_CONFIRMED' as const]),
      ...(input.costSplitMissing ? ['COST_SPLIT_MISSING' as const] : []),
      ...(input.employerCostStale ? ['EMPLOYER_COST_STALE' as const] : []),
    ],
    warnings,
  }
}

/** Validates the payroll office figures together with the calculated or overridden employer cost. */
export function validatePayrollOfficeFigures(input: {
  employmentType: string | null
  finalGrossGrosze: number
  finalNetGrosze: number
  employerCostGrosze: number
}): string | null {
  if (input.finalGrossGrosze <= 0) return 'Brutto musi być większe od zera.'
  if (input.finalNetGrosze < 0) return 'Netto nie może być ujemne.'
  if (input.finalNetGrosze > input.finalGrossGrosze) return 'Netto do wypłaty nie może przekraczać brutto.'
  if (input.employerCostGrosze <= 0) return 'Pełny koszt pracodawcy musi być większy od zera.'
  // For B2B the company cost may be below the invoice gross (recoverable VAT); for other
  // contract types employer contributions come on top of gross, never below it.
  if (input.employmentType !== 'B2B' && input.employerCostGrosze < input.finalGrossGrosze) {
    return 'Pełny koszt pracodawcy nie może być niższy od brutto (poza B2B). Sprawdź dane od kadrowej.'
  }
  return null
}
