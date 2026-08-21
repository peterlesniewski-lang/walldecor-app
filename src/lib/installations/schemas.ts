import { z } from 'zod'
import { INSTALLATION_ORDER_STATUSES } from './constants'

type EmployeeActivityLookup = {
  isEmployeeActive?: (employeeId: string) => Promise<boolean>
}

export class InstallationOrderValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Dane zlecenia są niepoprawne.')
    this.name = 'InstallationOrderValidationError'
  }
}

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
)

const optionalDate = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.date().optional(),
)

const createInstallationOrderSchema = z.object({
  client: z.object({
    name: z.string().trim().min(1, 'Podaj imię i nazwisko lub nazwę klienta.'),
    email: z.string().trim().email('Podaj poprawny adres e-mail.'),
    phone: z.string().trim().regex(/^(?:\+48[\s-]?)?(?:\d[\s-]?){9}$/, 'Podaj poprawny numer telefonu.'),
  }),
  address: z.object({
    street: z.string().trim().min(1, 'Podaj ulicę.'),
    buildingNumber: optionalTrimmedString,
    apartmentNumber: optionalTrimmedString,
    postalCode: z.string().trim().regex(/^\d{2}-\d{3}$/, 'Podaj kod pocztowy w formacie 00-000.'),
    city: z.string().trim().min(1, 'Podaj miejscowość.'),
  }),
  primaryEmployeeId: z.string().trim().min(1, 'Wybierz głównego opiekuna.'),
  backupEmployeeId: z.string().trim().min(1, 'Wybierz zastępcę opiekuna.'),
  status: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.enum(INSTALLATION_ORDER_STATUSES).optional(),
  ),
  scheduledAt: optionalDate,
  externalSystem: optionalTrimmedString,
  externalId: optionalTrimmedString,
})

export type CreateInstallationOrderInput = z.infer<typeof createInstallationOrderSchema>

const updateInstallationOrderSchema = z.object({
  client: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  }).optional(),
  address: z.object({
    street: z.string().optional(),
    buildingNumber: z.string().nullable().optional(),
    apartmentNumber: z.string().nullable().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
  }).optional(),
  primaryEmployeeId: z.string().optional(),
  backupEmployeeId: z.string().optional(),
  status: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.enum(INSTALLATION_ORDER_STATUSES).optional(),
  ),
  scheduledAt: optionalDate,
  externalSystem: optionalTrimmedString,
  externalId: optionalTrimmedString,
})

export type UpdateInstallationOrderInput = z.infer<typeof updateInstallationOrderSchema>

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path.join('.') || 'form'
    fieldErrors[field] ??= issue.message
  }
  return fieldErrors
}

export async function parseCreateInstallationOrder(
  input: unknown,
  employeeActivity: EmployeeActivityLookup = {},
): Promise<CreateInstallationOrderInput> {
  const parsed = createInstallationOrderSchema.safeParse(input)
  if (!parsed.success) throw new InstallationOrderValidationError(fieldErrorsFrom(parsed.error))

  const fieldErrors: Record<string, string> = {}
  if (parsed.data.primaryEmployeeId === parsed.data.backupEmployeeId) {
    fieldErrors.backupEmployeeId = 'Opiekun i zastępca muszą być różnymi osobami.'
  }

  if (employeeActivity.isEmployeeActive) {
    const [primaryActive, backupActive] = await Promise.all([
      employeeActivity.isEmployeeActive(parsed.data.primaryEmployeeId),
      employeeActivity.isEmployeeActive(parsed.data.backupEmployeeId),
    ])
    if (!primaryActive) fieldErrors.primaryEmployeeId = 'Wybrany opiekun nie jest aktywnym pracownikiem.'
    if (!backupActive) fieldErrors.backupEmployeeId = 'Wybrany zastępca nie jest aktywnym pracownikiem.'
  }

  if (Object.keys(fieldErrors).length > 0) throw new InstallationOrderValidationError(fieldErrors)

  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined),
  ) as CreateInstallationOrderInput
}

export function parseUpdateInstallationOrder(input: unknown): UpdateInstallationOrderInput {
  const parsed = updateInstallationOrderSchema.safeParse(input)
  if (!parsed.success) throw new InstallationOrderValidationError(fieldErrorsFrom(parsed.error))
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined),
  ) as UpdateInstallationOrderInput
}
