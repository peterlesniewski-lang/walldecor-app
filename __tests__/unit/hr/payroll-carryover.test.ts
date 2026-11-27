import { describe, expect, it } from 'vitest'
import {
  describeCarryoverFlag,
  employmentInPeriod,
  evaluateCarryover,
  isPayAffectingLeave,
  type CarryoverInput,
  type CarryoverSourceVersion,
} from '@/lib/payroll/carryover'
import { calculateEmployerCostGrosze, DEFAULT_EMPLOYER_RATES } from '@/lib/payroll/employer-cost'
import { previousPayrollPeriod, type PayrollPeriod } from '@/lib/payroll/period'
import { validatePayrollOfficeFigures } from '@/lib/payroll/summary'
import { PayrollSheetRowSchema } from '@/lib/validations/payroll'
import {
  CONTRACTOR_WHERE,
  EXTERNAL_CONTRACTOR_EMPLOYMENT_TYPE,
  isExternalContractor,
  STAFF_WHERE,
} from '@/lib/hr/contractors'

// Synthetic amounts only.
const RATES = DEFAULT_EMPLOYER_RATES.UOP
const OCTOBER: PayrollPeriod = { year: 2026, month: 10 }

function source(overrides: Partial<CarryoverSourceVersion> = {}): CarryoverSourceVersion {
  return {
    year: 2026,
    month: 9,
    versionNumber: 1,
    baseSalaryGrosze: 500000,
    baseBasis: 'MONTHLY_GROSS',
    bonusesGrosze: 0,
    correctionsGrosze: 0,
    payoutOvertimeMinutes: 0,
    finalGrossGrosze: 500000,
    finalNetGrosze: 360000,
    employerCostGrosze: calculateEmployerCostGrosze(500000, RATES),
    employerCostSource: 'CALCULATED',
    ...overrides,
  }
}

function input(overrides: Partial<CarryoverInput> = {}): CarryoverInput {
  return {
    period: OCTOBER,
    employee: { startDate: new Date('2025-01-01T00:00:00Z'), endDate: null, employmentType: 'UoP' },
    baseSegments: [{ baseSalaryId: 'base-1', from: '2026-10-01', amountGrosze: 500000, basis: 'MONTHLY_GROSS' }],
    source: source(),
    costContext: { rates: RATES },
    blockers: [],
    payAffectingAbsenceIds: [],
    previousPayAffectingAbsenceIds: [],
    ...overrides,
  }
}

describe('external contractor rule', () => {
  it('should treat a B2B card as an external contractor', () => {
    expect(isExternalContractor({ employmentType: 'B2B' })).toBe(true)
  })

  it('should not treat an empty employment type as a contractor', () => {
    expect([isExternalContractor({ employmentType: null }), isExternalContractor({ employmentType: undefined }), isExternalContractor({ employmentType: '' })])
      .toEqual([false, false, false])
  })

  it('should not treat employees on UoP, UZ or the board as contractors', () => {
    expect(['UoP', 'UZ', 'Zarząd'].map((employmentType) => isExternalContractor({ employmentType }))).toEqual([false, false, false])
  })

  it('should keep cards without an employment type in the staff filter', () => {
    expect(STAFF_WHERE).toEqual({ OR: [{ employmentType: null }, { employmentType: { not: 'B2B' } }] })
  })

  it('should select only B2B cards with the contractor filter', () => {
    expect(CONTRACTOR_WHERE).toEqual({ employmentType: EXTERNAL_CONTRACTOR_EMPLOYMENT_TYPE })
  })
})

describe('pay-affecting absences', () => {
  it.each([
    ['SL', true, true],
    ['ML', true, true],
    ['PL', true, true],
    ['FIL', true, true],
    ['UB', false, true],
    ['UO', false, true],
    ['VL', true, false],
    ['RW', true, false],
  ])('should classify leave %s (isPaid=%s) as pay-affecting=%s', (code, isPaid, expected) => {
    expect(isPayAffectingLeave({ code, isPaid })).toBe(expected)
  })
})

describe('carryover suggestion', () => {
  it('should mark a monthly-salary person with an approved previous month as ready', () => {
    const result = evaluateCarryover(input())
    expect([result.flags, result.autoEligible, result.suggestion?.sourceMonth]).toEqual([[], true, '2026-09'])
  })

  it('should copy gross and net from the source version', () => {
    const { suggestion } = evaluateCarryover(input())
    expect([suggestion?.finalGrossGrosze, suggestion?.finalNetGrosze]).toEqual([500000, 360000])
  })

  it('should recalculate a calculated employer cost from the current rates', () => {
    const newRates = { ...RATES, ppkBp: 150 }
    const { suggestion } = evaluateCarryover(input({ costContext: { rates: newRates } }))
    expect([suggestion?.employerCostGrosze, suggestion?.employerCostSource])
      .toEqual([calculateEmployerCostGrosze(500000, newRates), 'CALCULATED'])
  })

  it('should copy an overridden employer cost as a manual amount', () => {
    const { suggestion } = evaluateCarryover(input({ source: source({ employerCostGrosze: 612345, employerCostSource: 'OVERRIDDEN' }) }))
    expect([suggestion?.employerCostGrosze, suggestion?.employerCostSource]).toEqual([612345, 'OVERRIDDEN'])
  })

  it('should copy a legacy ENTERED employer cost as a manual amount', () => {
    const { suggestion } = evaluateCarryover(input({ source: source({ employerCostGrosze: 598000, employerCostSource: 'ENTERED' }) }))
    expect([suggestion?.employerCostGrosze, suggestion?.employerCostSource]).toEqual([598000, 'OVERRIDDEN'])
  })

  it('should copy a calculated cost as manual when the employment type no longer has rates', () => {
    const { suggestion } = evaluateCarryover(input({ costContext: { rates: null } }))
    expect([suggestion?.employerCostGrosze, suggestion?.employerCostSource])
      .toEqual([calculateEmployerCostGrosze(500000, RATES), 'OVERRIDDEN'])
  })

  it('should return null, not zero, when there is no previous version', () => {
    expect(evaluateCarryover(input({ source: null })).suggestion).toBeNull()
  })

  it('should keep a zero net from the source as zero (missing is null, zero is a value)', () => {
    expect(evaluateCarryover(input({ source: source({ finalNetGrosze: 0 }) })).suggestion?.finalNetGrosze).toBe(0)
  })

  it('should ignore a version that is not from the immediately previous month', () => {
    const result = evaluateCarryover(input({ source: source({ month: 8 }) }))
    expect([result.suggestion, result.flags]).toEqual([null, ['NO_PREVIOUS_MONTH']])
  })

  it('should take January from December of the previous year', () => {
    const result = evaluateCarryover(input({
      period: { year: 2027, month: 1 },
      baseSegments: [{ baseSalaryId: 'base-1', from: '2027-01-01', amountGrosze: 500000, basis: 'MONTHLY_GROSS' }],
      source: source({ year: 2026, month: 12 }),
    }))
    expect([result.suggestion?.sourceMonth, result.autoEligible]).toEqual(['2026-12', true])
  })

  it('should chain suggestions through twelve consecutive months of a full year', () => {
    const months = Array.from({ length: 12 }, (_, index) => ({ year: 2026, month: index + 1 }))
    const sources = months.map((period) => {
      const previous = previousPayrollPeriod(period)
      return evaluateCarryover(input({
        period,
        baseSegments: [{ baseSalaryId: 'base-1', from: `${period.year}-${String(period.month).padStart(2, '0')}-01`, amountGrosze: 500000, basis: 'MONTHLY_GROSS' }],
        source: source({ ...previous }),
      })).suggestion?.sourceMonth
    })
    expect(sources).toEqual([
      '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
      '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
    ])
  })
})

describe('carryover flags (each on its own)', () => {
  it('should flag NO_PREVIOUS_MONTH', () => {
    expect(evaluateCarryover(input({ source: null })).flags).toEqual(['NO_PREVIOUS_MONTH'])
  })

  it('should flag PARTIAL_MONTH for a start within the month (a new starter has no source month)', () => {
    const employee = { startDate: new Date('2026-10-15T00:00:00Z'), endDate: null, employmentType: 'UoP' }
    const result = evaluateCarryover(input({ employee, source: null }))
    expect([result.flags, result.employment]).toEqual([['NO_PREVIOUS_MONTH', 'PARTIAL_MONTH'], { from: '2026-10-15', to: '2026-10-31' }])
  })

  it('should flag PARTIAL_MONTH for an end within the month', () => {
    const result = evaluateCarryover(input({ employee: { startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2026-10-20T00:00:00Z'), employmentType: 'UoP' } }))
    expect([result.flags, result.employment]).toEqual([['PARTIAL_MONTH'], { from: '2026-10-01', to: '2026-10-20' }])
  })

  it('should flag BASE_CHANGED when the salary amount differs from the source month', () => {
    const result = evaluateCarryover(input({ baseSegments: [{ baseSalaryId: 'base-2', from: '2026-10-01', amountGrosze: 550000, basis: 'MONTHLY_GROSS' }] }))
    expect(result.flags).toEqual(['BASE_CHANGED'])
  })

  it('should flag BASE_CHANGED when the salary changes within the month', () => {
    const result = evaluateCarryover(input({
      baseSegments: [
        { baseSalaryId: 'base-1', from: '2026-10-01', amountGrosze: 500000, basis: 'MONTHLY_GROSS' },
        { baseSalaryId: 'base-2', from: '2026-10-16', amountGrosze: 520000, basis: 'MONTHLY_GROSS' },
      ],
    }))
    expect(result.flags).toEqual(['BASE_CHANGED'])
  })

  it('should flag PREVIOUS_HAD_ADJUSTMENTS for a bonus', () => {
    expect(evaluateCarryover(input({ source: source({ bonusesGrosze: 30000 }) })).flags).toEqual(['PREVIOUS_HAD_ADJUSTMENTS'])
  })

  it('should flag PREVIOUS_HAD_ADJUSTMENTS for a negative correction (storno)', () => {
    expect(evaluateCarryover(input({ source: source({ correctionsGrosze: -4000 }) })).flags).toEqual(['PREVIOUS_HAD_ADJUSTMENTS'])
  })

  it('should flag PREVIOUS_HAD_ADJUSTMENTS for paid overtime', () => {
    expect(evaluateCarryover(input({ source: source({ payoutOvertimeMinutes: 90 }) })).flags).toEqual(['PREVIOUS_HAD_ADJUSTMENTS'])
  })

  it('should flag PREVIOUS_MONTH_PARTIAL when the person started during the source month', () => {
    const employee = { startDate: new Date('2026-09-15T00:00:00Z'), endDate: null, employmentType: 'UoP' }
    const result = evaluateCarryover(input({ employee }))
    expect([result.flags, result.autoEligible]).toEqual([['PREVIOUS_MONTH_PARTIAL'], false])
  })

  it('should flag PREVIOUS_HAD_ABSENCE when the source month had a pay-affecting absence', () => {
    const result = evaluateCarryover(input({ previousPayAffectingAbsenceIds: ['leave-1'] }))
    expect([result.flags, result.autoEligible]).toEqual([['PREVIOUS_HAD_ABSENCE'], false])
  })

  it('should not add source-month flags when there is no source version to copy', () => {
    const employee = { startDate: new Date('2026-09-15T00:00:00Z'), endDate: null, employmentType: 'UoP' }
    const result = evaluateCarryover(input({ source: null, employee, previousPayAffectingAbsenceIds: ['leave-1'] }))
    expect(result.flags).toEqual(['NO_PREVIOUS_MONTH'])
  })

  it('should flag PAY_AFFECTING_ABSENCE', () => {
    expect(evaluateCarryover(input({ payAffectingAbsenceIds: ['leave-1'] })).flags).toEqual(['PAY_AFFECTING_ABSENCE'])
  })

  it('should flag HOURLY_BASIS and never mark the row as ready', () => {
    const hourly = { baseSalaryId: 'base-h', from: '2026-10-01', amountGrosze: 5000, basis: 'HOURLY_GROSS' as const }
    // Approved hours present (stage 3): otherwise HOURLY_NO_HOURS would join the flag.
    const result = evaluateCarryover(input({
      baseSegments: [hourly],
      source: source({ baseSalaryGrosze: 5000, baseBasis: 'HOURLY_GROSS' }),
      approvedWorkedMinutes: 600,
    }))
    expect([result.flags, result.autoEligible]).toEqual([['HOURLY_BASIS'], false])
  })

  it('should flag EMPLOYMENT_TYPE_MISSING', () => {
    const result = evaluateCarryover(input({ employee: { startDate: new Date('2025-01-01T00:00:00Z'), endDate: null, employmentType: null } }))
    expect(result.flags).toEqual(['EMPLOYMENT_TYPE_MISSING'])
  })

  it('should not mark a row with a blocker as ready', () => {
    expect(evaluateCarryover(input({ blockers: ['OVERTIME_UNRESOLVED'] })).autoEligible).toBe(false)
  })

  it('should not mark a row without any salary as ready', () => {
    expect(evaluateCarryover(input({ baseSegments: [], blockers: ['BASE_MISSING'] })).autoEligible).toBe(false)
  })
})

describe('carryover flag descriptions', () => {
  const employment = employmentInPeriod({ startDate: new Date('2026-10-15T00:00:00Z'), endDate: null }, OCTOBER)

  it.each([
    ['NO_PREVIOUS_MONTH', 'brak zatwierdzonego września — wpisz kwoty'],
    ['PARTIAL_MONTH', 'niepełny miesiąc — zatrudnienie od 2026-10-15'],
    ['BASE_CHANGED', 'angaż zmienił się od września'],
    ['PREVIOUS_HAD_ABSENCE', 'poprzedni miesiąc zawierał nieobecność zmieniającą wypłatę — sprawdź kwotę'],
    ['PAY_AFFECTING_ABSENCE', 'nieobecność zmieniająca wypłatę — sprawdź kwotę'],
    ['HOURLY_BASIS', 'stawka godzinowa — sprawdź kwotę'],
    ['HOURLY_NO_HOURS', 'brak godzin — sprawdź kwotę'],
    ['EMPLOYMENT_TYPE_MISSING', 'brak rodzaju umowy — uzupełnij w karcie'],
  ] as const)('should describe %s in Polish', (flag, text) => {
    expect(describeCarryoverFlag(flag, { period: OCTOBER, employment })).toBe(text)
  })

  it('should name what the previous month contained', () => {
    expect(describeCarryoverFlag('PREVIOUS_HAD_ADJUSTMENTS', {
      period: OCTOBER,
      employment,
      source: { bonusesGrosze: 100, correctionsGrosze: -50, payoutOvertimeMinutes: 0 },
    })).toBe('poprzedni miesiąc zawierał premię i korektę')
  })

  it('should say from when the previous month was worked', () => {
    const previousEmployment = employmentInPeriod({ startDate: new Date('2026-09-15T00:00:00Z'), endDate: null }, { year: 2026, month: 9 })
    expect(describeCarryoverFlag('PREVIOUS_MONTH_PARTIAL', { period: OCTOBER, employment, previousEmployment }))
      .toBe('poprzedni miesiąc był niepełny (zatrudnienie od 2026-09-15) — sprawdź kwotę')
  })

  it('should name December when describing January', () => {
    expect(describeCarryoverFlag('NO_PREVIOUS_MONTH', { period: { year: 2027, month: 1 }, employment }))
      .toBe('brak zatwierdzonego grudnia — wpisz kwoty')
  })
})

describe('sheet row validation', () => {
  const valid = { employeeId: 'emp-1', finalGross: '6500,50', finalNet: '4700,00' }

  it('should accept amounts written with a decimal comma', () => {
    const parsed = PayrollSheetRowSchema.safeParse(valid)
    expect(parsed.success && [parsed.data.finalGross, parsed.data.finalNet]).toEqual([650050, 470000])
  })

  it('should reject a zero gross', () => {
    expect(PayrollSheetRowSchema.safeParse({ ...valid, finalGross: '0' }).success).toBe(false)
  })

  it('should reject a negative gross', () => {
    expect(PayrollSheetRowSchema.safeParse({ ...valid, finalGross: '-1,00' }).success).toBe(false)
  })

  it('should reject a negative net', () => {
    expect(PayrollSheetRowSchema.safeParse({ ...valid, finalNet: '-0,01' }).success).toBe(false)
  })

  it('should reject a zero manual employer cost', () => {
    expect(PayrollSheetRowSchema.safeParse({ ...valid, employerCost: '0' }).success).toBe(false)
  })

  it('should reject unknown fields', () => {
    expect(PayrollSheetRowSchema.safeParse({ ...valid, status: 'APPROVED' }).success).toBe(false)
  })

  it('should reject a zero employer cost in the payroll office figures', () => {
    expect(validatePayrollOfficeFigures({ employmentType: 'UoP', finalGrossGrosze: 100, finalNetGrosze: 50, employerCostGrosze: 0 }))
      .toBe('Pełny koszt pracodawcy musi być większy od zera.')
  })
})
