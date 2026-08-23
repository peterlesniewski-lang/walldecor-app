export type FormAnswerValue = string | string[]

export type FormQuestion = {
  key: string
  type: 'YES_NO_UNKNOWN' | 'NUMBER' | 'DIMENSION' | 'TEXT' | 'SINGLE' | 'MULTI' | 'FILE'
  label: string
  help?: string
  required?: boolean
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH'
  options?: readonly string[]
  condition?: { templateId?: string; questionKey: string; equals: string }
}

type FormAnswers = Record<string, FormAnswerValue | undefined>

/**
 * Evaluates every condition through its complete ancestor chain. This means a
 * stale value on an invisible parent can never reveal a descendant.
 */
export function evaluateVisibleFormQuestions(
  questions: readonly FormQuestion[],
  answers: FormAnswers,
): FormQuestion[] {
  const questionsByKey = new Map(questions.map((question) => [question.key, question]))
  const visibility = new Map<string, boolean>()
  const evaluating = new Set<string>()

  function isVisible(question: FormQuestion): boolean {
    const cached = visibility.get(question.key)
    if (cached !== undefined) return cached
    if (evaluating.has(question.key)) return false
    evaluating.add(question.key)

    const condition = question.condition
    const parent = condition ? questionsByKey.get(condition.questionKey) : undefined
    const result = !condition || (
      parent !== undefined &&
      isVisible(parent) &&
      typeof answers[condition.questionKey] === 'string' &&
      answers[condition.questionKey] === condition.equals
    )

    evaluating.delete(question.key)
    visibility.set(question.key, result)
    return result
  }

  return questions.filter(isVisible)
}

/** Returns only answers whose questions are visible in the current form path. */
export function filterVisibleAnswerValues(
  questions: readonly FormQuestion[],
  answers: FormAnswers,
): Record<string, FormAnswerValue> {
  const visibleKeys = new Set(evaluateVisibleFormQuestions(questions, answers).map((question) => question.key))
  return Object.fromEntries(
    Object.entries(answers).flatMap(([key, value]) => visibleKeys.has(key) && value !== undefined ? [[key, value]] : []),
  )
}
