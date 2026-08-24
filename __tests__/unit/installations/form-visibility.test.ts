import { describe, expect, it } from 'vitest'
import {
  evaluateVisibleFormQuestions,
  filterVisibleAnswerValues,
  type FormQuestion,
} from '@/lib/installations/form-visibility'

const questions = [
  { key: 'okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?' },
  { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', condition: { questionKey: 'okna', equals: 'YES' } },
  { key: 'glebokosc', type: 'DIMENSION', label: 'Jaka jest głębokość?', condition: { questionKey: 'glify', equals: 'YES' } },
] satisfies readonly FormQuestion[]

describe('form visibility', () => {
  it('hides a grandchild whose direct parent has a stale answer behind a hidden ancestor', () => {
    expect(evaluateVisibleFormQuestions(questions, {
      okna: 'NO',
      glify: 'YES',
      glebokosc: '12',
    }).map((question) => question.key)).toEqual(['okna'])
  })

  it('reveals each level only after every ancestor condition is satisfied', () => {
    expect(evaluateVisibleFormQuestions(questions, { okna: 'YES', glify: 'YES' })
      .map((question) => question.key)).toEqual(['okna', 'glify', 'glebokosc'])
    expect(evaluateVisibleFormQuestions(questions, { okna: 'YES', glify: 'NO', glebokosc: '12' })
      .map((question) => question.key)).toEqual(['okna', 'glify'])
  })

  it('drops stale answers for recursively hidden descendants', () => {
    expect(filterVisibleAnswerValues(questions, {
      okna: 'NO',
      glify: 'YES',
      glebokosc: '12',
    })).toEqual({ okna: 'NO' })
  })

  it('fails closed when a condition refers to a missing parent', () => {
    expect(evaluateVisibleFormQuestions([
      { key: 'glebokosc', type: 'DIMENSION', label: 'Jaka jest głębokość?', condition: { questionKey: 'brak', equals: 'YES' } },
    ], { brak: 'YES' })).toEqual([])
  })

  it('fails closed when conditions form a cycle', () => {
    expect(evaluateVisibleFormQuestions([
      { key: 'okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?', condition: { questionKey: 'glify', equals: 'YES' } },
      { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', condition: { questionKey: 'okna', equals: 'YES' } },
    ], { okna: 'YES', glify: 'YES' })).toEqual([])
  })
})
