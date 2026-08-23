import { describe, expect, it } from 'vitest'
import type { FormQuestion } from '@/lib/installations/form-visibility'
import {
  appendQuestionAtPlacement,
  branchChoices,
  buildQuestionForest,
  flattenQuestionForest,
  moveQuestionWithinBranch,
  nextQuestionKey,
  removeQuestionSubtree,
} from '@/lib/installations/question-tree'

const questions = [
  { key: 'pokoj-a', type: 'YES_NO_UNKNOWN', label: 'Pokój A' },
  { key: 'okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?', condition: { questionKey: 'pokoj-a', equals: 'YES' } },
  { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy tapetujemy glify?', condition: { questionKey: 'okna', equals: 'YES' } },
  { key: 'glebokosc', type: 'DIMENSION', label: 'Głębokość glifów', condition: { questionKey: 'glify', equals: 'YES' } },
  { key: 'pokoj-b', type: 'YES_NO_UNKNOWN', label: 'Pokój B' },
] satisfies FormQuestion[]

const keys = (items: readonly FormQuestion[]) => items.map((question) => question.key)

describe('installation question tree', () => {
  it('builds and flattens the forest in preorder while keeping sibling order', () => {
    expect(keys(flattenQuestionForest(buildQuestionForest(questions)))).toEqual([
      'pokoj-a',
      'okna',
      'glify',
      'glebokosc',
      'pokoj-b',
    ])
  })

  it('places children in explicit YES/NO/UNKNOWN and SINGLE branches', () => {
    const branchedQuestions = [
      ...questions,
      { key: 'rolety', type: 'TEXT', label: 'Rolety', condition: { questionKey: 'okna', equals: 'NO' } },
      { key: 'material', type: 'SINGLE', label: 'Materiał', options: ['Tapeta', 'Farba'] },
      { key: 'klej', type: 'TEXT', label: 'Klej', condition: { questionKey: 'material', equals: 'Tapeta' } },
    ] satisfies FormQuestion[]
    const forest = buildQuestionForest(branchedQuestions)
    const okna = forest[0].branches.find((branch) => branch.value === 'YES')?.children[0]
    const material = forest.find((node) => node.question.key === 'material')

    expect(okna?.branches.find((branch) => branch.value === 'YES')).toMatchObject({
      value: 'YES',
      label: 'Tak',
      children: [{ question: { key: 'glify' } }],
    })
    expect(okna?.branches.find((branch) => branch.value === 'NO')).toMatchObject({
      value: 'NO',
      label: 'Nie',
      children: [{ question: { key: 'rolety' } }],
    })
    expect(material?.branches.find((branch) => branch.value === 'Tapeta')).toMatchObject({
      value: 'Tapeta',
      label: 'Tapeta',
      children: [{ question: { key: 'klej' } }],
    })
  })

  it('moves a root and its whole subtree only among root siblings', () => {
    expect(keys(moveQuestionWithinBranch(questions, 'pokoj-b', 'UP'))).toEqual([
      'pokoj-b',
      'pokoj-a',
      'okna',
      'glify',
      'glebokosc',
    ])
  })

  it('does not move a question outside its exact sibling branch', () => {
    expect(keys(moveQuestionWithinBranch(questions, 'glify', 'UP'))).toEqual(keys(questions))
  })

  it('removes a question together with every descendant', () => {
    expect(keys(removeQuestionSubtree(questions, 'okna'))).toEqual(['pokoj-a', 'pokoj-b'])
  })

  it('appends root and child questions with a condition defined exclusively by the placement', () => {
    const withRoot = appendQuestionAtPlacement(
      questions,
      {
        key: 'uwagi',
        type: 'TEXT',
        label: 'Uwagi',
        condition: { questionKey: 'glify', equals: 'NO', templateId: 'foreign-template' },
      },
      { parentKey: null, equals: null },
    )

    expect(withRoot.at(-1)).toEqual({ key: 'uwagi', type: 'TEXT', label: 'Uwagi' })

    const withChild = appendQuestionAtPlacement(
      withRoot,
      { key: 'material', type: 'SINGLE', label: 'Materiał', options: ['Tapeta'] },
      { parentKey: 'glify', equals: 'YES' },
    )

    expect(withChild.find((question) => question.key === 'material')?.condition).toEqual({
      questionKey: 'glify',
      equals: 'YES',
    })
  })

  it('generates the next stable invisible question key without changing existing keys', () => {
    const existing = [
      { key: 'question-1', type: 'TEXT', label: 'A' },
      { key: 'question-7', type: 'TEXT', label: 'B' },
      { key: 'custom', type: 'TEXT', label: 'C' },
    ] satisfies FormQuestion[]

    expect(nextQuestionKey(existing)).toBe('question-8')
    expect(keys(existing)).toEqual(['question-1', 'question-7', 'custom'])
  })

  it('returns labelled branches for YES/NO/UNKNOWN and declared choices for SINGLE', () => {
    expect(branchChoices(questions[0])).toEqual([
      { value: 'YES', label: 'Tak' },
      { value: 'NO', label: 'Nie' },
      { value: 'UNKNOWN', label: 'Nie wiem' },
    ])
    expect(branchChoices({ key: 'style', type: 'SINGLE', label: 'Styl', options: ['Klasyczny', 'Nowoczesny'] })).toEqual([
      { value: 'Klasyczny', label: 'Klasyczny' },
      { value: 'Nowoczesny', label: 'Nowoczesny' },
    ])
    expect(branchChoices({ key: 'notes', type: 'TEXT', label: 'Uwagi' })).toEqual([])
  })

  it('keeps orphan records after flattening so validation can report them', () => {
    const withOrphan = [
      questions[0],
      { key: 'osierocone', type: 'TEXT', label: 'Osierocone', condition: { questionKey: 'brak', equals: 'YES' } },
      questions[4],
    ] satisfies FormQuestion[]

    expect(keys(flattenQuestionForest(buildQuestionForest(withOrphan)))).toEqual([
      'pokoj-a',
      'pokoj-b',
      'osierocone',
    ])
  })

  it('keeps children with a non-branch parent or unknown branch value unreachable', () => {
    const malformedPlacement = [
      { key: 'tekst', type: 'TEXT', label: 'Tekst' },
      { key: 'invalid-parent', type: 'TEXT', label: 'Invalid parent', condition: { questionKey: 'tekst', equals: 'YES' } },
      { key: 'wybor', type: 'YES_NO_UNKNOWN', label: 'Wybór' },
      { key: 'invalid-value', type: 'TEXT', label: 'Invalid value', condition: { questionKey: 'wybor', equals: 'MAYBE' } },
      { key: 'root', type: 'TEXT', label: 'Root' },
    ] satisfies FormQuestion[]

    expect(keys(flattenQuestionForest(buildQuestionForest(malformedPlacement)))).toEqual([
      'tekst',
      'wybor',
      'root',
      'invalid-parent',
      'invalid-value',
    ])
  })

  it('does not remove an orphan when the requested key is absent', () => {
    const withOrphan = [
      questions[0],
      { key: 'osierocone', type: 'TEXT', label: 'Osierocone', condition: { questionKey: 'brak', equals: 'YES' } },
    ] satisfies FormQuestion[]

    expect(keys(removeQuestionSubtree(withOrphan, 'brak'))).toEqual(['pokoj-a', 'osierocone'])
  })

  it('does not hang or lose cycle and malformed records', () => {
    const malformed = [
      { key: 'root', type: 'TEXT', label: 'Root' },
      { key: 'a', type: 'TEXT', label: 'A', condition: { questionKey: 'b', equals: 'YES' } },
      { key: 'b', type: 'TEXT', label: 'B', condition: { questionKey: 'a', equals: 'YES' } },
      { key: 'broken', type: 'TEXT', label: 'Broken', condition: { questionKey: '', equals: 'YES' } },
    ] satisfies FormQuestion[]

    expect(keys(flattenQuestionForest(buildQuestionForest(malformed)))).toEqual(['root', 'a', 'b', 'broken'])
  })
})
