import { getWarsawBusinessDate } from '@/lib/hr/business-date'

const CANONICAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const WARSAW_TIME_ZONE = 'Europe/Warsaw'
const WARSAW_DATE_TIME_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: WARSAW_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export interface TimeMutationRow {
  date: string
  clockIn: string
  clockOut: string
  breakMinutes: number
}

export type ValidatedTimeRow =
  | { valid: true; totalMinutes: number; breakMinutes: number }
  | { valid: false; error: string }

export interface BatchOvertimeInput {
  date: string
  totalMinutes: number
  breakMinutes: number
  overtimeThresholdMinutes: number
}

export type FillSkipReason =
  | 'existing'
  | 'weekend'
  | 'holiday'
  | 'approved_leave'
  | 'invalid'

export interface FillDayEvaluationInput {
  date: string
  saturdayWorkable: boolean
  isHoliday: boolean
  hasApprovedLeave: boolean
  hasExistingEntry: boolean
  overwrite: boolean
  isValid?: boolean
}

export type FillDayEvaluation =
  | { action: 'create' | 'update' }
  | { action: 'skip'; reason: FillSkipReason }

export function isCanonicalTimeEntryDate(value: string): boolean {
  const match = CANONICAL_DATE_PATTERN.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1000) return false

  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function evaluateFillDay({
  date,
  saturdayWorkable,
  isHoliday,
  hasApprovedLeave,
  hasExistingEntry,
  overwrite,
  isValid = true,
}: FillDayEvaluationInput): FillDayEvaluation {
  if (!isValid || !isCanonicalTimeEntryDate(date)) {
    return { action: 'skip', reason: 'invalid' }
  }

  if (isHoliday) return { action: 'skip', reason: 'holiday' }
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  if (weekday === 0 || (weekday === 6 && !saturdayWorkable)) {
    return { action: 'skip', reason: 'weekend' }
  }
  if (hasApprovedLeave) {
    return { action: 'skip', reason: 'approved_leave' }
  }
  if (hasExistingEntry) {
    return overwrite
      ? { action: 'update' }
      : { action: 'skip', reason: 'existing' }
  }
  return { action: 'create' }
}

function getWarsawOffset(timestamp: number): number {
  const parts = Object.fromEntries(
    WARSAW_DATE_TIME_PARTS
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  )
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  return representedAsUtc - timestamp
}

export function warsawWallClockToIso(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  if (
    !isCanonicalTimeEntryDate(date) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new RangeError('Expected a valid Warsaw date and HH:mm time')
  }

  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const firstPass = wallClockAsUtc - getWarsawOffset(wallClockAsUtc)
  const resolved = wallClockAsUtc - getWarsawOffset(firstPass)
  const result = new Date(resolved)

  if (
    getWarsawBusinessDate(result).isoDate !== date ||
    WARSAW_DATE_TIME_PARTS.formatToParts(result).find((part) => part.type === 'hour')?.value
      !== String(hour).padStart(2, '0') ||
    WARSAW_DATE_TIME_PARTS.formatToParts(result).find((part) => part.type === 'minute')?.value
      !== String(minute).padStart(2, '0')
  ) {
    throw new RangeError('Warsaw wall-clock time does not exist')
  }

  return result.toISOString()
}

export function validateTimeMutationRow(row: TimeMutationRow): ValidatedTimeRow {
  if (!isCanonicalTimeEntryDate(row.date)) {
    return {
      valid: false,
      error: 'Data musi być prawidłowa i używać formatu RRRR-MM-DD',
    }
  }

  const clockIn = new Date(row.clockIn)
  const clockOut = new Date(row.clockOut)
  if (!Number.isFinite(clockIn.getTime()) || !Number.isFinite(clockOut.getTime())) {
    return {
      valid: false,
      error: 'Godziny wejścia i wyjścia muszą być prawidłowymi datami',
    }
  }

  if (
    getWarsawBusinessDate(clockIn).isoDate !== row.date ||
    getWarsawBusinessDate(clockOut).isoDate !== row.date
  ) {
    return {
      valid: false,
      error: 'Godziny muszą przypadać na datę wpisu w strefie Europe/Warsaw',
    }
  }

  const grossDurationMs = clockOut.getTime() - clockIn.getTime()
  if (grossDurationMs <= 0) {
    return {
      valid: false,
      error: 'Godzina wyjścia musi być późniejsza niż wejścia',
    }
  }

  if (
    !Number.isInteger(row.breakMinutes) ||
    row.breakMinutes < 0 ||
    row.breakMinutes > 1440
  ) {
    return {
      valid: false,
      error: 'Przerwa musi być liczbą całkowitą od 0 do 1440 minut',
    }
  }

  const totalMinutes = Math.round(grossDurationMs / 60_000)
  if (row.breakMinutes > totalMinutes) {
    return {
      valid: false,
      error: 'Przerwa nie może być dłuższa niż czas pracy',
    }
  }

  return {
    valid: true,
    totalMinutes,
    breakMinutes: row.breakMinutes,
  }
}

export function calculateBatchOvertimeMinutes({
  date,
  totalMinutes,
  breakMinutes,
  overtimeThresholdMinutes,
}: BatchOvertimeInput): number {
  const [year, month, day] = date.split('-').map(Number)
  const isSaturday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 6
  const netMinutes = Math.max(0, totalMinutes - breakMinutes)

  return isSaturday
    ? netMinutes
    : Math.max(0, netMinutes - overtimeThresholdMinutes)
}
