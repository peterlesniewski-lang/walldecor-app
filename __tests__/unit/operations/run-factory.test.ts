import { describe, expect, it } from 'vitest'
import {
  assertTemplateHasItems,
  calculateRunProgress,
  createRunItemInputs,
  createRunName,
  getPreviousMonthPeriod,
} from '@/lib/operations/run-factory'

describe('operations run factory', () => {
  const templateItems = [
    {
      id: 'item-cash',
      title: 'Raport miesięczny z kasy fiskalnej',
      description: 'Pobierz raporty dla obu lokalizacji.',
      order: 1,
      procedureId: 'procedure-cash',
      defaultOwnerId: 'user-aleksandra',
    },
    {
      id: 'item-vat',
      title: 'Rejestr VAT sprzedaży',
      description: null,
      order: 2,
      procedureId: 'procedure-vat',
      defaultOwnerId: null,
    },
  ]

  it('rejects creating a run from an empty template', () => {
    expect(() => assertTemplateHasItems([])).toThrow('EMPTY_TEMPLATE')
  })

  it('copies template items into run item create inputs', () => {
    const inputs = createRunItemInputs(templateItems)

    expect(inputs).toEqual([
      {
        templateItemId: 'item-cash',
        title: 'Raport miesięczny z kasy fiskalnej',
        description: 'Pobierz raporty dla obu lokalizacji.',
        order: 1,
        procedureId: 'procedure-cash',
        ownerId: 'user-aleksandra',
        status: 'todo',
      },
      {
        templateItemId: 'item-vat',
        title: 'Rejestr VAT sprzedaży',
        description: null,
        order: 2,
        procedureId: 'procedure-vat',
        ownerId: null,
        status: 'todo',
      },
    ])
  })

  it('calculates progress totals for a run', () => {
    const progress = calculateRunProgress([
      { status: 'done' },
      { status: 'done' },
      { status: 'blocked' },
      { status: 'in_progress' },
      { status: 'todo' },
    ])

    expect(progress).toEqual({
      total: 5,
      done: 2,
      blocked: 1,
      inProgress: 1,
      todo: 1,
      percent: 40,
    })
  })

  it('defaults a month-end run to the previous month', () => {
    expect(getPreviousMonthPeriod(new Date('2026-06-05T12:00:00Z'))).toEqual({
      periodYear: 2026,
      periodMonth: 5,
    })
  })

  it('defaults January month-end work to December of the previous year', () => {
    expect(getPreviousMonthPeriod(new Date('2026-01-05T12:00:00Z'))).toEqual({
      periodYear: 2025,
      periodMonth: 12,
    })
  })

  it('creates a run name from the closing period', () => {
    expect(createRunName('Księgowość - koniec miesiąca', 2026, 5)).toBe(
      'Księgowość - koniec miesiąca - maj 2026'
    )
  })
})
