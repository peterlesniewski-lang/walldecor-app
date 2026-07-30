import { calcProportionalLeaveDays } from './utils'

export type LeaveEntitlementMode = 'DAYS_20' | 'DAYS_26' | 'CUSTOM'

export interface LeaveEntitlementInput {
  mode: LeaveEntitlementMode
  customAnnualDays: number | null
  employmentFraction: number
  employmentStartDate: Date
  year: number
}

const isValidDate = (date: Date): boolean =>
  date instanceof Date && Number.isFinite(date.getTime())

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
  if (!isValidDate(input.employmentStartDate)) {
    throw new Error('Employment start date must be a valid Date')
  }
  if (!Number.isFinite(input.year) || !Number.isInteger(input.year)) {
    throw new Error('Year must be a finite integer')
  }

  const annualDays = annualDaysForMode(input.mode, input.customAnnualDays)
  const rawBase = annualDays * input.employmentFraction
  const nearestInteger = Math.round(rawBase)
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(rawBase)) * 4
  const normalizedBase =
    Math.abs(rawBase - nearestInteger) <= tolerance ? nearestInteger : rawBase
  const base = Math.ceil(normalizedBase)

  return calcProportionalLeaveDays(input.employmentStartDate, input.year, base)
}

export function selectEffectiveEntitlement<T extends { effectiveFrom: Date }>(
  configs: T[],
  targetDate: Date
): T | null {
  if (!isValidDate(targetDate)) {
    throw new Error('Target date must be a valid Date')
  }

  const targetTime = targetDate.getTime()
  let selected: T | null = null

  for (const config of configs) {
    if (!isValidDate(config.effectiveFrom)) {
      throw new Error('Entitlement effectiveFrom must be a valid Date')
    }

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
