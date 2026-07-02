import { z } from 'zod'
import { normalizeSupplierNip } from '@/lib/finance/ksef-inbox'

export const VALID_KSEF_STATUSES = ['NEW', 'MAPPED', 'APPROVED', 'IGNORED'] as const
export const VALID_COST_CENTERS = ['JAG', 'PUL', 'GLOBAL'] as const
export const VALID_PAYMENT_STATUSES = ['UNPAID', 'PAID'] as const
export const VALID_PAYMENT_DEADLINES = ['OVERDUE', 'DUE_0_7', 'DUE_8_14', 'DUE_15_30', 'LATER', 'MISSING_DUE_DATE'] as const
export const VALID_DOCUMENT_STATUSES = ['ACTIVE', 'CORRECTED', 'CORRECTION', 'CANCELLED'] as const
export const VALID_RULE_MATCH_STATUSES = ['NO_RULE', 'MATCHED', 'CONFLICT'] as const

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || undefined : value),
  z.string().max(120).optional()
)

const optionalNonNegativeNumber = z.preprocess(
  (value) => (value === '' || value == null ? undefined : value),
  z.coerce.number().nonnegative().optional()
)

export const KsefInvoiceCreateSchema = z.object({
  supplierName: z.string().trim().min(1, 'Podaj nazwę dostawcy'),
  supplierNip: z
    .string()
    .trim()
    .optional()
    .transform((value) => normalizeSupplierNip(value)),
  invoiceNumber: z.string().trim().min(1, 'Podaj numer faktury'),
  issueDate: z.string().trim().refine(isIsoDate, 'Data musi mieć format YYYY-MM-DD'),
  grossAmount: z.coerce.number().positive('Kwota brutto musi być większa od zera'),
  netAmount: z.coerce.number().nonnegative('Kwota netto nie może być ujemna').optional(),
  vatAmount: z.coerce.number().nonnegative('VAT nie może być ujemny').optional(),
  currency: z.string().trim().length(3).default('PLN').transform((value) => value.toUpperCase()),
  notes: z.string().trim().optional(),
})

export const KsefInvoiceUpdateSchema = z.object({
  status: z.enum(VALID_KSEF_STATUSES).optional(),
  costCenterId: z.enum(VALID_COST_CENTERS).optional(),
  subCategoryId: z.string().trim().min(1).optional(),
  tagIds: z.array(z.string().trim().min(1)).optional(),
  notes: z.string().trim().optional(),
})

export const KsefInvoiceQuerySchema = z.object({
  status: z.enum(VALID_KSEF_STATUSES).optional(),
  paymentStatus: z.enum(VALID_PAYMENT_STATUSES).optional(),
  paymentDeadline: z.enum(VALID_PAYMENT_DEADLINES).optional(),
  documentStatus: z.enum(VALID_DOCUMENT_STATUSES).optional(),
  ruleMatchStatus: z.enum(VALID_RULE_MATCH_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().refine((value) => [50, 100, 200].includes(value), {
    message: 'Liczba pozycji na stronie musi wynosić 50, 100 albo 200',
  }).default(50),
  search: optionalTrimmedString,
  amountMin: optionalNonNegativeNumber,
  amountMax: optionalNonNegativeNumber,
}).refine(
  (data) => data.amountMin == null || data.amountMax == null || data.amountMin <= data.amountMax,
  {
    message: 'Kwota od nie może być większa niż kwota do',
    path: ['amountMax'],
  }
)

export const KsefInvoicePaymentSchema = z.object({
  paymentStatus: z.enum(VALID_PAYMENT_STATUSES),
  paidAt: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
})

export const KsefInvoiceCurrencyConversionSchema = z.object({
  reportingGrossAmount: z.coerce.number().positive('Kwota brutto PLN musi być większa od zera'),
  reportingNetAmount: z.coerce.number().nonnegative('Kwota netto PLN nie może być ujemna').optional().nullable(),
  reportingVatAmount: z.coerce.number().nonnegative('VAT PLN nie może być ujemny').optional().nullable(),
  currencyConversionNote: z.string().trim().min(3, 'Dodaj krótką notatkę kursową'),
})

export const KsefSupplierRuleCreateSchema = z
  .object({
    supplierNamePattern: z.string().trim().optional(),
    supplierNip: z
      .string()
      .trim()
      .optional()
      .transform((value) => normalizeSupplierNip(value)),
    costCenterId: z.enum(VALID_COST_CENTERS),
    subCategoryId: z.string().trim().min(1).optional(),
    tagIds: z.array(z.string().trim().min(1)).optional(),
    priority: z.coerce.number().int().positive().optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.supplierNamePattern || data.supplierNip), {
    message: 'Podaj NIP dostawcy albo wzorzec nazwy',
    path: ['supplierNamePattern'],
  })

export type KsefInvoiceCreateInput = z.infer<typeof KsefInvoiceCreateSchema>
export type KsefInvoiceUpdateInput = z.infer<typeof KsefInvoiceUpdateSchema>
export type KsefInvoicePaymentInput = z.infer<typeof KsefInvoicePaymentSchema>
export type KsefInvoiceCurrencyConversionInput = z.infer<typeof KsefInvoiceCurrencyConversionSchema>
export type KsefSupplierRuleCreateInput = z.infer<typeof KsefSupplierRuleCreateSchema>
