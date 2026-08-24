import { displayFormAnswer } from './form-answer-display'
import { validateInstallationQuestionDefinitions } from './question-schema'
import { evaluateVisibleFormQuestions, type FormAnswerValue, type FormQuestion } from './form-visibility'

export type HistoricalAnswerInput = {
  questionKey: string
  questionType: string
  valueJson: string
  normalizedValue: string
  isUnknown: boolean
}

export type HistoricalAnswerView = {
  /** Kept only to match a historical answer to its immutable question. */
  questionKey: string
  label: string
  type: FormQuestion['type'] | 'ARCHIVED'
  value: FormAnswerValue | undefined
  displayValue: string
  isUnknown: boolean
}

const questionTypes = new Set<FormQuestion['type']>([
  'YES_NO_UNKNOWN', 'NUMBER', 'DIMENSION', 'TEXT', 'SINGLE', 'MULTI', 'FILE',
])

function knownQuestionType(value: string): FormQuestion['type'] | undefined {
  return questionTypes.has(value as FormQuestion['type']) ? value as FormQuestion['type'] : undefined
}

function storedValue(answer: HistoricalAnswerInput): FormAnswerValue | undefined {
  try {
    const parsed = JSON.parse(answer.valueJson) as { value?: unknown }
    if (typeof parsed.value === 'string') return parsed.value
    if (Array.isArray(parsed.value) && parsed.value.every((item) => typeof item === 'string')) return parsed.value
  } catch {
    // History remains readable when an old persisted row is malformed.
  }
  return answer.normalizedValue || undefined
}

/** A malformed old snapshot is not a reason to hide the whole revision. */
export function parseHistoricalSnapshotQuestions(schemaJson: string): FormQuestion[] {
  try {
    const parsed = JSON.parse(schemaJson) as { templateId?: unknown; questions?: unknown }
    if (typeof parsed.templateId !== 'string' || !Array.isArray(parsed.questions)) return []
    return validateInstallationQuestionDefinitions(parsed.templateId, parsed.questions).map((question) => ({
      ...question,
      required: question.required === true,
    }))
  } catch {
    return []
  }
}

export function formatHistoricalAnswer(
  question: FormQuestion | undefined,
  answer: HistoricalAnswerInput,
): HistoricalAnswerView {
  const effectiveQuestionType = question?.type ?? knownQuestionType(answer.questionType) ?? 'TEXT'
  const value = storedValue(answer)
  return {
    questionKey: answer.questionKey,
    label: question?.label ?? 'Pytanie archiwalne',
    type: question?.type ?? 'ARCHIVED',
    value,
    displayValue: displayFormAnswer(value, effectiveQuestionType),
    isUnknown: answer.isUnknown,
  }
}

export function formatHistoricalRevisionContent(
  schemaJson: string,
  persistedAnswers: readonly HistoricalAnswerInput[],
) {
  const snapshotQuestions = parseHistoricalSnapshotQuestions(schemaJson)
  const answersByKey = new Map(persistedAnswers.map((answer) => [answer.questionKey, answer]))
  const values = Object.fromEntries(
    persistedAnswers.map((answer) => [answer.questionKey, storedValue(answer)]),
  ) as Record<string, FormAnswerValue | undefined>
  const visibleQuestions = evaluateVisibleFormQuestions(snapshotQuestions, values)
  const knownQuestionKeys = new Set(snapshotQuestions.map((question) => question.key))
  const readableAnswers = visibleQuestions.flatMap((question) => {
    const answer = answersByKey.get(question.key)
    return answer ? [formatHistoricalAnswer(question, answer)] : []
  })
  const archivedAnswers = persistedAnswers
    .filter((answer) => !knownQuestionKeys.has(answer.questionKey))
    .map((answer) => formatHistoricalAnswer(undefined, answer))

  return {
    questions: visibleQuestions,
    answers: [...readableAnswers, ...archivedAnswers],
  }
}
