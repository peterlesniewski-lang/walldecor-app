import { z } from 'zod'
import { Prisma, PrismaClient } from '@/generated/prisma'

type InstallationDb = PrismaClient | Prisma.TransactionClient

export class InstallationGovernanceValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Dane zasad odpowiedzialności są niepoprawne.')
    this.name = 'InstallationGovernanceValidationError'
  }
}

const requiredDate = z.preprocess(
  (value) => value === null || value === '' ? undefined : value,
  z.union([
    z.date(),
    z.string().trim().min(1).pipe(z.coerce.date()),
  ]),
)

const delegationSchema = z.object({
  delegateEmployeeId: z.string().trim().min(1, 'Wybierz osobę przejmującą kartę.'),
  startsAt: requiredDate,
  endsAt: requiredDate,
  reason: z.string().trim().min(3, 'Podaj powód delegacji.').max(1_000),
}).strict()

const visitFeeOverrideSchema = z.object({
  grossAmount: z.string().trim().regex(/^\d+(?:[,.]\d{1,2})?$/, 'Podaj dodatnią kwotę brutto.'),
  reason: z.string().trim().min(3, 'Podaj uzasadnienie innej kwoty.').max(1_000),
}).strict()

const ownershipSchema = z.object({
  primaryEmployeeId: z.string().trim().min(1, 'Wybierz głównego opiekuna.'),
  backupEmployeeId: z.string().trim().min(1, 'Wybierz zastępcę opiekuna.'),
}).strict()

const optionalLegalDate = z.preprocess(
  (value) => value === '' ? null : value,
  z.union([z.date(), z.string().trim().min(1).pipe(z.coerce.date())]).nullable().optional(),
)

const visitFeePolicySchema = z.object({
  grossAmount: z.string().trim().regex(/^\d+(?:[,.]\d{1,2})?$/, 'Podaj dodatnią kwotę brutto.'),
  clauseText: z.string().trim().min(20, 'Podaj pełną treść klauzuli.').max(12_000),
  legalApprovedAt: optionalLegalDate,
  isDefault: z.boolean().optional(),
}).strict()

const mismatchSchema = z.object({
  description: z.string().trim().min(10, 'Opisz niezgodność rzeczywistego stanu.').max(4_000),
  reason: z.enum(['CANNOT_PERFORM', 'EXECUTION_RISK']),
  evidenceReference: z.string().trim().min(8, 'Dołącz zweryfikowaną referencję dowodu.').max(1_000),
}).strict()

const mismatchApprovalSchema = z.object({
  note: z.string().trim().min(3, 'Dodaj krótką notatkę zatwierdzającą.').max(2_000),
}).strict()

function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [issue.path.join('.') || 'form', issue.message]))
}

function governanceError(fieldErrorsValue: Record<string, string>): never {
  throw new InstallationGovernanceValidationError(fieldErrorsValue)
}

/** Validates a temporary delegation without consulting holidays or leave records. */
export function parseInstallationDelegationInput(
  input: unknown,
  owners: { primaryEmployeeId: string; backupEmployeeId: string },
) {
  const parsed = delegationSchema.safeParse(input)
  if (!parsed.success) governanceError(fieldErrors(parsed.error))
  const errors: Record<string, string> = {}
  if (parsed.data.delegateEmployeeId === owners.primaryEmployeeId || parsed.data.delegateEmployeeId === owners.backupEmployeeId) {
    errors.delegateEmployeeId = 'Delegacja dotyczy trzeciej osoby — opiekun i zastępca mają już dostęp do karty.'
  }
  if (parsed.data.endsAt <= parsed.data.startsAt) {
    errors.endsAt = 'Koniec delegacji musi przypadać po jej rozpoczęciu.'
  }
  if (Object.keys(errors).length > 0) governanceError(errors)
  return parsed.data
}

/** Decimal strings avoid binary-float drift when an amount becomes a legal snapshot. */
export function parseVisitFeeOverrideInput(input: unknown) {
  const parsed = visitFeeOverrideSchema.safeParse(input)
  if (!parsed.success) governanceError(fieldErrors(parsed.error))
  return { grossAmount: canonicalGrossAmount(parsed.data.grossAmount), reason: parsed.data.reason }
}

function canonicalGrossAmount(input: string): string {
  const [integerRaw, fractionalRaw = ''] = input.replace(',', '.').split('.')
  const integer = integerRaw.replace(/^0+(?=\d)/, '') || '0'
  const cents = fractionalRaw.padEnd(2, '0')
  // We preserve exact cents instead of relying on IEEE-754 conversion. The
  // ceiling prevents an accidental multi-billion value in the legal snapshot.
  if (integer.length > 9 || (integer === '0' && cents === '00')) {
    governanceError({ grossAmount: 'Podaj dodatnią kwotę brutto do 999 999 999,99 zł.' })
  }
  return `${integer}.${cents}`
}

function parseVisitFeePolicyInput(input: unknown) {
  const parsed = visitFeePolicySchema.safeParse(input)
  if (!parsed.success) governanceError(fieldErrors(parsed.error))
  return {
    grossAmount: canonicalGrossAmount(parsed.data.grossAmount),
    clauseText: parsed.data.clauseText,
    legalApprovedAt: parsed.data.legalApprovedAt ?? null,
    isDefault: parsed.data.isDefault ?? true,
  }
}

function parseOwnershipInput(input: unknown) {
  const parsed = ownershipSchema.safeParse(input)
  if (!parsed.success) governanceError(fieldErrors(parsed.error))
  if (parsed.data.primaryEmployeeId === parsed.data.backupEmployeeId) {
    governanceError({ backupEmployeeId: 'Opiekun i zastępca muszą być różnymi osobami.' })
  }
  return parsed.data
}

function parseMismatchInput(input: unknown) {
  const parsed = mismatchSchema.safeParse(input)
  if (!parsed.success) governanceError(fieldErrors(parsed.error))
  return parsed.data
}

function toMoneyString(value: Prisma.Decimal | null) {
  if (!value) return null
  const [integer, cents = ''] = value.toFixed(2).split('.')
  return `${integer}.${cents}`
}

function feeAuditSnapshot(order: {
  visitFeePolicyId: string | null
  visitFeeStatus: string
  visitFeeGrossAmount: Prisma.Decimal | null
  visitFeeClauseVersion: number | null
  visitFeeLegalApprovedAt: Date | null
  visitFeeSelectedAt: Date | null
  visitFeeApprovedAt: Date | null
  visitFeeClientAcceptedAt: Date | null
}) {
  return {
    policyId: order.visitFeePolicyId,
    status: order.visitFeeStatus,
    grossAmount: toMoneyString(order.visitFeeGrossAmount),
    clauseVersion: order.visitFeeClauseVersion,
    legalApprovedAt: order.visitFeeLegalApprovedAt?.toISOString() ?? null,
    selectedAt: order.visitFeeSelectedAt?.toISOString() ?? null,
    approvedAt: order.visitFeeApprovedAt?.toISOString() ?? null,
    clientAcceptedAt: order.visitFeeClientAcceptedAt?.toISOString() ?? null,
  }
}

async function activeEmployeeIds(db: InstallationDb, ids: string[]) {
  const employees = await db.employee.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } })
  return new Set(employees.map((employee) => employee.id))
}

async function activeOrderOrThrow(db: InstallationDb, orderId: string) {
  const order = await db.installationOrder.findUnique({ where: { id: orderId } })
  if (!order || order.archivedAt || order.status === 'ARCHIVED') {
    throw new InstallationGovernanceValidationError({ orderId: 'Ta karta montażu nie jest aktywna.' })
  }
  return order
}

async function assertLegalPolicy(policy: { legalApprovedAt: Date | null }) {
  if (!policy.legalApprovedAt) {
    governanceError({ visitFee: 'Nie można aktywować klauzuli bez zapisanej daty zatwierdzenia prawnego.' })
  }
}

function feeSnapshotFromPolicy(policy: {
  id: string
  grossAmount: Prisma.Decimal
  clauseText: string
  version: number
  legalApprovedAt: Date | null
}, values: { status: 'APPROVED' | 'PENDING_APPROVAL'; actorId: string; overrideReason?: string | null }) {
  const now = new Date()
  return {
    visitFeePolicyId: policy.id,
    visitFeeStatus: values.status,
    visitFeeGrossAmount: policy.grossAmount,
    visitFeeClauseText: policy.clauseText,
    visitFeeClauseVersion: policy.version,
    visitFeeLegalApprovedAt: policy.legalApprovedAt,
    visitFeeSelectedById: values.actorId,
    visitFeeSelectedAt: now,
    visitFeeOverrideReason: values.overrideReason ?? null,
    visitFeeApprovedById: values.status === 'APPROVED' ? values.actorId : null,
    visitFeeApprovedAt: values.status === 'APPROVED' ? now : null,
    visitFeeClientAcceptedAt: null,
    visitFeeClientIpHash: null,
    visitFeeClientUserAgent: null,
  }
}

/** Only active, distinct people can replace the two mandatory named owners. */
export async function changeInstallationOwnership(
  db: PrismaClient,
  orderId: string,
  input: unknown,
  actorId: string,
) {
  const owners = parseOwnershipInput(input)
  return db.$transaction(async (tx) => {
    const current = await activeOrderOrThrow(tx, orderId)
    const active = await activeEmployeeIds(tx, [owners.primaryEmployeeId, owners.backupEmployeeId])
    const errors: Record<string, string> = {}
    if (!active.has(owners.primaryEmployeeId)) errors.primaryEmployeeId = 'Wybrany opiekun nie jest aktywnym pracownikiem.'
    if (!active.has(owners.backupEmployeeId)) errors.backupEmployeeId = 'Wybrany zastępca nie jest aktywnym pracownikiem.'
    if (Object.keys(errors).length > 0) governanceError(errors)
    const changed = await tx.installationOrder.update({ where: { id: orderId }, data: owners })
    await tx.installationAuditEvent.create({
      data: {
        orderId,
        actorId,
        action: 'INSTALLATION_OWNERS_CHANGED',
        beforeJson: JSON.stringify({ primaryEmployeeId: current.primaryEmployeeId, backupEmployeeId: current.backupEmployeeId }),
        afterJson: JSON.stringify({ primaryEmployeeId: changed.primaryEmployeeId, backupEmployeeId: changed.backupEmployeeId }),
      },
    })
    return changed
  })
}

/** Creates a time-bounded delegation. It intentionally has no dependency on leave approval. */
export async function createInstallationDelegation(
  db: PrismaClient,
  orderId: string,
  input: unknown,
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    const order = await activeOrderOrThrow(tx, orderId)
    const delegation = parseInstallationDelegationInput(input, order)
    if (!(await activeEmployeeIds(tx, [delegation.delegateEmployeeId])).has(delegation.delegateEmployeeId)) {
      governanceError({ delegateEmployeeId: 'Osoba przejmująca musi być aktywnym pracownikiem.' })
    }
    const created = await tx.installationDelegation.create({ data: { orderId, ...delegation } })
    await tx.installationAuditEvent.create({
      data: {
        orderId,
        actorId,
        action: 'INSTALLATION_DELEGATION_CREATED',
        beforeJson: JSON.stringify({ delegationId: null, delegateEmployeeId: null, startsAt: null, endsAt: null, reason: null }),
        afterJson: JSON.stringify({ delegationId: created.id, delegateEmployeeId: created.delegateEmployeeId, startsAt: created.startsAt.toISOString(), endsAt: created.endsAt?.toISOString() ?? null, reason: created.reason }),
      },
    })
    return created
  })
}

/** Ends access immediately; an already ended delegation is returned unchanged and not re-audited. */
export async function endInstallationDelegation(
  db: PrismaClient,
  orderId: string,
  delegationId: string,
  actorId: string,
  endedAt = new Date(),
) {
  return db.$transaction(async (tx) => {
    await activeOrderOrThrow(tx, orderId)
    const current = await tx.installationDelegation.findUnique({ where: { id: delegationId } })
    if (!current || current.orderId !== orderId) governanceError({ delegationId: 'Nie znaleziono delegacji tej karty.' })
    if (current.endedAt) return current
    const ended = await tx.installationDelegation.update({ where: { id: delegationId }, data: { endedAt } })
    await tx.installationAuditEvent.create({
      data: {
        orderId,
        actorId,
        action: 'INSTALLATION_DELEGATION_ENDED',
        beforeJson: JSON.stringify({ delegationId, delegateEmployeeId: current.delegateEmployeeId, endedAt: null }),
        afterJson: JSON.stringify({ delegationId, delegateEmployeeId: ended.delegateEmployeeId, endedAt: ended.endedAt?.toISOString() ?? null }),
      },
    })
    return ended
  })
}

/** Adds a company policy version. A blank legal approval deliberately remains inactive. */
export async function createInstallationVisitFeePolicy(db: PrismaClient, input: unknown, actorId: string) {
  const value = parseVisitFeePolicyInput(input)
  return db.$transaction(async (tx) => {
    const current = await tx.installationVisitFeePolicy.aggregate({ _max: { version: true } })
    if (value.isDefault) {
      await tx.installationVisitFeePolicy.updateMany({ where: { isDefault: true, archivedAt: null }, data: { isDefault: false } })
    }
    return tx.installationVisitFeePolicy.create({
      data: {
        version: (current._max.version ?? 0) + 1,
        grossAmount: value.grossAmount,
        clauseText: value.clauseText,
        legalApprovedAt: value.legalApprovedAt,
        legalApprovedById: value.legalApprovedAt ? actorId : null,
        isDefault: value.isDefault,
        createdById: actorId,
      },
    })
  })
}

async function currentDefaultPolicyOrThrow(db: InstallationDb) {
  const policy = await db.installationVisitFeePolicy.findFirst({ where: { isDefault: true, archivedAt: null }, orderBy: { version: 'desc' } })
  if (!policy) governanceError({ visitFee: 'Brakuje firmowej domyślnej klauzuli opłaty za podjazd.' })
  return policy
}

/** Copies the approved default into the order; later policy edits cannot mutate history. */
export async function selectDefaultInstallationVisitFee(db: PrismaClient, orderId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const current = await activeOrderOrThrow(tx, orderId)
    const policy = await currentDefaultPolicyOrThrow(tx)
    await assertLegalPolicy(policy)
    const updated = await tx.installationOrder.update({
      where: { id: orderId },
      data: feeSnapshotFromPolicy(policy, { status: 'APPROVED', actorId }),
    })
    await tx.installationAuditEvent.create({
      data: { orderId, actorId, action: 'INSTALLATION_VISIT_FEE_DEFAULT_SELECTED', beforeJson: JSON.stringify(feeAuditSnapshot(current)), afterJson: JSON.stringify(feeAuditSnapshot(updated)) },
    })
    return updated
  })
}

/** Any project-specific amount is held for admin/manager approval before a client can see it. */
export async function requestInstallationVisitFeeOverride(db: PrismaClient, orderId: string, input: unknown, actorId: string) {
  const override = parseVisitFeeOverrideInput(input)
  return db.$transaction(async (tx) => {
    const current = await activeOrderOrThrow(tx, orderId)
    const policy = await currentDefaultPolicyOrThrow(tx)
    await assertLegalPolicy(policy)
    const now = new Date()
    const updated = await tx.installationOrder.update({
      where: { id: orderId },
      data: {
        ...feeSnapshotFromPolicy(policy, { status: 'PENDING_APPROVAL', actorId, overrideReason: override.reason }),
        visitFeeGrossAmount: override.grossAmount,
        visitFeeSelectedAt: now,
      },
    })
    await tx.installationAuditEvent.create({
      data: { orderId, actorId, action: 'INSTALLATION_VISIT_FEE_OVERRIDE_REQUESTED', beforeJson: JSON.stringify(feeAuditSnapshot(current)), afterJson: JSON.stringify(feeAuditSnapshot(updated)) },
    })
    return updated
  })
}

export async function approveInstallationVisitFeeOverride(db: PrismaClient, orderId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const current = await activeOrderOrThrow(tx, orderId)
    if (current.visitFeeStatus !== 'PENDING_APPROVAL' || !current.visitFeeLegalApprovedAt || !current.visitFeeGrossAmount || !current.visitFeeClauseText || !current.visitFeeClauseVersion) {
      governanceError({ visitFee: 'Nie ma oczekującej, kompletnej opłaty do zatwierdzenia.' })
    }
    const now = new Date()
    const updated = await tx.installationOrder.update({
      where: { id: orderId },
      data: { visitFeeStatus: 'APPROVED', visitFeeApprovedById: actorId, visitFeeApprovedAt: now, visitFeeClientAcceptedAt: null, visitFeeClientIpHash: null, visitFeeClientUserAgent: null },
    })
    await tx.installationAuditEvent.create({
      data: { orderId, actorId, action: 'INSTALLATION_VISIT_FEE_OVERRIDE_APPROVED', beforeJson: JSON.stringify(feeAuditSnapshot(current)), afterJson: JSON.stringify(feeAuditSnapshot(updated)) },
    })
    return updated
  })
}

export async function rejectInstallationVisitFeeOverride(db: PrismaClient, orderId: string, actorId: string, reason: string) {
  const note = reason.trim()
  if (note.length < 3) governanceError({ reason: 'Podaj powód odrzucenia opłaty.' })
  return db.$transaction(async (tx) => {
    const current = await activeOrderOrThrow(tx, orderId)
    if (current.visitFeeStatus !== 'PENDING_APPROVAL') governanceError({ visitFee: 'Nie ma opłaty oczekującej na decyzję.' })
    const updated = await tx.installationOrder.update({ where: { id: orderId }, data: { visitFeeStatus: 'REJECTED', visitFeeApprovedById: actorId, visitFeeApprovedAt: new Date(), visitFeeOverrideReason: note, visitFeeClientAcceptedAt: null, visitFeeClientIpHash: null, visitFeeClientUserAgent: null } })
    await tx.installationAuditEvent.create({ data: { orderId, actorId, action: 'INSTALLATION_VISIT_FEE_OVERRIDE_REJECTED', beforeJson: JSON.stringify(feeAuditSnapshot(current)), afterJson: JSON.stringify(feeAuditSnapshot(updated)) } })
    return updated
  })
}

export async function createInstallationMismatch(db: PrismaClient, orderId: string, input: unknown, reporterId: string) {
  const value = parseMismatchInput(input)
  return db.$transaction(async (tx) => {
    await activeOrderOrThrow(tx, orderId)
    const mismatch = await tx.installationMismatch.create({ data: { orderId, ...value, reportedById: reporterId } })
    await tx.installationAuditEvent.create({ data: { orderId, actorId: reporterId, action: 'INSTALLATION_MISMATCH_REPORTED', afterJson: JSON.stringify({ mismatchId: mismatch.id, reason: mismatch.reason, evidenceReference: mismatch.evidenceReference }) } })
    return mismatch
  })
}

export async function approveInstallationMismatchForBilling(db: PrismaClient, orderId: string, mismatchId: string, input: unknown, actorId: string) {
  const parsed = mismatchApprovalSchema.safeParse(input)
  if (!parsed.success) governanceError(fieldErrors(parsed.error))
  return db.$transaction(async (tx) => {
    const order = await activeOrderOrThrow(tx, orderId)
    if (!isClientVisitFeeActive({ status: order.visitFeeStatus, grossAmount: toMoneyString(order.visitFeeGrossAmount), clauseText: order.visitFeeClauseText, clauseVersion: order.visitFeeClauseVersion, legalApprovedAt: order.visitFeeLegalApprovedAt }) || !order.visitFeeClientAcceptedAt || !order.visitFeeGrossAmount) {
      governanceError({ visitFee: 'Nie można utworzyć zadania bez zaakceptowanej przez klienta, zatwierdzonej klauzuli.' })
    }
    const mismatch = await tx.installationMismatch.findUnique({ where: { id: mismatchId } })
    if (!mismatch || mismatch.orderId !== orderId) governanceError({ mismatchId: 'Nie znaleziono niezgodności tej karty.' })
    const now = new Date()
    if (!mismatch.coordinatorApprovedAt) {
      await tx.installationMismatch.update({ where: { id: mismatchId }, data: { coordinatorApprovedAt: now, coordinatorApprovedById: actorId, approvalNote: parsed.data.note } })
      await tx.installationAuditEvent.create({ data: { orderId, actorId, action: 'INSTALLATION_MISMATCH_APPROVED_FOR_BILLING', afterJson: JSON.stringify({ mismatchId, approvedAt: now.toISOString() }) } })
    }
    const existing = await tx.installationBillingTask.findUnique({ where: { mismatchId } })
    if (existing) return existing
    return tx.installationBillingTask.create({
      data: {
        orderId,
        mismatchId,
        kind: 'MISMATCH_VISIT_FEE',
        status: 'PENDING',
        grossAmount: order.visitFeeGrossAmount,
        description: mismatch.description,
        createdById: actorId,
      },
    })
  })
}

export async function getInstallationOwnershipView(db: InstallationDb, orderId: string) {
  const order = await db.installationOrder.findUnique({
    where: { id: orderId },
    select: {
      primaryEmployee: { select: { id: true, firstName: true, lastName: true, active: true } },
      backupEmployee: { select: { id: true, firstName: true, lastName: true, active: true } },
      delegations: {
        orderBy: { createdAt: 'desc' },
        include: { delegateEmployee: { select: { id: true, firstName: true, lastName: true, active: true } } },
      },
      auditEvents: {
        where: { action: { in: ['INSTALLATION_OWNERS_CHANGED', 'INSTALLATION_DELEGATION_CREATED', 'INSTALLATION_DELEGATION_ENDED'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, action: true, actorId: true, beforeJson: true, afterJson: true, createdAt: true },
      },
    },
  })
  if (!order) governanceError({ orderId: 'Nie znaleziono karty montażu.' })
  return order
}

export async function getInstallationVisitFeeView(db: InstallationDb, orderId: string) {
  const [order, defaultPolicy] = await Promise.all([
    db.installationOrder.findUnique({
      where: { id: orderId },
      select: {
        visitFeeStatus: true,
        visitFeeGrossAmount: true,
        visitFeeClauseVersion: true,
        visitFeeLegalApprovedAt: true,
        visitFeeSelectedAt: true,
        visitFeeOverrideReason: true,
        visitFeeApprovedAt: true,
        visitFeeClientAcceptedAt: true,
      },
    }),
    db.installationVisitFeePolicy.findFirst({
      where: { isDefault: true, archivedAt: null },
      orderBy: { version: 'desc' },
      select: { version: true, grossAmount: true, legalApprovedAt: true },
    }),
  ])
  if (!order) governanceError({ orderId: 'Nie znaleziono karty montażu.' })
  return {
    fee: {
      status: order.visitFeeStatus,
      grossAmount: toMoneyString(order.visitFeeGrossAmount),
      clauseVersion: order.visitFeeClauseVersion,
      legalApprovedAt: order.visitFeeLegalApprovedAt,
      selectedAt: order.visitFeeSelectedAt,
      overrideReason: order.visitFeeOverrideReason,
      approvedAt: order.visitFeeApprovedAt,
      clientAcceptedAt: order.visitFeeClientAcceptedAt,
    },
    defaultPolicy: defaultPolicy ? {
      version: defaultPolicy.version,
      grossAmount: toMoneyString(defaultPolicy.grossAmount)!,
      legalApprovedAt: defaultPolicy.legalApprovedAt,
    } : null,
  }
}

export async function listInstallationVisitFeePolicies(db: InstallationDb) {
  const policies = await db.installationVisitFeePolicy.findMany({
    where: { archivedAt: null },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, grossAmount: true, clauseText: true, legalApprovedAt: true, isDefault: true, createdAt: true },
  })
  return policies.map((policy) => ({ ...policy, grossAmount: toMoneyString(policy.grossAmount)! }))
}

export type ClientVisitFeeCandidate = {
  status: string
  grossAmount: string | null
  clauseText: string | null
  clauseVersion: number | null
  legalApprovedAt: Date | null
}

/** An unapproved legal clause is invisible and cannot change public submit requirements. */
export function isClientVisitFeeActive(candidate: ClientVisitFeeCandidate): boolean {
  return candidate.status === 'APPROVED' &&
    candidate.grossAmount !== null &&
    candidate.clauseText !== null && candidate.clauseText.trim() !== '' &&
    candidate.clauseVersion !== null &&
    candidate.legalApprovedAt !== null
}
