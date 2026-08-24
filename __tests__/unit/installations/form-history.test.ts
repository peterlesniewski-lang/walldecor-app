import { describe, expect, it } from 'vitest'
import {
  formatHistoricalAnswer,
  formatHistoricalRevisionContent,
  parseHistoricalSnapshotQuestions,
} from '@/lib/installations/form-history'
import type { FormQuestion } from '@/lib/installations/form-visibility'

function question(key: string, label: string, type: FormQuestion['type'] = 'YES_NO_UNKNOWN'): FormQuestion {
  return { key, label, type }
}

function storedAnswer(
  questionKey: string,
  questionType: string,
  valueJson: string,
  normalizedValue: string,
  isUnknown = false,
) {
  return { questionKey, questionType, valueJson, normalizedValue, isUnknown }
}

describe('immutable client form history formatting', () => {
  it('formats historical YES/NO and MULTI answers with the snapshot question type', () => {
    expect(formatHistoricalAnswer(
      question('drzwi', 'Czy są drzwi ukryte?'),
      storedAnswer('drzwi', 'YES_NO_UNKNOWN', '{"type":"YES_NO_UNKNOWN","value":"NO"}', 'NO'),
    )).toMatchObject({ label: 'Czy są drzwi ukryte?', type: 'YES_NO_UNKNOWN', displayValue: 'Nie' })
    expect(formatHistoricalAnswer(
      question('kolory', 'Kolory', 'MULTI'),
      storedAnswer('kolory', 'MULTI', '{"type":"MULTI","value":["beż","biel"]}', 'beż|biel'),
    )).toMatchObject({ displayValue: 'beż, biel' })
  })

  it('falls back safely for missing definitions and malformed values without exposing a raw key as a label', () => {
    expect(formatHistoricalAnswer(
      undefined,
      storedAnswer('usuniete_pytanie', 'TEXT', '{not-json', 'stara odpowiedź'),
    )).toMatchObject({
      questionKey: 'usuniete_pytanie',
      label: 'Pytanie archiwalne',
      type: 'ARCHIVED',
      displayValue: 'stara odpowiedź',
    })
  })

  it('formats malformed MULTI JSON from the normalized separator without leaking pipe characters', () => {
    const multi = question('kolory', 'Kolory ścian', 'MULTI')

    expect(formatHistoricalAnswer(
      multi,
      storedAnswer('kolory', 'MULTI', '{not-json', 'beż|biel'),
    ).displayValue).toBe('beż, biel')
    expect(formatHistoricalAnswer(
      multi,
      storedAnswer('kolory', 'MULTI', '{not-json', 'beż||biel|'),
    ).displayValue).toBe('beż, biel')
    expect(formatHistoricalAnswer(
      multi,
      storedAnswer('kolory', 'MULTI', '{not-json', '|'),
    ).displayValue).toBe('Brak odpowiedzi')
  })

  it('keeps each snapshot separate and hides a stale descendant from its historic path', () => {
    const schema = JSON.stringify({
      templateId: 'template-old',
      questions: [
        question('okna', 'Czy są okna?'),
        { ...question('glify', 'Jaka głębokość glifu?', 'DIMENSION'), condition: { questionKey: 'okna', equals: 'YES' } },
      ],
    })
    const content = formatHistoricalRevisionContent(schema, [
      storedAnswer('okna', 'YES_NO_UNKNOWN', '{"value":"NO"}', 'NO'),
      storedAnswer('glify', 'DIMENSION', '{"value":"12"}', '12'),
    ])

    expect(content.questions.map((item) => item.label)).toEqual(['Czy są okna?'])
    expect(content.answers).toEqual([expect.objectContaining({ label: 'Czy są okna?', displayValue: 'Nie' })])
    expect(parseHistoricalSnapshotQuestions('{not-json')).toEqual([])
    expect(() => formatHistoricalRevisionContent('{not-json', [storedAnswer('stare', 'TEXT', '{"value":"x"}', 'x')])).not.toThrow()
  })
})
