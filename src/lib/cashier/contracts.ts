import { z } from 'zod'

// Prisma/SQLite Int is a signed 32-bit value. New monetary inputs are PLN cents.
export const MAX_MONEY_CENTS = 2_147_483_647
export const CASHIER_CENTERS = ['PUL', 'JAG'] as const
export type CashierCenterId = typeof CASHIER_CENTERS[number]
export const CashierCenterSchema = z.enum(CASHIER_CENTERS)
export const CashierMoneySchema = z.number().int().min(0).max(MAX_MONEY_CENTS)
export const CashierDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Podaj istniejącą datę w formacie RRRR-MM-DD.')
const IdSchema = z.string().trim().min(1).max(150)
const VersionSchema = z.number().int().positive().max(MAX_MONEY_CENTS)
const NoteSchema = z.string().trim().max(2000).nullable().optional()
const ReasonSchema = z.string().trim().min(3, 'Podaj powód (co najmniej 3 znaki).').max(2000)
const base = { costCenterId: CashierCenterSchema }
const reportVersion = { ...base, reportId: IdSchema, version: VersionSchema }
const operationFields = {
  kind: z.enum(['SALES_REFUND', 'DEPOSIT_IN', 'DEPOSIT_REFUND']),
  method: z.enum(['CASH', 'CARD']),
  amountCents: CashierMoneySchema.positive(),
  reference: z.string().trim().min(1, 'Numer dokumentu lub referencja są wymagane.').max(200),
  note: NoteSchema,
}

export const CashierQuerySchema = z.object({
  costCenterId: CashierCenterSchema.optional(),
  reportId: IdSchema.optional(),
  from: CashierDateSchema.optional(),
  to: CashierDateSchema.optional(),
  // Keep the resulting offset within Prisma's signed 32-bit skip argument.
  auditPage: z.union([z.number(), z.string().regex(/^[1-9]\d*$/).transform(Number)])
    .pipe(z.number().int().positive().max(21_474_837)).default(1),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, {
  message: 'Data początkowa nie może być późniejsza niż końcowa.',
})
export type CashierQuery = z.infer<typeof CashierQuerySchema>

export const CashierCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('setup'), ...base,
    startDate: CashierDateSchema,
    initialCashCents: CashierMoneySchema,
    targetFloatCents: CashierMoneySchema,
    cashAccountId: IdSchema.optional(),
    newAccountName: z.string().trim().min(1).max(100).optional(),
    noDuplicateCashConfirmed: z.literal(true).optional(),
    sourceReportConfirmed: z.literal(true),
    note: NoteSchema,
  }).strict().superRefine((value, ctx) => {
    if (Boolean(value.cashAccountId) === Boolean(value.newAccountName)) {
      ctx.addIssue({ code: 'custom', message: 'Wybierz istniejący rachunek albo podaj nazwę nowego rachunku.' })
    }
    if (value.newAccountName && !value.noDuplicateCashConfirmed) {
      ctx.addIssue({ code: 'custom', message: 'Potwierdź, że gotówka nowego rachunku nie jest już wykazana na innym rachunku.' })
    }
  }),
  z.object({ action: z.literal('setTarget'), ...base, version: VersionSchema, targetFloatCents: CashierMoneySchema, reason: ReasonSchema }).strict(),
  z.object({ action: z.literal('createReport'), ...base, businessDate: CashierDateSchema }).strict(),
  z.object({
    action: z.literal('updateReport'), ...reportVersion,
    cashReceiptsCents: CashierMoneySchema.nullable().optional(),
    cardReceiptsCents: CashierMoneySchema.nullable().optional(),
    countedCents: CashierMoneySchema.nullable().optional(),
    note: NoteSchema,
  }).strict().refine((value) => ['cashReceiptsCents', 'cardReceiptsCents', 'countedCents', 'note'].some((key) => key in value), 'Podaj przynajmniej jedno pole do zapisania.'),
  z.object({ action: z.literal('addOperation'), ...reportVersion, ...operationFields }).strict(),
  z.object({ action: z.literal('updateOperation'), ...reportVersion, operationId: IdSchema, ...operationFields }).strict(),
  z.object({ action: z.literal('cancelOperation'), ...reportVersion, operationId: IdSchema, reason: ReasonSchema }).strict(),
  z.object({
    action: z.literal('closeReport'), ...reportVersion,
    requestId: z.string().trim().min(8).max(150),
    retainedConfirmed: z.literal(true), depositConfirmed: z.literal(true),
    reason: z.string().trim().max(2000).optional(),
  }).strict(),
  z.object({
    action: z.literal('correctReport'), ...reportVersion,
    cashReceiptsCents: CashierMoneySchema,
    cardReceiptsCents: CashierMoneySchema,
    countedCents: CashierMoneySchema,
    retainedConfirmed: z.literal(true), depositConfirmed: z.literal(true),
    reason: ReasonSchema,
  }).strict(),
  z.object({
    action: z.literal('receiveDeposit'), ...base, depositId: IdSchema, version: VersionSchema,
    destinationAccountId: IdSchema, physicalReceiptConfirmed: z.literal(true),
  }).strict(),
  z.object({
    action: z.literal('verifyDeposit'), ...base, depositId: IdSchema, version: VersionSchema,
    actualCents: CashierMoneySchema, countedConfirmed: z.literal(true),
    reason: z.string().trim().max(2000).optional(),
  }).strict(),
])
export type CashierCommand = z.infer<typeof CashierCommandSchema>
export type CashierOperationKind = z.infer<typeof operationFields.kind>
export type CashierPaymentMethod = z.infer<typeof operationFields.method>
export type CashierDepositStatus = 'WAITING' | 'RECEIVED' | 'VERIFIED' | 'DISCREPANCY' | 'VOID'

export interface CashierActor {
  id: string
  name: string
  role: 'ADMIN' | 'EMPLOYEE'
  costCenterId: CashierCenterId | null
}

export interface CashierAccount {
  id: string
  name: string
  balanceCents: number
  managedByCostCenterId: CashierCenterId | null
}

export interface CashierSettings {
  costCenterId: CashierCenterId
  cashAccountId: string
  cashAccountName: string
  balanceCents: number
  targetFloatCents: number
  initialCashCents: number
  startDate: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface CashierOperation {
  id: string
  reportId: string
  kind: CashierOperationKind
  method: CashierPaymentMethod
  amountCents: number
  reference: string
  note: string | null
  createdById: string
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CashierDeposit {
  id: string
  reportId: string
  costCenterId: CashierCenterId
  businessDate: string
  declaredCents: number
  status: CashierDepositStatus
  version: number
  destinationAccountId: string | null
  destinationAccountName: string | null
  receivedById: string | null
  receivedAt: string | null
  actualCents: number | null
  verifiedById: string | null
  verifiedAt: string | null
  verificationNote: string | null
  createdAt: string
  updatedAt: string
}

export interface CashierReport {
  id: string
  costCenterId: CashierCenterId
  businessDate: string
  status: 'DRAFT' | 'CLOSED'
  openingCents: number
  targetFloatCents: number
  cashReceiptsCents: number | null
  cardReceiptsCents: number | null
  countedCents: number | null
  expectedCents: number | null
  differenceCents: number | null
  retainedCents: number | null
  depositCents: number | null
  shortfallCents: number | null
  note: string | null
  version: number
  createdById: string
  closedById: string | null
  closedAt: string | null
  closeRequestId: string | null
  createdAt: string
  updatedAt: string
  operations: CashierOperation[]
  deposit: CashierDeposit | null
  canCorrect: boolean
}

export interface CashierAuditEntry {
  id: string
  costCenterId: CashierCenterId
  entityType: string
  entityId: string
  action: string
  actorId: string
  actorName: string
  beforeJson: string | null
  afterJson: string
  reason: string | null
  createdAt: string
}

export interface CashierBootstrap {
  actor: CashierActor
  centers: Array<{ id: CashierCenterId; name: string; configured: boolean }>
  selectedCostCenterId: CashierCenterId
  today: string
  settings: CashierSettings | null
  // Admin-only account choices. Employees receive [].
  accounts: CashierAccount[]
  reports: CashierReport[]
  selectedReport: CashierReport | null
  /** Current draft, independent of from/to history filters. */
  openReport: CashierReport | null
  deposits: CashierDeposit[]
  audit: CashierAuditEntry[]
  auditPage: number
  auditHasMore: boolean
  waitingDepositsCents: number
  reportsTruncated: boolean
  depositsTruncated: boolean
  auditTruncated: boolean
}

export interface CashierCommandResult {
  ok: true
  reportId?: string
  depositId?: string
  replayed?: boolean
}

export interface CashierErrorResponse {
  error: string
  code: string
}
