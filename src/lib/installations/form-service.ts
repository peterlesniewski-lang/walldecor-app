import { Prisma, PrismaClient } from '@/generated/prisma'
import { resolveActiveClientLink } from './client-link'
import { validateInstallationQuestionDefinitions } from './question-schema'
import { isClientVisitFeeActive } from './delegation-service'
import { hashTrustedClientIp } from './client-ip'
import { createVisitFeeSnapshotDigest } from './visit-fee-snapshot'
import {
  evaluateVisibleFormQuestions,
  type FormAnswerValue,
  type FormQuestion,
} from './form-visibility'
import {
  formatHistoricalAnswer,
  formatHistoricalRevisionContent,
  parseHistoricalSnapshotQuestions,
} from './form-history'

export { getInstallationReadiness } from './readiness'
export { evaluateVisibleFormQuestions } from './form-visibility'

type InstallationDb = PrismaClient | Prisma.TransactionClient

export type ClientFormQuestion = FormQuestion

export type ClientAnswerValue = FormAnswerValue

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

/** FILE answers are not serialized as form values. A required visible FILE is
 * satisfied only by a READY, non-deleted private file for this order and
 * question key. A correction keeps the already supplied file unless the
 * customer deliberately deletes it. */
async function validateRequiredVisibleFiles(
  db: InstallationDb,
  submission: { id: string; orderId: string },
  questions: readonly ClientFormQuestion[],
  values: Record<string, ClientAnswerValue | undefined>,
) {
  const requiredKeys = evaluateVisibleFormQuestions(questions, values)
    .filter((question) => question.type === 'FILE' && question.required)
    .map((question) => question.key)
  if (requiredKeys.length === 0) return
  const files = await db.installationFile.findMany({
    where: {
      orderId: submission.orderId,
      purpose: 'CLIENT_QUESTION',
      questionKey: { in: requiredKeys },
      status: 'READY',
      softDeletedAt: null,
    },
    select: { questionKey: true },
  })
  const present = new Set(files.map((file) => file.questionKey))
  const missing = requiredKeys.filter((key) => !present.has(key))
  if (missing.length > 0) {
    throw new InstallationFormValidationError(Object.fromEntries(missing.map((key) => [key, 'Dodaj wymagany plik przed wysłaniem formularza.'])))
  }
}

export class InstallationFormConflictError extends Error {
  constructor() {
    super('Formularz został zapisany w nowszej wersji. Odśwież dane i spróbuj ponownie.')
    this.name = 'InstallationFormConflictError'
  }
}

/** The client saw an older fee snapshot; it must reload before accepting it. */
export class InstallationVisitFeeAcceptanceConflictError extends Error {
  constructor() {
    super('Informacja o opłacie zmieniła się. Odśwież stronę i sprawdź aktualną kwotę.')
    this.name = 'InstallationVisitFeeAcceptanceConflictError'
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
  visitFeeAccepted?: true
  visitFeeSnapshotDigest?: string
  /** Trusted request metadata supplied by the public route, never client JSON. */
  clientIp?: string | null
  clientUserAgent?: string
}

function visitFeeMoney(value: Prisma.Decimal | null) {
  return value?.toFixed(2) ?? null
}

function feeSnapshot(order: {
  visitFeePolicyId: string | null
  visitFeeStatus: string
  visitFeeGrossAmount: Prisma.Decimal | null
  visitFeeClauseText: string | null
  visitFeeClauseVersion: number | null
  visitFeeLegalApprovedAt: Date | null
}) {
  return {
    policyId: order.visitFeePolicyId,
    status: order.visitFeeStatus,
    grossAmount: visitFeeMoney(order.visitFeeGrossAmount),
    clauseText: order.visitFeeClauseText,
    clauseVersion: order.visitFeeClauseVersion,
    legalApprovedAt: order.visitFeeLegalApprovedAt,
  }
}

type VisitFeeAcceptanceMutation = {
  accepted: true
  /** Must be the exact opaque digest displayed in the public projection. */
  snapshotDigest: string
  /** Trusted request metadata supplied only by the route handler. */
  clientIp?: string | null
  clientUserAgent?: string
}

/**
 * Lets a client accept a fee selected after the form was already submitted.
 * It never touches answers or starts a correction. Repeating the same accepted
 * snapshot is idempotent; any changed legal-snapshot field is a conflict.
 */
export async function acceptClientVisitFee(
  db: PrismaClient,
  token: string,
  input: VisitFeeAcceptanceMutation,
) {
  if (input.accepted !== true || !/^sha256:[a-f0-9]{64}$/.test(input.snapshotDigest)) {
    throw new InstallationFormValidationError({ visitFeeAccepted: 'Potwierdź aktualną informację o opłacie.' })
  }
  return db.$transaction(async (tx) => {
    const link = await resolveActiveClientLink(tx, token)
    const [submittedCount, currentDraft, order] = await Promise.all([
      tx.installationFormSubmission.count({ where: { orderId: link.orderId, status: 'SUBMITTED' } }),
      tx.installationFormSubmission.count({ where: { orderId: link.orderId, status: 'DRAFT', draftKey: link.orderId } }),
      tx.installationOrder.findUniqueOrThrow({ where: { id: link.orderId } }),
    ])
    if (submittedCount === 0 || currentDraft > 0) {
      throw new InstallationFormValidationError({ visitFeeAccepted: 'Najpierw wyślij aktualną wersję formularza.' })
    }
    const currentSnapshot = feeSnapshot(order)
    const active = isClientVisitFeeActive(currentSnapshot)
    if (!active || createVisitFeeSnapshotDigest(currentSnapshot) !== input.snapshotDigest) {
      throw new InstallationVisitFeeAcceptanceConflictError()
    }
    if (order.visitFeeClientAcceptedAt) return { acceptedAt: order.visitFeeClientAcceptedAt }
    const acceptedAt = new Date()
    // This must be a compare-and-set rather than a read followed by an
    // unconditional update. Two browser requests may both read the unaccepted
    // snapshot; exactly one owns the acceptance timestamp and audit event.
    const updated = await tx.installationOrder.updateMany({
      where: {
        id: link.orderId,
        visitFeeClientAcceptedAt: null,
        visitFeeStatus: order.visitFeeStatus,
        visitFeePolicyId: order.visitFeePolicyId,
        visitFeeGrossAmount: order.visitFeeGrossAmount,
        visitFeeClauseText: order.visitFeeClauseText,
        visitFeeClauseVersion: order.visitFeeClauseVersion,
        visitFeeLegalApprovedAt: order.visitFeeLegalApprovedAt,
      },
      data: {
        visitFeeClientAcceptedAt: acceptedAt,
        visitFeeClientIpHash: hashTrustedClientIp(input.clientIp ?? null),
        visitFeeClientUserAgent: input.clientUserAgent?.trim().slice(0, 1_000) || 'unknown',
      },
    })
    if (updated.count === 1) {
      await tx.installationAuditEvent.create({
        data: {
          orderId: link.orderId,
          actorId: 'PUBLIC_CLIENT',
          action: 'INSTALLATION_VISIT_FEE_CLIENT_ACCEPTED',
          // Deliberately do not place the token, IP hash or user agent in the
          // audit payload; those are private request metadata, not history.
          afterJson: JSON.stringify({ grossAmount: currentSnapshot.grossAmount, clauseVersion: currentSnapshot.clauseVersion, snapshotDigest: input.snapshotDigest, acceptedAt: acceptedAt.toISOString() }),
        },
      })
      return { acceptedAt }
    }

    // A concurrent request can legitimately arrive after the compare-and-set
    // succeeded. It is idempotent only when it still addresses this exact
    // approved snapshot; a changed fee remains a 409 so the checkbox is reset.
    const latest = await tx.installationOrder.findUniqueOrThrow({ where: { id: link.orderId } })
    const latestSnapshot = feeSnapshot(latest)
    const latestIsActive = isClientVisitFeeActive(latestSnapshot)
    if (!latestIsActive || createVisitFeeSnapshotDigest(latestSnapshot) !== input.snapshotDigest) {
      throw new InstallationVisitFeeAcceptanceConflictError()
    }
    if (latest.visitFeeClientAcceptedAt) return { acceptedAt: latest.visitFeeClientAcceptedAt }
    throw new InstallationVisitFeeAcceptanceConflictError()
  })
}

async function requireAndRecordVisitFeeAcceptance(
  tx: Prisma.TransactionClient,
  orderId: string,
  input: SubmitMutation,
) {
  const order = await tx.installationOrder.findUniqueOrThrow({ where: { id: orderId } })
  const currentSnapshot = feeSnapshot(order)
  const active = isClientVisitFeeActive(currentSnapshot)
  if (!active || order.visitFeeClientAcceptedAt) return
  if (input.visitFeeAccepted !== true || !input.visitFeeSnapshotDigest) {
    throw new InstallationFormValidationError({
      visitFeeAccepted: 'Potwierdź zapoznanie się z kwotą opłaty za bezskuteczny podjazd.',
    })
  }
  if (createVisitFeeSnapshotDigest(currentSnapshot) !== input.visitFeeSnapshotDigest) {
    throw new InstallationVisitFeeAcceptanceConflictError()
  }
  const acceptedAt = new Date()
  const accepted = await tx.installationOrder.updateMany({
    where: {
      id: orderId,
      visitFeeClientAcceptedAt: null,
      visitFeeStatus: order.visitFeeStatus,
      visitFeePolicyId: order.visitFeePolicyId,
      visitFeeGrossAmount: order.visitFeeGrossAmount,
      visitFeeClauseText: order.visitFeeClauseText,
      visitFeeClauseVersion: order.visitFeeClauseVersion,
      visitFeeLegalApprovedAt: order.visitFeeLegalApprovedAt,
    },
    data: {
      visitFeeClientAcceptedAt: acceptedAt,
      visitFeeClientIpHash: hashTrustedClientIp(input.clientIp ?? null),
      visitFeeClientUserAgent: input.clientUserAgent?.trim().slice(0, 1_000) || 'unknown',
    },
  })
  if (accepted.count !== 1) {
    const latest = await tx.installationOrder.findUniqueOrThrow({ where: { id: orderId } })
    const latestSnapshot = feeSnapshot(latest)
    if (latest.visitFeeClientAcceptedAt && createVisitFeeSnapshotDigest(latestSnapshot) === input.visitFeeSnapshotDigest) return
    throw new InstallationVisitFeeAcceptanceConflictError()
  }
  await tx.installationAuditEvent.create({
    data: {
      orderId,
      actorId: 'PUBLIC_CLIENT',
      action: 'INSTALLATION_VISIT_FEE_CLIENT_ACCEPTED',
      afterJson: JSON.stringify({ grossAmount: currentSnapshot.grossAmount, clauseVersion: currentSnapshot.clauseVersion, snapshotDigest: input.visitFeeSnapshotDigest, acceptedAt: acceptedAt.toISOString() }),
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
    await validateRequiredVisibleFiles(tx, submission, questions, values)
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
    select: {
      id: true,
      status: true,
      isBlocking: true,
      reason: true,
      createdAt: true,
      resolution: true,
      resolutionNote: true,
      evidenceReference: true,
      questionKey: true,
      sourceSubmission: {
        select: {
          revisionNumber: true,
          formSnapshot: { select: { schemaJson: true } },
          answers: { select: { questionKey: true, questionType: true, valueJson: true, normalizedValue: true, isUnknown: true } },
        },
      },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
  })
  return clarifications.map((clarification) => {
    const question = parseHistoricalSnapshotQuestions(clarification.sourceSubmission.formSnapshot.schemaJson)
      .find((candidate) => candidate.key === clarification.questionKey)
    const storedAnswer = clarification.sourceSubmission.answers
      .find((answer) => answer.questionKey === clarification.questionKey)
    const answer = storedAnswer ? formatHistoricalAnswer(question, storedAnswer) : undefined
    return {
      id: clarification.id,
      status: clarification.status,
      isBlocking: clarification.isBlocking,
      reason: clarification.reason,
      createdAt: clarification.createdAt,
      resolution: clarification.resolution,
      resolutionNote: clarification.resolutionNote,
      evidenceReference: clarification.evidenceReference,
      revisionNumber: clarification.sourceSubmission.revisionNumber,
      questionLabel: question?.label ?? answer?.label ?? 'Pytanie archiwalne',
      answer: answer?.displayValue ?? null,
    }
  })
}

export async function listInstallationFormRevisions(db: InstallationDb, orderId: string) {
  const submissions = await db.installationFormSubmission.findMany({
    where: { orderId },
    select: {
      id: true,
      revisionNumber: true,
      status: true,
      submittedAt: true,
      formSnapshot: { select: { schemaJson: true, templateVersion: true } },
      answers: { select: { questionKey: true, questionType: true, valueJson: true, normalizedValue: true, isUnknown: true }, orderBy: { questionKey: 'asc' } },
    },
    orderBy: { revisionNumber: 'asc' },
  })
  return submissions.map((submission) => ({
    formSubmissionId: submission.id,
    revisionNumber: submission.revisionNumber,
    status: submission.status,
    submittedAt: submission.submittedAt,
    templateVersion: submission.formSnapshot.templateVersion,
    ...formatHistoricalRevisionContent(submission.formSnapshot.schemaJson, submission.answers),
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
