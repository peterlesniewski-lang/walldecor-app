import { createHash } from 'node:crypto'
import { Prisma, PrismaClient } from '@/generated/prisma'
import { resolveActiveClientLink } from './client-link'
import { validateInstallationQuestionDefinitions } from './question-schema'
import { isClientVisitFeeActive } from './delegation-service'

export { getInstallationReadiness } from './readiness'

type InstallationDb = PrismaClient | Prisma.TransactionClient

export type ClientFormQuestion = {
  key: string
  type: 'YES_NO_UNKNOWN' | 'NUMBER' | 'DIMENSION' | 'TEXT' | 'SINGLE' | 'MULTI' | 'FILE'
  label: string
  required?: boolean
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH'
  options?: readonly string[]
  condition?: { questionKey: string; equals: string }
}

export type ClientAnswerValue = string | string[]

export type NormalizedClientAnswer = {
  valueJson: string
  normalizedValue: string
  isUnknown: boolean
}

export class InstallationFormValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Odpowiedzi w formularzu są niepoprawne.')
    this.name = 'InstallationFormValidationError'
  }
}

function canonicalDecimal(value: string): string | null {
  const trimmed = value.trim().replace(',', '.')
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return null
  const negative = trimmed.startsWith('-') ? '-' : ''
  const [integerRaw, fractionalRaw] = trimmed.replace(/^-/, '').split('.')
  const integer = integerRaw.replace(/^0+(?=\d)/, '') || '0'
  const fractional = fractionalRaw?.replace(/0+$/, '')
  return `${negative}${integer}${fractional ? `.${fractional}` : ''}`
}

function invalid(question: ClientFormQuestion, message = 'Podaj poprawną odpowiedź.'): never {
  throw new InstallationFormValidationError({ [question.key]: message })
}

/** Evaluates the immutable question snapshot against the current draft values. */
export function evaluateVisibleFormQuestions(
  questions: readonly ClientFormQuestion[],
  answers: Record<string, ClientAnswerValue | undefined>,
): ClientFormQuestion[] {
  return questions.filter((question) => {
    if (!question.condition) return true
    const controllingValue = answers[question.condition.questionKey]
    return typeof controllingValue === 'string' && controllingValue === question.condition.equals
  })
}

/**
 * Stores numbers as canonical strings so SQLite/JSON never turn measurement
 * input into an imprecise binary float. FILE values intentionally await Task 5.
 */
export function normalizeClientAnswer(question: ClientFormQuestion, value: unknown): NormalizedClientAnswer {
  if (question.type === 'YES_NO_UNKNOWN') {
    if (typeof value !== 'string' || !['YES', 'NO', 'UNKNOWN'].includes(value)) {
      invalid(question, 'Wybierz Tak, Nie albo Nie wiem.')
    }
    return {
      valueJson: JSON.stringify({ type: question.type, value }),
      normalizedValue: value,
      isUnknown: value === 'UNKNOWN',
    }
  }

  if (question.type === 'NUMBER' || question.type === 'DIMENSION') {
    if (typeof value !== 'string') invalid(question, 'Podaj liczbę jako tekst, bez wartości zmiennoprzecinkowej.')
    const decimal = canonicalDecimal(value)
    if (!decimal) invalid(question, 'Podaj poprawną liczbę dziesiętną.')
    return {
      valueJson: JSON.stringify({ type: question.type, value: decimal }),
      normalizedValue: decimal,
      isUnknown: false,
    }
  }

  if (question.type === 'TEXT') {
    if (typeof value !== 'string' || value.trim() === '') invalid(question)
    const text = value.trim()
    return { valueJson: JSON.stringify({ type: question.type, value: text }), normalizedValue: text, isUnknown: false }
  }

  if (question.type === 'SINGLE') {
    if (typeof value !== 'string' || !question.options?.includes(value)) invalid(question, 'Wybierz jedną z dostępnych odpowiedzi.')
    return { valueJson: JSON.stringify({ type: question.type, value }), normalizedValue: value, isUnknown: false }
  }

  if (question.type === 'MULTI') {
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string') || new Set(value).size !== value.length || value.some((item) => !question.options?.includes(item))) {
      invalid(question, 'Wybierz niepowtarzalne odpowiedzi z listy.')
    }
    const choices = [...value].sort()
    return { valueJson: JSON.stringify({ type: question.type, value: choices }), normalizedValue: choices.join('|'), isUnknown: false }
  }

  invalid(question, 'Dokumenty i zdjęcia zostaną dodane w kroku plików.')
}

/** Returns the missing visible required question keys or throws for malformed values. */
export function validateVisibleSubmission(
  questions: readonly ClientFormQuestion[],
  answers: Record<string, ClientAnswerValue | undefined>,
): string[] {
  const missing: string[] = []
  for (const question of evaluateVisibleFormQuestions(questions, answers)) {
    // Task 5 owns actual files; a snapshot FILE must never fake an upload or block this submit.
    if (question.type === 'FILE') continue
    const value = answers[question.key]
    if (value === undefined) {
      if (question.required) missing.push(question.key)
      continue
    }
    normalizeClientAnswer(question, value)
  }
  if (missing.length > 0) {
    throw new InstallationFormValidationError(Object.fromEntries(missing.map((key) => [key, 'To pytanie wymaga odpowiedzi.'])))
  }
  return missing
}

export class InstallationFormConflictError extends Error {
  constructor() {
    super('Formularz został zapisany w nowszej wersji. Odśwież dane i spróbuj ponownie.')
    this.name = 'InstallationFormConflictError'
  }
}

export class InstallationClarificationValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Ustalenie wymaga uzupełnienia.')
    this.name = 'InstallationClarificationValidationError'
  }
}

type PersistedAnswer = { questionKey: string; valueJson: string; isUnknown: boolean }

type SubmissionForClient = {
  status: 'DRAFT' | 'SUBMITTED'
  revisionNumber: number
  draftVersion: number
  submittedAt: string | null
  answers: Array<{ questionKey: string; value: ClientAnswerValue; isUnknown: boolean }>
}

type ClientFormMutation = {
  revisionNumber: number
  draftVersion: number
  clientMutationId: string
  /** null explicitly clears one optional answer instead of retaining stale data. */
  answers: Array<{ questionKey: string; value: ClientAnswerValue | null }>
}

function questionsFromSnapshot(schemaJson: string): ClientFormQuestion[] {
  let parsed: { templateId?: unknown; questions?: unknown }
  try {
    parsed = JSON.parse(schemaJson) as { templateId?: unknown; questions?: unknown }
  } catch {
    throw new InstallationFormValidationError({ form: 'Migawka formularza jest niepoprawna.' })
  }
  if (typeof parsed.templateId !== 'string' || !Array.isArray(parsed.questions)) {
    throw new InstallationFormValidationError({ form: 'Migawka formularza jest niepoprawna.' })
  }
  try {
    return validateInstallationQuestionDefinitions(parsed.templateId, parsed.questions).map((question) => ({
      ...question,
      required: question.required === true,
    }))
  } catch {
    throw new InstallationFormValidationError({ form: 'Migawka formularza jest niepoprawna.' })
  }
}

function answerValue(answer: PersistedAnswer): ClientAnswerValue {
  try {
    const parsed = JSON.parse(answer.valueJson) as { value?: unknown }
    if (typeof parsed.value === 'string') return parsed.value
    if (Array.isArray(parsed.value) && parsed.value.every((value) => typeof value === 'string')) return parsed.value
  } catch {
    // A corrupt persisted answer must not be silently returned to a public client.
  }
  throw new InstallationFormValidationError({ form: 'Nie udało się odczytać zapisanej odpowiedzi.' })
}

function clientSubmission(submission: {
  status: string; revisionNumber: number; draftVersion: number; submittedAt: Date | null; answers: PersistedAnswer[]
}): SubmissionForClient {
  return {
    status: submission.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT',
    revisionNumber: submission.revisionNumber,
    draftVersion: submission.draftVersion,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    answers: submission.answers.map((answer) => ({ questionKey: answer.questionKey, value: answerValue(answer), isUnknown: answer.isUnknown })),
  }
}

function assertMutationShape(input: ClientFormMutation) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.answers) || !Number.isInteger(input.revisionNumber) || input.revisionNumber < 1 || !Number.isInteger(input.draftVersion) || input.draftVersion < 0 || typeof input.clientMutationId !== 'string' || input.clientMutationId.trim().length < 12) {
    throw new InstallationFormValidationError({ form: 'Dane zapisu formularza są niepoprawne.' })
  }
  const keys = new Set<string>()
  for (const answer of input.answers) {
    if (!answer || typeof answer !== 'object' || typeof answer.questionKey !== 'string' || answer.questionKey.trim() === '' || (answer.value !== null && typeof answer.value !== 'string' && !Array.isArray(answer.value)) || (Array.isArray(answer.value) && !answer.value.every((value) => typeof value === 'string')) || keys.has(answer.questionKey)) {
      throw new InstallationFormValidationError({ form: 'Dane odpowiedzi są niepoprawne.' })
    }
    keys.add(answer.questionKey)
  }
}

async function submissionForClientLink(db: InstallationDb, link: { orderId: string }, revisionNumber: number) {
  const submission = await db.installationFormSubmission.findUnique({
    where: { orderId_revisionNumber: { orderId: link.orderId, revisionNumber } },
    include: {
      formSnapshot: { select: { schemaJson: true } },
      answers: { orderBy: { questionKey: 'asc' } },
    },
  })
  if (!submission || submission.orderId !== link.orderId) {
    throw new InstallationFormValidationError({ form: 'Ten szkic formularza nie jest dostępny.' })
  }
  return { link, submission, questions: questionsFromSnapshot(submission.formSnapshot.schemaJson) }
}

function mergedDraftAnswers(
  existing: PersistedAnswer[],
  patch: ClientFormMutation['answers'],
): Record<string, ClientAnswerValue | undefined> {
  const answers: Record<string, ClientAnswerValue | undefined> = {}
  for (const answer of existing) answers[answer.questionKey] = answerValue(answer)
  for (const answer of patch) {
    if (answer.value === null) delete answers[answer.questionKey]
    else answers[answer.questionKey] = answer.value
  }
  return answers
}

function assertAnswersAreVisible(
  questions: ClientFormQuestion[],
  values: Record<string, ClientAnswerValue | undefined>,
  patch: ClientFormMutation['answers'],
) {
  const visible = new Map(evaluateVisibleFormQuestions(questions, values).map((question) => [question.key, question]))
  for (const answer of patch) {
    const question = visible.get(answer.questionKey)
    if (!question) throw new InstallationFormValidationError({ [answer.questionKey]: 'To pytanie nie jest teraz widoczne.' })
    if (question.type === 'FILE') throw new InstallationFormValidationError({ [answer.questionKey]: 'Dokumenty i zdjęcia zostaną dodane w kroku plików.' })
    const clearsAnswer = answer.value === null || (question.type === 'MULTI' && Array.isArray(answer.value) && answer.value.length === 0)
    if (clearsAnswer) {
      if (question.required) invalid(question, 'To pytanie wymaga odpowiedzi.')
      continue
    }
    normalizeClientAnswer(question, answer.value)
  }
  return visible
}

function replayMutation(mutation: { operation: string; responseJson: string }, operation: 'AUTOSAVE' | 'SUBMIT') {
  if (mutation.operation !== operation) throw new InstallationFormConflictError()
  try {
    return JSON.parse(mutation.responseJson) as SubmissionForClient
  } catch {
    throw new InstallationFormConflictError()
  }
}

/** CAS autosave; writes only answers still visible in the immutable snapshot. */
export async function autosaveClientForm(db: PrismaClient, token: string, input: ClientFormMutation): Promise<SubmissionForClient> {
  assertMutationShape(input)
  return db.$transaction(async (tx) => {
    // Link validity intentionally precedes any idempotency lookup. A revoked,
    // expired or malformed token must never replay a formerly valid response.
    const link = await resolveActiveClientLink(tx, token)
    const { submission, questions } = await submissionForClientLink(tx, link, input.revisionNumber)
    const firstReplay = await tx.installationFormSubmissionMutation.findUnique({
      where: { submissionId_draftVersion_clientMutationId: { submissionId: submission.id, draftVersion: input.draftVersion, clientMutationId: input.clientMutationId } },
    })
    if (firstReplay) return replayMutation(firstReplay, 'AUTOSAVE')
    if (submission.status !== 'DRAFT') throw new InstallationFormValidationError({ form: 'Ten szkic formularza nie jest dostępny.' })
    if (submission.draftVersion !== input.draftVersion) throw new InstallationFormConflictError()
    const values = mergedDraftAnswers(submission.answers, input.answers)
    const visible = assertAnswersAreVisible(questions, values, input.answers)
    const claimed = await tx.installationFormSubmission.updateMany({
      where: { id: submission.id, status: 'DRAFT', draftVersion: input.draftVersion },
      data: { draftVersion: { increment: 1 } },
    })
    if (claimed.count !== 1) {
      const replay = await tx.installationFormSubmissionMutation.findUnique({
        where: { submissionId_draftVersion_clientMutationId: { submissionId: submission.id, draftVersion: input.draftVersion, clientMutationId: input.clientMutationId } },
      })
      if (replay) return replayMutation(replay, 'AUTOSAVE')
      throw new InstallationFormConflictError()
    }
    for (const answer of input.answers) {
      const question = questions.find((candidate) => candidate.key === answer.questionKey)!
      const clearsAnswer = answer.value === null || (question.type === 'MULTI' && Array.isArray(answer.value) && answer.value.length === 0)
      if (clearsAnswer) {
        await tx.installationAnswer.deleteMany({ where: { submissionId: submission.id, questionKey: answer.questionKey } })
        continue
      }
      const normalized = normalizeClientAnswer(question, answer.value)
      await tx.installationAnswer.upsert({
        where: { submissionId_questionKey: { submissionId: submission.id, questionKey: answer.questionKey } },
        create: { submissionId: submission.id, questionKey: answer.questionKey, questionType: question.type, ...normalized },
        update: { questionType: question.type, ...normalized },
      })
    }
    // A changed controlling answer can hide a nested question. Its old value
    // must not survive as an invisible answer in the draft or a later revision.
    await tx.installationAnswer.deleteMany({
      where: { submissionId: submission.id, questionKey: { notIn: [...visible.keys()] } },
    })
    const updated = await tx.installationFormSubmission.findUniqueOrThrow({
      where: { id: submission.id }, include: { answers: { orderBy: { questionKey: 'asc' } } },
    })
    const response = clientSubmission(updated)
    await tx.installationFormSubmissionMutation.create({
      data: { submissionId: submission.id, draftVersion: input.draftVersion, clientMutationId: input.clientMutationId, operation: 'AUTOSAVE', responseJson: JSON.stringify(response) },
    })
    return response
  })
}

type SubmitMutation = Omit<ClientFormMutation, 'answers'> & {
  visitFeeAccepted?: boolean
  /** Trusted request metadata supplied by the public route, never client JSON. */
  clientIp?: string
  clientUserAgent?: string
}

function visitFeeMoney(value: Prisma.Decimal | null) {
  return value?.toFixed(2) ?? null
}

function hashClientIp(value: string | undefined) {
  // The public route passes the proxy/client address when available. We retain
  // a deterministic marker hash rather than silently persisting the raw IP.
  return createHash('sha256').update(value?.trim() || 'unavailable', 'utf8').digest('hex')
}

async function requireAndRecordVisitFeeAcceptance(
  tx: Prisma.TransactionClient,
  orderId: string,
  input: SubmitMutation,
) {
  const order = await tx.installationOrder.findUniqueOrThrow({ where: { id: orderId } })
  const active = isClientVisitFeeActive({
    status: order.visitFeeStatus,
    grossAmount: visitFeeMoney(order.visitFeeGrossAmount),
    clauseText: order.visitFeeClauseText,
    clauseVersion: order.visitFeeClauseVersion,
    legalApprovedAt: order.visitFeeLegalApprovedAt,
  })
  if (!active || order.visitFeeClientAcceptedAt) return
  if (input.visitFeeAccepted !== true) {
    throw new InstallationFormValidationError({
      visitFeeAccepted: 'Potwierdź zapoznanie się z kwotą opłaty za bezskuteczny podjazd.',
    })
  }
  await tx.installationOrder.update({
    where: { id: orderId },
    data: {
      visitFeeClientAcceptedAt: new Date(),
      visitFeeClientIpHash: hashClientIp(input.clientIp),
      visitFeeClientUserAgent: input.clientUserAgent?.trim().slice(0, 1_000) || 'unknown',
    },
  })
}

function createClarificationCandidates(questions: ClientFormQuestion[], answers: PersistedAnswer[]) {
  const values = mergedDraftAnswers(answers, [])
  const visible = evaluateVisibleFormQuestions(questions, values)
  const byKey = new Map(answers.map((answer) => [answer.questionKey, answer]))
  return visible.flatMap((question) => {
    const answer = byKey.get(question.key)
    if (answer?.isUnknown) {
      return [{ questionKey: question.key, reasonCode: 'CLIENT_UNKNOWN', reason: 'Klient wskazał odpowiedź „Nie wiem”.' }]
    }
    if (question.riskLevel === 'HIGH' && !answer) {
      return [{ questionKey: question.key, reasonCode: 'MISSING_HIGH_RISK', reason: 'Brakuje odpowiedzi na pytanie wysokiego ryzyka.' }]
    }
    return []
  })
}

/** Atomically freezes the draft, its answers and the resulting clarification records. */
export async function submitClientForm(db: PrismaClient, token: string, input: SubmitMutation): Promise<SubmissionForClient> {
  assertMutationShape({ ...input, answers: [] })
  return db.$transaction(async (tx) => {
    // See autosave: authorization is always established before replaying a
    // mutation bound to a historic submission revision.
    const link = await resolveActiveClientLink(tx, token)
    const { submission, questions } = await submissionForClientLink(tx, link, input.revisionNumber)
    const firstReplay = await tx.installationFormSubmissionMutation.findUnique({
      where: { submissionId_draftVersion_clientMutationId: { submissionId: submission.id, draftVersion: input.draftVersion, clientMutationId: input.clientMutationId } },
    })
    if (firstReplay) return replayMutation(firstReplay, 'SUBMIT')
    if (submission.status !== 'DRAFT') throw new InstallationFormValidationError({ form: 'Ten szkic formularza nie jest dostępny.' })
    if (submission.draftVersion !== input.draftVersion) throw new InstallationFormConflictError()
    const values = mergedDraftAnswers(submission.answers, [])
    validateVisibleSubmission(questions, values)
    await requireAndRecordVisitFeeAcceptance(tx, link.orderId, input)
    const clarificationCandidates = createClarificationCandidates(questions, submission.answers)
    const submittedAt = new Date()
    const claimed = await tx.installationFormSubmission.updateMany({
      where: { id: submission.id, status: 'DRAFT', draftVersion: input.draftVersion },
      data: { status: 'SUBMITTED', submittedAt, draftKey: null },
    })
    if (claimed.count !== 1) {
      const replay = await tx.installationFormSubmissionMutation.findUnique({
        where: { submissionId_draftVersion_clientMutationId: { submissionId: submission.id, draftVersion: input.draftVersion, clientMutationId: input.clientMutationId } },
      })
      if (replay) return replayMutation(replay, 'SUBMIT')
      throw new InstallationFormConflictError()
    }
    for (const clarification of clarificationCandidates) {
      await tx.installationClarification.upsert({
        where: { sourceSubmissionId_questionKey_reasonCode: { sourceSubmissionId: submission.id, questionKey: clarification.questionKey, reasonCode: clarification.reasonCode } },
        create: { orderId: link.orderId, sourceSubmissionId: submission.id, ...clarification, isBlocking: true },
        update: {},
      })
    }
    const finalized = await tx.installationFormSubmission.findUniqueOrThrow({
      where: { id: submission.id }, include: { answers: { orderBy: { questionKey: 'asc' } } },
    })
    const response = clientSubmission(finalized)
    await tx.installationFormSubmissionMutation.create({
      data: { submissionId: submission.id, draftVersion: input.draftVersion, clientMutationId: input.clientMutationId, operation: 'SUBMIT', responseJson: JSON.stringify(response) },
    })
    return response
  })
}

/** Creates a separate draft revision; it never reopens or mutates a submitted record. */
export async function startClientFormCorrection(db: PrismaClient, token: string): Promise<SubmissionForClient> {
  return db.$transaction(async (tx) => {
    // Keep correction on the same authorization boundary as autosave and
    // submit.  No draft lookup is allowed before an active link is resolved.
    const link = await resolveActiveClientLink(tx, token)
    const existing = await tx.installationFormSubmission.findUnique({
      where: { draftKey: link.orderId }, include: { answers: { orderBy: { questionKey: 'asc' } } },
    })
    if (existing) return clientSubmission(existing)
    const source = await tx.installationFormSubmission.findFirst({
      where: { orderId: link.orderId, status: 'SUBMITTED' }, orderBy: { revisionNumber: 'desc' }, include: { answers: { orderBy: { questionKey: 'asc' } } },
    })
    if (!source) throw new InstallationFormValidationError({ form: 'Nie ma jeszcze formularza do korekty.' })
    try {
      const draft = await tx.installationFormSubmission.create({
        data: {
          orderId: link.orderId,
          formSnapshotId: source.formSnapshotId,
          revisionOfId: source.id,
          revisionNumber: source.revisionNumber + 1,
          status: 'DRAFT',
          draftKey: link.orderId,
          answers: { create: source.answers.map((answer) => ({
            questionKey: answer.questionKey, questionType: answer.questionType, valueJson: answer.valueJson,
            normalizedValue: answer.normalizedValue, isUnknown: answer.isUnknown,
          })) },
        },
        include: { answers: { orderBy: { questionKey: 'asc' } } },
      })
      return clientSubmission(draft)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await tx.installationFormSubmission.findUnique({
          where: { draftKey: link.orderId }, include: { answers: { orderBy: { questionKey: 'asc' } } },
        })
        if (raced) return clientSubmission(raced)
      }
      throw error
    }
  })
}

export async function listInstallationClarifications(db: InstallationDb, orderId: string) {
  const clarifications = await db.installationClarification.findMany({
    where: { orderId },
    include: { sourceSubmission: { select: { revisionNumber: true, answers: { select: { questionKey: true, normalizedValue: true } } } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
  })
  return clarifications.map(({ sourceSubmission, ...clarification }) => ({
    ...clarification,
    revisionNumber: sourceSubmission.revisionNumber,
    answer: sourceSubmission.answers.find((answer) => answer.questionKey === clarification.questionKey)?.normalizedValue ?? null,
  }))
}

export async function listInstallationFormRevisions(db: InstallationDb, orderId: string) {
  const submissions = await db.installationFormSubmission.findMany({
    where: { orderId },
    select: { revisionNumber: true, status: true, submittedAt: true, answers: { select: { questionKey: true, normalizedValue: true, isUnknown: true }, orderBy: { questionKey: 'asc' } } },
    orderBy: { revisionNumber: 'asc' },
  })
  return submissions.map((submission) => ({
    revisionNumber: submission.revisionNumber,
    status: submission.status,
    submittedAt: submission.submittedAt,
    answers: submission.answers.map((answer) => ({ ...answer })),
  }))
}

export async function resolveInstallationClarification(
  db: PrismaClient,
  orderId: string,
  clarificationId: string,
  input: { action: 'RESOLVE' | 'WAIVE'; resolution?: string; note?: string; evidenceReference?: string },
  actorId: string,
) {
  const resolution = input.resolution?.trim()
  const note = input.note?.trim()
  const evidenceReference = input.evidenceReference?.trim()
  if (input.action === 'RESOLVE' && (!resolution || (!note && !evidenceReference))) {
    throw new InstallationClarificationValidationError({ form: 'Podaj ustalenie oraz notatkę lub odwołanie do dowodu.' })
  }
  if (input.action === 'WAIVE' && !note) {
    throw new InstallationClarificationValidationError({ note: 'Odstąpienie wymaga uzasadnienia.' })
  }
  return db.$transaction(async (tx) => {
    const clarification = await tx.installationClarification.findFirst({ where: { id: clarificationId, orderId } })
    if (!clarification || clarification.status !== 'OPEN') {
      throw new InstallationClarificationValidationError({ form: 'Ta kwestia nie jest już otwarta.' })
    }
    const status = input.action === 'RESOLVE' ? 'RESOLVED' : 'WAIVED'
    const updated = await tx.installationClarification.update({
      where: { id: clarificationId },
      data: {
        status,
        resolution: input.action === 'RESOLVE' ? resolution : null,
        resolutionNote: note ?? null,
        evidenceReference: evidenceReference ?? null,
        resolvedById: actorId,
        resolvedAt: new Date(),
      },
    })
    await tx.installationAuditEvent.create({
      data: {
        orderId,
        actorId,
        action: input.action === 'RESOLVE' ? 'INSTALLATION_CLARIFICATION_RESOLVED' : 'INSTALLATION_CLARIFICATION_WAIVED',
        metadataJson: JSON.stringify({ clarificationId, status, sourceSubmissionId: clarification.sourceSubmissionId, questionKey: clarification.questionKey }),
      },
    })
    return updated
  })
}
