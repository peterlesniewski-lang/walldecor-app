import { calcProportionalLeaveDays } from './utils'

export type LeaveEntitlementMode = 'DAYS_20' | 'DAYS_26' | 'CUSTOM'

export interface LeaveEntitlementInput {
  mode: LeaveEntitlementMode
  customAnnualDays: number | null
  employmentFraction: number
  employmentStartDate: Date
  year: number
}

export function annualDaysForMode(
  mode: LeaveEntitlementMode,
  customAnnualDays: number | null
): number {
  if (mode === 'DAYS_20') return 20
  if (mode === 'DAYS_26') return 26

  if (
    !Number.isInteger(customAnnualDays) ||
    customAnnualDays === null ||
    customAnnualDays < 1 ||
    customAnnualDays > 365
  ) {
    throw new Error('Custom annual leave days must be an integer from 1 to 365')
  }

  return customAnnualDays
}

export function calculateConfiguredEntitlement(input: LeaveEntitlementInput): number {
  if (!(input.employmentFraction > 0 && input.employmentFraction <= 1)) {
    throw new Error('Employment fraction must be greater than 0 and at most 1')
  }

  const annualDays = annualDaysForMode(input.mode, input.customAnnualDays)
  const base = Math.ceil(annualDays * input.employmentFraction)

  return calcProportionalLeaveDays(input.employmentStartDate, input.year, base)
}

export function selectEffectiveEntitlement<T extends { effectiveFrom: Date }>(
  configs: T[],
  targetDate: Date
): T | null {
  const targetTime = targetDate.getTime()
  let selected: T | null = null

  for (const config of configs) {
    const effectiveTime = config.effectiveFrom.getTime()
    if (
      effectiveTime <= targetTime &&
      (selected === null || effectiveTime > selected.effectiveFrom.getTime())
    ) {
      selected = config
    }
  }

  return selected
}
