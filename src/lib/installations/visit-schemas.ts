import { z } from 'zod'

export class InstallationVisitValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Dane wizyty są niepoprawne.')
    this.name = 'InstallationVisitValidationError'
  }
}

const invalidDateMessage = 'Podaj poprawną datę i godzinę.'

const MAX_VISIT_NOTE_LENGTH = 4_000
const MAX_SCOPE_ID_LENGTH = 191
const rfc3339InstantPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function isValidRfc3339Instant(value: string): boolean {
  const match = rfc3339InstantPattern.exec(value)
  if (!match) return false

  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] = match
  const year = Number(yearValue)
  const month = Number(monthValue)
  const day = Number(dayValue)
  const hour = Number(hourValue)
  const minute = Number(minuteValue)
  const second = Number(secondValue)
  const daysInMonth = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31

  return month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth
    && hour <= 23
    && minute <= 59
    && second <= 59
    && Number.isFinite(new Date(value).getTime())
}

const visitDateSchema = z.union([
  z.date().refine((value) => Number.isFinite(value.getTime()), invalidDateMessage),
  z.string().refine(isValidRfc3339Instant, invalidDateMessage).transform((value) => new Date(value)),
])

const optionalVisitDateSchema = z.preprocess(
  (value) => value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value,
  visitDateSchema.optional(),
)

const optionalTrimmedNoteSchema = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).max(MAX_VISIT_NOTE_LENGTH, 'Notatka może mieć maksymalnie 4 000 znaków.').optional(),
)

const nullableOptionalTrimmedNoteSchema = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().min(1).max(MAX_VISIT_NOTE_LENGTH, 'Notatka może mieć maksymalnie 4 000 znaków.').nullish(),
)

const scopeIdsSchema = z.array(
  z.string().trim().min(1, 'Wybierz poprawny zakres prac.').max(MAX_SCOPE_ID_LENGTH, 'Identyfikator zakresu prac może mieć maksymalnie 191 znaków.'),
).transform((scopeIds) => [...new Set(scopeIds)]).pipe(
  z.array(z.string()).max(100, 'Wizyta może obejmować maksymalnie 100 zakresów prac.'),
)

const nonEmptyScopeIdsSchema = scopeIdsSchema.pipe(
  z.array(z.string()).min(1, 'Wybierz co najmniej jeden zakres prac.'),
)

const expectedRevisionSchema = z.number()
  .int('Rewizja wizyty musi być liczbą całkowitą.')
  .positive('Rewizja wizyty musi być dodatnia.')

function validateOptionalTimeRange(
  value: { startsAt?: Date; endsAt?: Date },
  ctx: z.RefinementCtx,
) {
  if (Boolean(value.startsAt) !== Boolean(value.endsAt)) {
    ctx.addIssue({
      code: 'custom',
      path: [value.startsAt ? 'endsAt' : 'startsAt'],
      message: 'Podaj zarówno początek, jak i koniec wizyty.',
    })
    return
  }

  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Koniec wizyty musi przypadać po jej rozpoczęciu.',
    })
  }
}

export type CreateInstallationVisitInput = {
  startsAt?: Date
  endsAt?: Date
  note?: string
  scopeIds: string[]
}

export const createVisitSchema: z.ZodType<CreateInstallationVisitInput> = z.object({
  startsAt: optionalVisitDateSchema,
  endsAt: optionalVisitDateSchema,
  note: optionalTrimmedNoteSchema,
  scopeIds: scopeIdsSchema,
}).strict().superRefine(validateOptionalTimeRange)

const saveDraftActionSchema = z.object({
  action: z.literal('SAVE_DRAFT'),
  expectedRevision: expectedRevisionSchema,
  startsAt: optionalVisitDateSchema,
  endsAt: optionalVisitDateSchema,
  note: nullableOptionalTrimmedNoteSchema,
  scopeIds: scopeIdsSchema,
}).strict().superRefine(validateOptionalTimeRange)

const confirmActionSchema = z.object({
  action: z.literal('CONFIRM'),
  expectedRevision: expectedRevisionSchema,
  startsAt: visitDateSchema,
  endsAt: visitDateSchema,
  note: nullableOptionalTrimmedNoteSchema,
  scopeIds: nonEmptyScopeIdsSchema,
}).strict().superRefine((value, ctx) => {
  if (value.endsAt <= value.startsAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Koniec wizyty musi przypadać po jej rozpoczęciu.',
    })
  }
})

const changeScheduleActionSchema = z.object({
  action: z.literal('CHANGE_SCHEDULE'),
  expectedRevision: expectedRevisionSchema,
  startsAt: visitDateSchema,
  endsAt: visitDateSchema,
  note: nullableOptionalTrimmedNoteSchema,
  scopeIds: nonEmptyScopeIdsSchema,
}).strict().superRefine((value, ctx) => {
  if (value.endsAt <= value.startsAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Koniec wizyty musi przypadać po jej rozpoczęciu.',
    })
  }
})

const cancelActionSchema = z.object({
  action: z.literal('CANCEL'),
  expectedRevision: expectedRevisionSchema,
}).strict()

const completeActionSchema = z.object({
  action: z.literal('COMPLETE'),
  expectedRevision: expectedRevisionSchema,
}).strict()

export const updateVisitActionSchema = z.discriminatedUnion('action', [
  saveDraftActionSchema,
  confirmActionSchema,
  changeScheduleActionSchema,
  cancelActionSchema,
  completeActionSchema,
])

export type UpdateInstallationVisitActionInput = z.infer<typeof updateVisitActionSchema>

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path.join('.') || 'form'
    fieldErrors[field] ??= issue.message
  }
  return fieldErrors
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as T
}

export function parseCreateInstallationVisit(input: unknown): CreateInstallationVisitInput {
  const parsed = createVisitSchema.safeParse(input)
  if (!parsed.success) throw new InstallationVisitValidationError(fieldErrorsFrom(parsed.error))
  return withoutUndefined(parsed.data)
}

export function parseInstallationVisitAction(input: unknown): UpdateInstallationVisitActionInput {
  const parsed = updateVisitActionSchema.safeParse(input)
  if (!parsed.success) throw new InstallationVisitValidationError(fieldErrorsFrom(parsed.error))
  return withoutUndefined(parsed.data)
}
