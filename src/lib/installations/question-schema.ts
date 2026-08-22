import { z } from 'zod'

export const INSTALLATION_QUESTION_TYPES = [
  'YES_NO_UNKNOWN',
  'NUMBER',
  'DIMENSION',
  'TEXT',
  'SINGLE',
  'MULTI',
  'FILE',
] as const

export const INSTALLATION_QUESTION_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const

const questionConditionSchema = z.object({
  templateId: z.string().trim().min(1).optional(),
  questionKey: z.string().trim().min(1, 'Warunek musi wskazywać klucz pytania.'),
  equals: z.string().trim().min(1, 'Warunek musi zawierać wartość porównania.'),
}).strict()

const installationQuestionDefinitionSchema = z.object({
  key: z.string().trim().min(1, 'Każde pytanie musi mieć niepusty klucz.'),
  type: z.enum(INSTALLATION_QUESTION_TYPES),
  label: z.string().trim().min(1, 'Każde pytanie musi mieć etykietę.'),
  help: z.string().trim().min(1).optional(),
  riskLevel: z.enum(INSTALLATION_QUESTION_RISK_LEVELS).optional(),
  options: z.array(z.string().trim().min(1)).min(1).optional(),
  condition: questionConditionSchema.optional(),
}).strict()

export type InstallationQuestionDefinition = z.infer<typeof installationQuestionDefinitionSchema>

export class InstallationQuestionSchemaError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join(' '))
    this.name = 'InstallationQuestionSchemaError'
  }
}

function collectCycleKeys(questions: InstallationQuestionDefinition[]) {
  const byKey = new Map(questions.map((question) => [question.key, question]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(key: string): boolean {
    if (visiting.has(key)) return true
    if (visited.has(key)) return false
    visiting.add(key)
    const target = byKey.get(key)?.condition?.questionKey
    if (target && byKey.has(target) && visit(target)) return true
    visiting.delete(key)
    visited.add(key)
    return false
  }

  return questions.some((question) => visit(question.key))
}

/**
 * Validates the complete immutable schema of one template version. Conditions
 * can only refer to another question in the same version, making a published
 * schema self-contained and safe to snapshot as JSON.
 */
export function validateInstallationQuestionDefinitions(
  templateId: string,
  input: unknown,
): InstallationQuestionDefinition[] {
  const parsed = z.array(installationQuestionDefinitionSchema).safeParse(input)
  if (!parsed.success) {
    throw new InstallationQuestionSchemaError(parsed.error.issues.map((issue) => issue.message))
  }

  const questions = parsed.data
  const issues: string[] = []
  const keys = new Set<string>()
  const byKey = new Map(questions.map((question) => [question.key, question]))

  for (const question of questions) {
    if (keys.has(question.key)) issues.push(`Klucz pytania „${question.key}” powtarza się.`)
    keys.add(question.key)

    if ((question.type === 'SINGLE' || question.type === 'MULTI') && !question.options) {
      issues.push(`Pytanie „${question.key}” typu ${question.type} wymaga listy opcji.`)
    }
    if (question.options && question.type !== 'SINGLE' && question.type !== 'MULTI') {
      issues.push(`Opcje pytania „${question.key}” są dozwolone tylko dla SINGLE lub MULTI.`)
    }
    if (question.options && new Set(question.options).size !== question.options.length) {
      issues.push(`Opcje pytania „${question.key}” powtarzają się.`)
    }

    const condition = question.condition
    if (!condition) continue
    if (condition.templateId && condition.templateId !== templateId) {
      issues.push(`Warunek pytania „${question.key}” wskazuje pytanie z innego szablonu.`)
      continue
    }
    const target = byKey.get(condition.questionKey)
    if (!target) {
      issues.push(`Warunek pytania „${question.key}” wskazuje pytanie, które nie istnieje.`)
      continue
    }
    if (target.type === 'YES_NO_UNKNOWN') {
      if (!['YES', 'NO', 'UNKNOWN'].includes(condition.equals)) {
        issues.push(`Warunek pytania „${question.key}” ma niedozwoloną wartość dla pytania Tak/Nie/Nie wiem.`)
      }
      continue
    }
    if (target.type === 'SINGLE') {
      if (!target.options?.includes(condition.equals)) {
        issues.push(`Warunek pytania „${question.key}” ma niedozwoloną wartość dla pytania jednokrotnego wyboru.`)
      }
      continue
    }
    issues.push(`Pytanie „${target.key}” typu ${target.type} nie może być celem prostego warunku równości.`)
  }

  if (collectCycleKeys(questions)) issues.push('Warunki pytań tworzą cykl.')
  if (issues.length > 0) throw new InstallationQuestionSchemaError(issues)
  return questions
}
