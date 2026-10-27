import { describe, expect, it } from 'vitest'
import { dueUrgency } from '@/lib/finance/ksef-due-urgency'

// 2026-10-27 is a Tuesday, so the current week ends on Sunday 2026-11-01.
const TUESDAY = '2026-10-27'

describe('dueUrgency', () => {
  it('should not highlight an invoice without a due date', () => {
    expect(dueUrgency(null, TUESDAY, 'UNPAID').level).toBe(0)
  })
  it('should not highlight a paid invoice even when overdue', () => {
    expect(dueUrgency('2026-10-01', TUESDAY, 'PAID').level).toBe(0)
  })
  it('should not highlight an invoice with unknown payment status', () => {
    expect(dueUrgency('2026-10-28', TUESDAY, 'UNKNOWN').level).toBe(0)
  })
  it('should mark an overdue invoice with the strongest level and the number of days', () => {
    expect(dueUrgency('2026-10-26', TUESDAY, 'UNPAID')).toEqual({ level: 4, daysLeft: -1, label: 'po terminie: 1 dzień' })
  })
  it('should mark an invoice due today', () => {
    expect(dueUrgency('2026-10-27', TUESDAY, 'UNPAID')).toEqual({ level: 3, daysLeft: 0, label: 'dziś' })
  })
  it('should mark an invoice due tomorrow', () => {
    expect(dueUrgency('2026-10-28', TUESDAY, 'UNPAID')).toEqual({ level: 2, daysLeft: 1, label: 'jutro' })
  })
  it('should mark an invoice due in two days', () => {
    expect(dueUrgency('2026-10-29', TUESDAY, 'UNPAID')).toEqual({ level: 2, daysLeft: 2, label: 'za 2 dni' })
  })
  it('should mark the rest of the week with the calmest level', () => {
    expect(dueUrgency('2026-10-30', TUESDAY, 'UNPAID').level).toBe(1)
  })
  it('should include Sunday as the last day of the current week', () => {
    expect(dueUrgency('2026-11-01', TUESDAY, 'UNPAID')).toEqual({ level: 1, daysLeft: 5, label: 'za 5 dni' })
  })
  it('should not highlight next Monday', () => {
    expect(dueUrgency('2026-11-02', TUESDAY, 'UNPAID').level).toBe(0)
  })
  it('should cover the whole week when today is Monday', () => {
    expect(dueUrgency('2026-11-01', '2026-10-26', 'UNPAID').level).toBe(1)
  })
  it('should only highlight today when today is Sunday', () => {
    expect(dueUrgency('2026-11-01', '2026-11-01', 'UNPAID').level).toBe(3)
    expect(dueUrgency('2026-11-02', '2026-11-01', 'UNPAID').level).toBe(0)
  })
  it('should accept a full ISO timestamp as the due date', () => {
    expect(dueUrgency('2026-10-30T00:00:00.000Z', TUESDAY, 'UNPAID').level).toBe(1)
  })
  it('should handle the year boundary', () => {
    expect(dueUrgency('2027-01-01', '2026-12-30', 'UNPAID')).toEqual({ level: 2, daysLeft: 2, label: 'za 2 dni' })
  })
})
