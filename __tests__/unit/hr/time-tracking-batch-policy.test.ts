import { describe, expect, it } from 'vitest'
import {
  calculateBatchOvertimeMinutes,
  validateTimeMutationRow,
} from '@/lib/hr/time-tracking/batch-policy'

describe('validateTimeMutationRow', () => {
  it('rejects clock-out before clock-in', () => {
    expect(validateTimeMutationRow({
      date: '2026-07-02',
      clockIn: '2026-07-02T16:00:00.000Z',
      clockOut: '2026-07-02T08:00:00.000Z',
      breakMinutes: 0,
    })).toEqual({
      valid: false,
      error: 'Godzina wyjścia musi być późniejsza niż wejścia',
    })
  })

  it('calculates gross total minutes and preserves break minutes', () => {
    expect(validateTimeMutationRow({
      date: '2026-07-02',
      clockIn: '2026-07-02T06:00:00.000Z',
      clockOut: '2026-07-02T14:00:00.000Z',
      breakMinutes: 30,
    })).toEqual({
      valid: true,
      totalMinutes: 480,
      breakMinutes: 30,
    })
  })

  it.each([
    '0999-12-31',
    '2026-02-29',
    '2026-2-03',
    '2026-02-03extra',
  ])('rejects non-canonical calendar date %s', (date) => {
    expect(validateTimeMutationRow({
      date,
      clockIn: '2026-02-03T08:00:00.000Z',
      clockOut: '2026-02-03T16:00:00.000Z',
      breakMinutes: 0,
    })).toEqual({
      valid: false,
      error: 'Data musi być prawidłowa i używać formatu RRRR-MM-DD',
    })
  })

  it('accepts year 1000 as the lower supported boundary', () => {
    expect(validateTimeMutationRow({
      date: '1000-01-01',
      clockIn: '1000-01-01T08:00:00.000Z',
      clockOut: '1000-01-01T16:00:00.000Z',
      breakMinutes: 0,
    })).toMatchObject({ valid: true, totalMinutes: 480 })
  })

  it('matches timestamps to the Warsaw business date across a UTC date boundary', () => {
    expect(validateTimeMutationRow({
      date: '2026-07-02',
      clockIn: '2026-07-01T22:15:00.000Z',
      clockOut: '2026-07-02T06:15:00.000Z',
      breakMinutes: 0,
    })).toMatchObject({ valid: true, totalMinutes: 480 })
  })

  it('rejects a timestamp outside the row Warsaw business date', () => {
    expect(validateTimeMutationRow({
      date: '2026-07-02',
      clockIn: '2026-07-01T21:59:59.999Z',
      clockOut: '2026-07-02T06:00:00.000Z',
      breakMinutes: 0,
    })).toEqual({
      valid: false,
      error: 'Godziny muszą przypadać na datę wpisu w strefie Europe/Warsaw',
    })
  })

  it('rejects invalid timestamps', () => {
    expect(validateTimeMutationRow({
      date: '2026-07-02',
      clockIn: 'not-a-date',
      clockOut: '2026-07-02T16:00:00.000Z',
      breakMinutes: 0,
    })).toEqual({
      valid: false,
      error: 'Godziny wejścia i wyjścia muszą być prawidłowymi datami',
    })
  })

  it('rejects a break longer than the gross duration', () => {
    expect(validateTimeMutationRow({
      date: '2026-07-02',
      clockIn: '2026-07-02T08:00:00.000Z',
      clockOut: '2026-07-02T09:00:00.000Z',
      breakMinutes: 61,
    })).toEqual({
      valid: false,
      error: 'Przerwa nie może być dłuższa niż czas pracy',
    })
  })

  it('accepts a break equal to the rounded total minutes', () => {
    expect(validateTimeMutationRow({
      date: '2026-07-02',
      clockIn: '2026-07-02T08:00:00.000Z',
      clockOut: '2026-07-02T08:00:30.000Z',
      breakMinutes: 1,
    })).toEqual({
      valid: true,
      totalMinutes: 1,
      breakMinutes: 1,
    })
  })

  it('rejects a break just over the rounded total minutes', () => {
    expect(validateTimeMutationRow({
      date: '2026-07-02',
      clockIn: '2026-07-02T08:00:00.000Z',
      clockOut: '2026-07-02T08:00:30.000Z',
      breakMinutes: 2,
    })).toEqual({
      valid: false,
      error: 'Przerwa nie może być dłuższa niż czas pracy',
    })
  })

  it('uses 60 elapsed minutes across the Warsaw spring DST jump', () => {
    expect(validateTimeMutationRow({
      date: '2026-03-29',
      clockIn: '2026-03-29T00:30:00.000Z',
      clockOut: '2026-03-29T01:30:00.000Z',
      breakMinutes: 0,
    })).toEqual({
      valid: true,
      totalMinutes: 60,
      breakMinutes: 0,
    })
  })

  it('uses 120 elapsed minutes across the Warsaw fall DST overlap', () => {
    expect(validateTimeMutationRow({
      date: '2026-10-25',
      clockIn: '2026-10-25T00:30:00.000Z',
      clockOut: '2026-10-25T02:30:00.000Z',
      breakMinutes: 0,
    })).toEqual({
      valid: true,
      totalMinutes: 120,
      breakMinutes: 0,
    })
  })
})

describe('calculateBatchOvertimeMinutes', () => {
  it('uses rounded gross minus break against the configured weekday threshold', () => {
    expect(calculateBatchOvertimeMinutes({
      date: '2026-07-03',
      totalMinutes: 511,
      breakMinutes: 30,
      overtimeThresholdMinutes: 480,
    })).toBe(1)
  })

  it('counts all net Saturday minutes as overtime', () => {
    expect(calculateBatchOvertimeMinutes({
      date: '2026-07-04',
      totalMinutes: 480,
      breakMinutes: 30,
      overtimeThresholdMinutes: 480,
    })).toBe(450)
  })
})
