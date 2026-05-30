import { describe, expect, it } from 'vitest'
import { normalizeTemplateItems } from '@/lib/operations/template-items'

describe('operations template items', () => {
  it('normalizes item order and optional empty values before saving', () => {
    const items = normalizeTemplateItems([
      {
        title: '  Drugi krok  ',
        description: '',
        order: 20,
        procedureId: '',
        defaultOwnerId: '',
        dueDayOffset: null,
      },
      {
        title: 'Pierwszy krok',
        description: '  Instrukcja  ',
        order: 10,
        procedureId: 'procedure-1',
        defaultOwnerId: 'user-1',
        dueDayOffset: 2,
      },
    ])

    expect(items).toEqual([
      {
        title: 'Pierwszy krok',
        description: 'Instrukcja',
        order: 1,
        procedureId: 'procedure-1',
        defaultOwnerId: 'user-1',
        dueDayOffset: 2,
      },
      {
        title: 'Drugi krok',
        description: null,
        order: 2,
        procedureId: null,
        defaultOwnerId: null,
        dueDayOffset: null,
      },
    ])
  })
})
