import type { FormAnswerValue } from './form-visibility'

const answerLabels: Record<string, string> = {
  YES: 'Tak',
  NO: 'Nie',
  UNKNOWN: 'Nie wiem',
}

export function displayFormAnswer(value: FormAnswerValue | null | undefined): string {
  if (value === null || value === undefined) return 'Brak odpowiedzi'
  if (Array.isArray(value)) {
    const joined = value.join(', ')
    return joined || 'Brak odpowiedzi'
  }
  if (value.trim() === '') return 'Brak odpowiedzi'
  return answerLabels[value] ?? value
}
