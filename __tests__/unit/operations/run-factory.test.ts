import { describe, expect, it } from 'vitest'
import {
  assertTemplateHasItems,
  buildRunItemsFromPreviousRun,
  calculateRunProgress,
  createRunItemInputs,
  createRunName,
  findRunForPeriod,
  getNextOpenItem,
  getPreviousMonthPeriod,
  getRunDisplayStatus,
  isPermutationOf,
  isReadyToClose,
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

describe('month closing helpers', () => {
  const previousItems = [
    { templateItemId: 't3', title: 'Rejestr VAT', description: null, order: 3, procedureId: 'p-vat', ownerId: null, recurring: true },
    { templateItemId: 't1', title: 'Raport z kasy', description: 'Obie lokalizacje', order: 1, procedureId: null, ownerId: 'u1', recurring: true },
    { templateItemId: null, title: 'Faktura od nowego dostawcy', description: null, order: 2, procedureId: null, ownerId: null, recurring: false },
  ]

  it('copies only recurring tasks from the previous run, renumbered from 1', () => {
    const inputs = buildRunItemsFromPreviousRun(previousItems)

    expect(inputs.map((item) => [item.order, item.title])).toEqual([
      [1, 'Raport z kasy'],
      [2, 'Rejestr VAT'],
    ])
  })

  // Rows as they come back from Prisma: they carry more fields than PreviousRunItem declares.
  // Built through a variable so TypeScript's excess-property check does not hide a leaky copy.
  const finishedDatabaseRow = {
    id: 'row-1',
    runId: 'run-9',
    templateItemId: 't3',
    title: 'Rejestr VAT',
    description: 'Wszystkie lokalizacje',
    order: 3,
    procedureId: 'p-vat',
    ownerId: 'u2',
    recurring: true,
    status: 'done',
    note: 'Wysłane do księgowej',
    completedAt: new Date('2026-09-30T10:00:00Z'),
  }

  it('resets status, note and completion when copying a task', () => {
    const [copied] = buildRunItemsFromPreviousRun([finishedDatabaseRow])

    expect(copied).toEqual({
      templateItemId: 't3',
      title: 'Rejestr VAT',
      description: 'Wszystkie lokalizacje',
      order: 1,
      procedureId: 'p-vat',
      ownerId: 'u2',
      status: 'todo',
      recurring: true,
    })
  })

  it('keeps owner and procedure when copying a task', () => {
    const [copied] = buildRunItemsFromPreviousRun([finishedDatabaseRow])

    expect([copied.ownerId, copied.procedureId]).toEqual(['u2', 'p-vat'])
  })

  it('copies a recurring ad-hoc task without a template item', () => {
    const [copied] = buildRunItemsFromPreviousRun([{ ...finishedDatabaseRow, templateItemId: null }])

    expect(copied.templateItemId).toBeNull()
  })

  it('returns an empty list when no task of the previous run repeats', () => {
    expect(buildRunItemsFromPreviousRun([{ ...previousItems[0], recurring: false }])).toEqual([])
  })

  it('does not mutate the previous run items', () => {
    const snapshot = JSON.stringify(previousItems)
    buildRunItemsFromPreviousRun(previousItems)
    expect(JSON.stringify(previousItems)).toBe(snapshot)
  })

  it('is not ready to close when the run has no tasks', () => {
    expect(isReadyToClose([])).toBe(false)
  })

  it('is not ready to close when some task is not done', () => {
    expect(isReadyToClose([{ status: 'done' }, { status: 'in_progress' }])).toBe(false)
  })

  it('is ready to close when every task is done', () => {
    expect(isReadyToClose([{ status: 'done' }, { status: 'done' }])).toBe(true)
  })

  it('shows "ready" for an open run with every task done', () => {
    expect(getRunDisplayStatus('open', [{ status: 'done' }])).toBe('ready')
  })

  it('keeps the stored status for a closed run even when every task is done', () => {
    expect(getRunDisplayStatus('closed', [{ status: 'done' }])).toBe('closed')
  })

  it('keeps "open" for an open run with a task that is not done', () => {
    expect(getRunDisplayStatus('open', [{ status: 'done' }, { status: 'todo' }])).toBe('open')
  })

  it('keeps "open" for an open run without any tasks', () => {
    expect(getRunDisplayStatus('open', [])).toBe('open')
  })

  it('finds the first task that is not done, by order', () => {
    const next = getNextOpenItem([
      { title: 'C', order: 3, status: 'todo' },
      { title: 'A', order: 1, status: 'done' },
      { title: 'B', order: 2, status: 'blocked' },
    ])

    expect(next?.title).toBe('B')
  })

  it('returns null as next task when everything is done', () => {
    expect(getNextOpenItem([{ title: 'A', order: 1, status: 'done' }])).toBeNull()
  })

  it('finds the run for a template and period', () => {
    const runs = [
      { id: 'x', templateId: 'other', periodYear: 2026, periodMonth: 9 },
      { id: 'a', templateId: 't', periodYear: 2026, periodMonth: 8 },
      { id: 'b', templateId: 't', periodYear: 2026, periodMonth: 9 },
    ]

    expect(findRunForPeriod(runs, 't', { periodYear: 2026, periodMonth: 9 })?.id).toBe('b')
  })

  it('does not match a yearly run without a month to a monthly period', () => {
    const runs = [{ id: 'a', templateId: 't', periodYear: 2026, periodMonth: null }]

    expect(findRunForPeriod(runs, 't', { periodYear: 2026, periodMonth: 9 })).toBeUndefined()
  })

  it('does not find a run for the previous December in January', () => {
    const runs = [{ id: 'a', templateId: 't', periodYear: 2026, periodMonth: 12 }]

    expect(findRunForPeriod(runs, 't', { periodYear: 2025, periodMonth: 12 })).toBeUndefined()
  })

  it('accepts a reordered list of the same ids as a permutation', () => {
    expect(isPermutationOf(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true)
  })

  it('rejects an order list with a missing id', () => {
    expect(isPermutationOf(['a', 'b', 'c'], ['a', 'b'])).toBe(false)
  })

  it('rejects an order list with a duplicated id', () => {
    expect(isPermutationOf(['a', 'b'], ['a', 'a'])).toBe(false)
  })

  it('rejects an order list with an unknown id', () => {
    expect(isPermutationOf(['a', 'b'], ['a', 'x'])).toBe(false)
  })
})
