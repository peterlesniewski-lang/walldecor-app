import { describe, expect, it } from 'vitest'
import { dueUrgency } from '@/lib/finance/ksef-due-urgency'

const TODAY = '2026-10-27'

describe('dueUrgency', () => {
  it('should not highlight an invoice without a due date', () => {
    expect(dueUrgency(null, TODAY, 'UNPAID').level).toBe(0)
  })
  it('should not highlight a paid invoice even when overdue', () => {
    expect(dueUrgency('2026-10-01', TODAY, 'PAID').level).toBe(0)
  })
  it('should highlight an invoice with unknown payment status', () => {
    expect(dueUrgency('2026-10-22', TODAY, 'UNKNOWN')).toEqual({ level: 5, daysLeft: -5, label: 'po terminie: 5 dni' })
  })
  it('should highlight a partially paid invoice', () => {
    expect(dueUrgency('2026-10-28', TODAY, 'PARTIAL').level).toBe(3)
  })
  it('should highlight an invoice without payment status', () => {
    expect(dueUrgency('2026-10-28', TODAY).level).toBe(3)
  })
  it('should mark an overdue invoice with the strongest level and the number of days', () => {
    expect(dueUrgency('2026-10-26', TODAY, 'UNPAID')).toEqual({ level: 5, daysLeft: -1, label: 'po terminie: 1 dzień' })
  })
  it('should give today its own level, distinct from overdue and from tomorrow', () => {
    expect(dueUrgency('2026-10-27', TODAY, 'UNPAID')).toEqual({ level: 4, daysLeft: 0, label: 'dziś' })
  })
  it('should mark an invoice due tomorrow', () => {
    expect(dueUrgency('2026-10-28', TODAY, 'UNPAID')).toEqual({ level: 3, daysLeft: 1, label: 'jutro' })
  })
  it('should mark an invoice due in two days as apricot', () => {
    expect(dueUrgency('2026-10-29', TODAY, 'UNPAID')).toEqual({ level: 3, daysLeft: 2, label: 'za 2 dni' })
  })
  it('should mark three to five days as amber', () => {
    expect(dueUrgency('2026-10-30', TODAY, 'UNPAID').level).toBe(2)
    expect(dueUrgency('2026-11-01', TODAY, 'UNPAID').level).toBe(2)
  })
  it('should mark six and seven days as straw', () => {
    expect(dueUrgency('2026-11-02', TODAY, 'UNPAID').level).toBe(1)
    expect(dueUrgency('2026-11-03', TODAY, 'UNPAID')).toEqual({ level: 1, daysLeft: 7, label: 'za 7 dni' })
  })
  it('should not highlight an invoice due in eight days', () => {
    expect(dueUrgency('2026-11-04', TODAY, 'UNPAID').level).toBe(0)
  })
  it('should accept a full ISO timestamp as the due date', () => {
    expect(dueUrgency('2026-10-30T00:00:00.000Z', TODAY, 'UNPAID').level).toBe(2)
  })
  it('should handle the year boundary', () => {
    expect(dueUrgency('2027-01-01', '2026-12-30', 'UNPAID')).toEqual({ level: 3, daysLeft: 2, label: 'za 2 dni' })
  })
})
