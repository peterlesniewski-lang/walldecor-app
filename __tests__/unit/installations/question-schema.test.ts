import { describe, expect, it } from 'vitest'
import {
  InstallationQuestionSchemaError,
  validateInstallationQuestionDefinitions,
} from '@/lib/installations/question-schema'

const glyphQuestions = [
  {
    key: 'glify',
    type: 'YES_NO_UNKNOWN',
    label: 'Czy w pomieszczeniu są glify?',
    help: 'Zaznacz Nie wiem, jeśli nie masz pewności.',
    riskLevel: 'MEDIUM',
  },
  {
    key: 'glify-width-cm',
    type: 'DIMENSION',
    label: 'Jaka jest szerokość glifu?',
    help: 'Podaj wymiar w centymetrach.',
    riskLevel: 'HIGH',
    condition: { questionKey: 'glify', equals: 'YES' },
  },
]

describe('installation question schema', () => {
  it('accepts the glyph YES/NO/UNKNOWN question and a conditional centimetre dimension without treating UNKNOWN as invalid', () => {
    expect(validateInstallationQuestionDefinitions('template-v1', glyphQuestions)).toEqual(glyphQuestions)
  })

  it.each([
    { ...glyphQuestions[0], type: 'BOOLEAN' },
    { ...glyphQuestions[0], key: '' },
    { ...glyphQuestions[0], riskLevel: 'CRITICAL' },
  ])('rejects a question outside the allowed definition schema', (question) => {
    expect(() => validateInstallationQuestionDefinitions('template-v1', [question])).toThrow(InstallationQuestionSchemaError)
  })

  it('rejects duplicate and missing question keys', () => {
    expect(() => validateInstallationQuestionDefinitions('template-v1', [
      glyphQuestions[0],
      { ...glyphQuestions[0], label: 'Drugi opis' },
    ])).toThrow(/powtarza się/)

    expect(() => validateInstallationQuestionDefinitions('template-v1', [
      { ...glyphQuestions[0], key: '   ' },
    ])).toThrow(/klucz/)
  })

  it('rejects a condition aimed at a missing or another-template question', () => {
    expect(() => validateInstallationQuestionDefinitions('template-v1', [
      { ...glyphQuestions[1], condition: { questionKey: 'missing', equals: 'YES' } },
    ])).toThrow(/nie istnieje/)

    expect(() => validateInstallationQuestionDefinitions('template-v1', [
      glyphQuestions[0],
      {
        ...glyphQuestions[1],
        condition: { templateId: 'template-v2', questionKey: 'glify', equals: 'YES' },
      },
    ])).toThrow(/innego szablonu/)
  })

  it('rejects a cycle and an equals value unsupported by the condition target', () => {
    expect(() => validateInstallationQuestionDefinitions('template-v1', [
      { ...glyphQuestions[0], condition: { questionKey: 'glify-width-cm', equals: '10' } },
      glyphQuestions[1],
    ])).toThrow(/cykl/)

    expect(() => validateInstallationQuestionDefinitions('template-v1', [
      glyphQuestions[0],
      { ...glyphQuestions[1], condition: { questionKey: 'glify', equals: 'MAYBE' } },
    ])).toThrow(/niedozwoloną wartość/)
  })

  it('allows equality only against YES/NO/UNKNOWN or a declared SINGLE option', () => {
    expect(validateInstallationQuestionDefinitions('template-v1', [
      { key: 'material', type: 'SINGLE', label: 'Materiał', options: ['Tapeta', 'Sztukateria'] },
      { key: 'wall-area', type: 'NUMBER', label: 'Pole ściany', condition: { questionKey: 'material', equals: 'Tapeta' } },
    ])).toHaveLength(2)

    expect(() => validateInstallationQuestionDefinitions('template-v1', [
      { key: 'note', type: 'TEXT', label: 'Uwagi' },
      { key: 'wall-area', type: 'NUMBER', label: 'Pole ściany', condition: { questionKey: 'note', equals: 'Tak' } },
    ])).toThrow(/nie może być celem/)
  })

  it.each(['YES_NO_UNKNOWN', 'NUMBER', 'DIMENSION', 'TEXT', 'FILE'] as const)('rejects options on %s because only choice questions may define them', (type) => {
    expect(() => validateInstallationQuestionDefinitions('template-v1', [
      { key: `invalid-${type}`, type, label: 'Pytanie bez listy wyboru', options: ['Jedna opcja'] },
    ])).toThrow(/opcje.*tylko/i)
  })

  it('accepts nonempty unique options only for SINGLE and MULTI questions', () => {
    expect(validateInstallationQuestionDefinitions('template-v1', [
      { key: 'single', type: 'SINGLE', label: 'Jedna odpowiedź', options: ['A', 'B'] },
      { key: 'multi', type: 'MULTI', label: 'Wiele odpowiedzi', options: ['C', 'D'] },
    ])).toHaveLength(2)

    expect(() => validateInstallationQuestionDefinitions('template-v1', [
      { key: 'invalid-multi', type: 'MULTI', label: 'Duplikaty', options: ['A', 'A'] },
    ])).toThrow(/powtarzają się/)
  })
})
