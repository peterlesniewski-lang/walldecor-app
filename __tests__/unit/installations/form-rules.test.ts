import { describe, expect, it } from 'vitest'
import {
  evaluateVisibleFormQuestions,
  InstallationFormValidationError,
  normalizeClientAnswer,
  validateVisibleSubmission,
} from '@/lib/installations/form-service'

const questions = [
  { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', required: true, riskLevel: 'HIGH' },
  { key: 'glify-cm', type: 'DIMENSION', label: 'Jaka wysokość?', required: true, condition: { questionKey: 'glify', equals: 'YES' } },
  { key: 'kolor', type: 'SINGLE', label: 'Kolor', options: ['biały', 'beżowy'], required: true },
  { key: 'wykonczenie', type: 'MULTI', label: 'Wykończenie', options: ['mat', 'satyna'] },
  { key: 'zdjecie', type: 'FILE', label: 'Zdjęcie referencyjne', required: true },
] as const

describe('client installation form rules', () => {
  it('shows a nested dimension only when its controlling answer is YES', () => {
    expect(evaluateVisibleFormQuestions(questions, { glify: 'YES' }).map((question) => question.key))
      .toEqual(['glify', 'glify-cm', 'kolor', 'wykonczenie', 'zdjecie'])
    expect(evaluateVisibleFormQuestions(questions, { glify: 'UNKNOWN' }).map((question) => question.key))
      .toEqual(['glify', 'kolor', 'wykonczenie', 'zdjecie'])
  })

  it('accepts UNKNOWN as a deliberate answer and stores a typed normalized value', () => {
    expect(normalizeClientAnswer(questions[0], 'UNKNOWN')).toEqual({
      valueJson: JSON.stringify({ type: 'YES_NO_UNKNOWN', value: 'UNKNOWN' }),
      normalizedValue: 'UNKNOWN',
      isUnknown: true,
    })
  })

  it('keeps dimensions as canonical decimal strings instead of binary floats', () => {
    expect(normalizeClientAnswer(questions[1], ' 12,50 ')).toEqual({
      valueJson: JSON.stringify({ type: 'DIMENSION', value: '12.5' }),
      normalizedValue: '12.5',
      isUnknown: false,
    })
    expect(() => normalizeClientAnswer(questions[1], 12.5)).toThrow(InstallationFormValidationError)
  })

  it('rejects choices outside the immutable snapshot', () => {
    expect(() => normalizeClientAnswer(questions[2], 'szary')).toThrow(InstallationFormValidationError)
    expect(() => normalizeClientAnswer(questions[3], ['mat', 'mat'])).toThrow(InstallationFormValidationError)
  })

  it('requires visible required questions but never blocks on UNKNOWN or the future FILE step', () => {
    expect(() => validateVisibleSubmission(questions, {
      glify: 'YES',
      kolor: 'biały',
    })).toThrow(InstallationFormValidationError)

    expect(validateVisibleSubmission(questions, {
      glify: 'UNKNOWN',
      kolor: 'biały',
    })).toEqual([])
  })
})
