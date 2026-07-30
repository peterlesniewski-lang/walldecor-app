import { getWarsawBusinessDate } from '@/lib/hr/business-date'

const CANONICAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export interface TimeMutationRow {
  date: string
  clockIn: string
  clockOut: string
  breakMinutes: number
}

export type ValidatedTimeRow =
  | { valid: true; totalMinutes: number; breakMinutes: number }
  | { valid: false; error: string }

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

  if (row.breakMinutes * 60_000 > grossDurationMs) {
    return {
      valid: false,
      error: 'Przerwa nie może być dłuższa niż czas pracy',
    }
  }

  return {
    valid: true,
    totalMinutes: Math.round(grossDurationMs / 60_000),
    breakMinutes: row.breakMinutes,
  }
}
