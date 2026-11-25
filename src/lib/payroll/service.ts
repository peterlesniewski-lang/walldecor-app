import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@/generated/prisma'
import { buildCalendarSnapshot, type CalendarSnapshot } from './calendar'
import {
  isEmployedInPeriod,
  isFuturePeriod,
  payrollMonthKey,
  periodFirstDay,
  periodLastDay,
  periodTimeEntryQueryRange,
  previousPayrollPeriod,
  type PayrollPeriod,
} from './period'
import { summarizeSettlement, validatePayrollOfficeFigures, BLOCKER_LABELS, type PayrollBlocker } from './summary'
import { PayrollSheetRowSchema, type PayrollSettlementAction } from '@/lib/validations/payroll'
import type { AdjustmentKind, OvertimeResolution, PayrollBasis } from './types'
import { allocateEmployerCost, calculateEmployerCostGrosze } from './employer-cost'
import {
  isCalculatedEmployerCostStale,
  loadEmployerCostContext,
  loadEmployerCostContexts,
  type EmployerCostContext,
} from './cost-context'
import { describeCarryoverFlag, employmentInPeriod, evaluateCarryover, isPayAffectingLeave } from './carryover'
import { getWarsawBusinessDate } from '@/lib/hr/business-date'
import { isExternalContractor, STAFF_WHERE } from '@/lib/hr/contractors'
import {
  describePayInputChanges,
  evaluateChangeAfterApproval,
  type ChangeAfterApproval,
  type PayChangesAcknowledgement,
  type PayInputsState,
} from './pay-inputs'
import { withSystemActorName, type PayrollVersionOrigin } from './system-actor'

type Db = PrismaClient | Prisma.TransactionClient

export class PayrollError extends Error {
  constructor(message: string, readonly status = 400, readonly details?: unknown) {
    super(message)
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

const CLEAR_CONFIRMATION = {
  payrollOfficeConfirmedAt: null,
  payrollOfficeConfirmedById: null,
} as const

// Only fields safe for payroll screens; never the whole Employee record.
const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  position: true,
  costCenterId: true,
  employmentType: true,
  startDate: true,
  endDate: true,
  active: true,
} as const

export async function audit(
  tx: Db,
  event: {
    employeeId: string
    settlementId?: string | null
    action: string
    entityType: string
    entityId: string
    before?: unknown
    after?: unknown
    reason?: string | null
    actorId: string
  }
) {
  await tx.payrollAuditEvent.create({
    data: {
      employeeId: event.employeeId,
      settlementId: event.settlementId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      beforeJson: event.before === undefined || event.before === null ? null : JSON.stringify(event.before),
      afterJson: event.after === undefined || event.after === null ? null : JSON.stringify(event.after),
      reason: event.reason ?? null,
      actorId: event.actorId,
    },
  })
}

// ─── Base salary ─────────────────────────────────────────────────────────────

export async function listBaseSalaries(db: Db, employeeId: string) {
  return db.payrollBaseSalary.findMany({
    where: { employeeId },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function createBaseSalary(
  db: PrismaClient,
  actorId: string,
  input: { employeeId: string; effectiveFrom: string; amount: number; basis: PayrollBasis; note: string | null }
) {
  const employee = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } })
  if (!employee) throw new PayrollError('Pracownik nie istnieje.', 404)
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.payrollBaseSalary.create({
        data: {
          employeeId: input.employeeId,
          effectiveFrom: input.effectiveFrom,
          amountGrosze: input.amount,
          basis: input.basis,
          note: input.note,
          createdById: actorId,
        },
      })
      await audit(tx, {
        employeeId: row.employeeId,
        action: 'baseSalary.create',
        entityType: 'PayrollBaseSalary',
        entityId: row.id,
        after: { effectiveFrom: row.effectiveFrom, amountGrosze: row.amountGrosze, basis: row.basis, note: row.note },
        actorId,
      })
      return row
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PayrollError('Podstawa z tą datą obowiązywania już istnieje. Cofnij ją i dodaj ponownie.', 409)
    }
    throw error
  }
}

export async function revokeBaseSalary(db: PrismaClient, actorId: string, id: string, reason: string) {
  return db.$transaction(async (tx) => {
    const row = await tx.payrollBaseSalary.findUnique({ where: { id } })
    if (!row) throw new PayrollError('Podstawa nie istnieje.', 404)
    if (row.revokedAt) throw new PayrollError('Podstawa jest już cofnięta.', 409)
    const updated = await tx.payrollBaseSalary.update({
      where: { id },
      data: { revokedAt: new Date(), revokedById: actorId, revokeReason: reason },
    })
    await audit(tx, {
      employeeId: row.employeeId,
      action: 'baseSalary.revoke',
      entityType: 'PayrollBaseSalary',
      entityId: row.id,
      before: { effectiveFrom: row.effectiveFrom, amountGrosze: row.amountGrosze, basis: row.basis },
      reason,
      actorId,
    })
    return updated
  })
}

// ─── Calendar inputs ─────────────────────────────────────────────────────────

async function loadCalendarSnapshot(
  db: Db,
  employeeId: string,
  period: PayrollPeriod,
  existingLines: Array<{ timeEntryId: string; resolution: string | null; resolutionSource: string | null }> = []
): Promise<CalendarSnapshot> {
  const range = periodTimeEntryQueryRange(period)
  const [entries, overtimeRequests, baseSalaries] = await Promise.all([
    db.timeEntry.findMany({
      where: { employeeId, date: range },
      select: {
        id: true,
        date: true,
        status: true,
        clockOut: true,
        totalMinutes: true,
        breakMinutes: true,
        overtimeMinutes: true,
      },
    }),
    db.overtimeRequest.findMany({
      where: { employeeId, date: range },
      select: { date: true, status: true, resolution: true },
    }),
    db.payrollBaseSalary.findMany({
      where: { employeeId, effectiveFrom: { lte: periodLastDay(period) } },
      select: { id: true, amountGrosze: true, basis: true, effectiveFrom: true, revokedAt: true },
    }),
  ])
  return buildCalendarSnapshot({ period, entries, overtimeRequests, baseSalaries, existingLines })
}

function snapshotSettlementData(snapshot: CalendarSnapshot) {
  return {
    baseSalaryGrosze: snapshot.baseSalaryGrosze,
    baseBasis: snapshot.baseBasis,
    baseSegmentsJson: JSON.stringify(snapshot.baseSegments),
    approvedWorkedMinutes: snapshot.approvedWorkedMinutes,
    pendingEntryCount: snapshot.pendingEntryCount,
    calendarFingerprint: snapshot.fingerprint,
    calendarSyncedAt: new Date(),
  }
}

async function replaceOvertimeLines(tx: Db, settlementId: string, snapshot: CalendarSnapshot) {
  const keep = snapshot.lines.map((line) => line.timeEntryId)
  await tx.payrollOvertimeLine.deleteMany({ where: { settlementId, timeEntryId: { notIn: keep } } })
  for (const line of snapshot.lines) {
    await tx.payrollOvertimeLine.upsert({
      where: { settlementId_timeEntryId: { settlementId, timeEntryId: line.timeEntryId } },
      create: { settlementId, ...line },
      update: line,
    })
  }
}

// ─── Settlements ─────────────────────────────────────────────────────────────

type SettlementEmployee = { id: string; startDate: Date; endDate: Date | null }

/** Creates a draft settlement with a fresh calendar snapshot inside the caller's transaction. */
async function createSettlementInTx(tx: Db, actorId: string, employee: SettlementEmployee, period: PayrollPeriod) {
  const snapshot = await loadCalendarSnapshot(tx, employee.id, period)
  const settlement = await tx.payrollSettlement.create({
    data: {
      employeeId: employee.id,
      year: period.year,
      month: period.month,
      createdById: actorId,
      ...snapshotSettlementData(snapshot),
    },
  })
  await replaceOvertimeLines(tx, settlement.id, snapshot)
  await audit(tx, {
    employeeId: employee.id,
    settlementId: settlement.id,
    action: 'settlement.create',
    entityType: 'PayrollSettlement',
    entityId: settlement.id,
    after: {
      month: payrollMonthKey(period),
      baseSalaryGrosze: snapshot.baseSalaryGrosze,
      overtimeLines: snapshot.lines.length,
    },
    actorId,
  })
  return settlement
}

export async function createSettlement(
  db: PrismaClient,
  actorId: string,
  input: { employeeId: string; period: PayrollPeriod }
) {
  if (isFuturePeriod(input.period)) throw new PayrollError('Nie można rozliczyć przyszłego miesiąca.', 400)
  const employee = await db.employee.findUnique({ where: { id: input.employeeId }, select: EMPLOYEE_SELECT })
  if (!employee) throw new PayrollError('Pracownik nie istnieje.', 404)
  if (!isEmployedInPeriod(employee, input.period)) {
    throw new PayrollError('Pracownik nie był zatrudniony w tym miesiącu.', 409)
  }

  try {
    return await db.$transaction((tx) => createSettlementInTx(tx, actorId, employee, input.period))
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await db.payrollSettlement.findUnique({
        where: {
          employeeId_year_month: {
            employeeId: input.employeeId,
            year: input.period.year,
            month: input.period.month,
          },
        },
        select: { id: true },
      })
      throw new PayrollError('Rozliczenie tego miesiąca już istnieje.', 409, { settlementId: existing?.id })
    }
    throw error
  }
}

export async function listSettlementsForMonth(db: Db, period: PayrollPeriod) {
  const range = periodTimeEntryQueryRange(period)
  const [employees, settlements, versions] = await Promise.all([
    db.employee.findMany({
      where: { startDate: { lt: range.lt }, OR: [{ endDate: null }, { endDate: { gte: range.gte } }] },
      select: {
        ...EMPLOYEE_SELECT,
        payrollBaseSalaries: {
          where: { revokedAt: null, effectiveFrom: { lte: periodLastDay(period) } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { amountGrosze: true, basis: true, effectiveFrom: true },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    db.payrollSettlement.findMany({
      where: period,
      select: {
        id: true,
        employeeId: true,
        status: true,
        revision: true,
        currentVersionNumber: true,
        payrollOfficeConfirmedAt: true,
        updatedAt: true,
      },
    }),
    db.payrollSettlementVersion.findMany({
      where: { ...period, supersededAt: null },
      select: { employeeId: true, versionNumber: true, employerCostGrosze: true, finalGrossGrosze: true, finalNetGrosze: true },
    }),
  ])

  const settlementByEmployee = new Map(settlements.map((s) => [s.employeeId, s]))
  const versionByEmployee = new Map(versions.map((v) => [v.employeeId, v]))

  return employees
    .filter((employee) => isEmployedInPeriod(employee, period))
    .map(({ payrollBaseSalaries, ...employee }) => ({
      employee,
      currentBase: payrollBaseSalaries[0] ?? null,
      settlement: settlementByEmployee.get(employee.id) ?? null,
      effectiveVersion: versionByEmployee.get(employee.id) ?? null,
    }))
}

export async function getSettlementDetail(db: Db, id: string) {
  const settlement = await db.payrollSettlement.findUnique({
    where: { id },
    include: {
      employee: { select: EMPLOYEE_SELECT },
      overtimeLines: { orderBy: [{ date: 'asc' }, { timeEntryId: 'asc' }] },
      adjustments: { orderBy: { createdAt: 'asc' } },
      versions: { orderBy: { versionNumber: 'desc' } },
      auditEvents: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!settlement) throw new PayrollError('Rozliczenie nie istnieje.', 404)

  const period = { year: settlement.year, month: settlement.month }
  const live = await loadCalendarSnapshot(db, settlement.employeeId, period, settlement.overtimeLines)
  const calendarInSync = live.fingerprint === settlement.calendarFingerprint
  const employerCostContext = await loadEmployerCostContext(db, settlement.employee, period)
  const summary = summarizeSettlement({
    baseSalaryGrosze: settlement.baseSalaryGrosze,
    baseBasis: settlement.baseBasis,
    baseSegmentCount: (JSON.parse(settlement.baseSegmentsJson) as unknown[]).length,
    pendingEntryCount: settlement.pendingEntryCount,
    openEntryCount: live.openEntryCount,
    calendarInSync,
    payrollOfficeConfirmedAt: settlement.payrollOfficeConfirmedAt,
    lines: settlement.overtimeLines,
    adjustments: settlement.adjustments,
    costSplitMissing: employerCostContext.split === null,
    employerCostStale: isCalculatedEmployerCostStale(settlement, employerCostContext),
  })

  const actorIds = [...new Set([
    ...settlement.auditEvents.map((event) => event.actorId),
    ...settlement.versions.map((version) => version.approvedById),
  ])]
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
  const actorNames = withSystemActorName(Object.fromEntries(actors.map((actor) => [actor.id, actor.name])), actorIds)

  return {
    ...settlement,
    baseSegments: JSON.parse(settlement.baseSegmentsJson),
    versions: settlement.versions.map(({ snapshotJson, ...version }) => ({
      ...version,
      snapshot: JSON.parse(snapshotJson),
    })),
    calendarInSync,
    summary,
    employerCostContext,
    actors: actorNames,
  }
}

export type PayrollSettlementDetail = Awaited<ReturnType<typeof getSettlementDetail>>

/**
 * Compare-and-set on `revision`: every mutation must name the revision it was based on, so two
 * admins (or two tabs) cannot silently overwrite each other.
 */
async function bumpRevision(
  tx: Db,
  id: string,
  expectedRevision: number,
  data: Prisma.PayrollSettlementUncheckedUpdateManyInput = {}
) {
  const result = await tx.payrollSettlement.updateMany({
    where: { id, revision: expectedRevision },
    data: { ...data, revision: { increment: 1 } },
  })
  if (result.count === 0) {
    throw new PayrollError('Rozliczenie zostało w międzyczasie zmienione. Odśwież widok.', 409)
  }
}

function requireDraft(settlement: { status: string }) {
  if (settlement.status !== 'DRAFT') {
    throw new PayrollError('Rozliczenie jest zatwierdzone. Aby je poprawić, otwórz korektę.', 409)
  }
}

// ─── Settlement steps ────────────────────────────────────────────────────────
// Each step runs inside the caller's transaction on a freshly loaded settlement and writes its own
// audit event. The detail page (applySettlementAction) and the month sheet (settleEmployeeMonth)
// compose the same steps, so the rules live in exactly one place.

const SETTLEMENT_FOR_UPDATE = {
  employee: { select: EMPLOYEE_SELECT },
  overtimeLines: true,
  adjustments: true,
} as const

async function loadSettlementForUpdate(tx: Db, id: string) {
  return tx.payrollSettlement.findUnique({ where: { id }, include: SETTLEMENT_FOR_UPDATE })
}

type SettlementForUpdate = NonNullable<Awaited<ReturnType<typeof loadSettlementForUpdate>>>

async function reloadSettlement(tx: Db, id: string): Promise<SettlementForUpdate> {
  const settlement = await loadSettlementForUpdate(tx, id)
  if (!settlement) throw new PayrollError('Rozliczenie nie istnieje.', 404)
  return settlement
}

function settlementPeriod(settlement: { year: number; month: number }): PayrollPeriod {
  return { year: settlement.year, month: settlement.month }
}

function auditBase(settlement: SettlementForUpdate, actorId: string) {
  return { employeeId: settlement.employeeId, settlementId: settlement.id, actorId }
}

async function syncCalendarStep(tx: Db, actorId: string, settlement: SettlementForUpdate) {
  requireDraft(settlement)
  const snapshot = await loadCalendarSnapshot(tx, settlement.employeeId, settlementPeriod(settlement), settlement.overtimeLines)
  const resolutionsBefore = JSON.stringify(settlement.overtimeLines
    .map((l) => [l.timeEntryId, l.resolution]).sort())
  const resolutionsAfter = JSON.stringify(snapshot.lines.map((l) => [l.timeEntryId, l.resolution]).sort())
  const changed = snapshot.fingerprint !== settlement.calendarFingerprint || resolutionsBefore !== resolutionsAfter
  await bumpRevision(tx, settlement.id, settlement.revision, {
    ...snapshotSettlementData(snapshot),
    ...(changed ? CLEAR_CONFIRMATION : {}),
  })
  await replaceOvertimeLines(tx, settlement.id, snapshot)
  await audit(tx, {
    ...auditBase(settlement, actorId),
    action: 'calendar.sync',
    entityType: 'PayrollSettlement',
    entityId: settlement.id,
    before: {
      baseSalaryGrosze: settlement.baseSalaryGrosze,
      approvedWorkedMinutes: settlement.approvedWorkedMinutes,
      overtimeLines: settlement.overtimeLines.map((l) => [l.date, l.overtimeMinutes, l.entryStatus, l.resolution]),
    },
    after: {
      baseSalaryGrosze: snapshot.baseSalaryGrosze,
      approvedWorkedMinutes: snapshot.approvedWorkedMinutes,
      overtimeLines: snapshot.lines.map((l) => [l.date, l.overtimeMinutes, l.entryStatus, l.resolution]),
      payrollOfficeConfirmationCleared: changed && settlement.payrollOfficeConfirmedAt !== null,
    },
  })
}

async function resolveOvertimeStep(
  tx: Db,
  actorId: string,
  settlement: SettlementForUpdate,
  input: { lineId: string; resolution: OvertimeResolution }
) {
  requireDraft(settlement)
  const line = settlement.overtimeLines.find((l) => l.id === input.lineId)
  if (!line) throw new PayrollError('Pozycja nadgodzin nie istnieje.', 404)
  if (line.entryStatus !== 'approved') {
    throw new PayrollError('Najpierw zatwierdź ten wpis w kalendarzu czasu pracy.', 409)
  }
  await bumpRevision(tx, settlement.id, settlement.revision, CLEAR_CONFIRMATION)
  await tx.payrollOvertimeLine.update({
    where: { id: line.id },
    data: { resolution: input.resolution, resolutionSource: 'ADMIN' },
  })
  await audit(tx, {
    ...auditBase(settlement, actorId),
    action: 'overtime.resolve',
    entityType: 'PayrollOvertimeLine',
    entityId: line.id,
    before: { date: line.date, minutes: line.overtimeMinutes, resolution: line.resolution },
    after: { date: line.date, minutes: line.overtimeMinutes, resolution: input.resolution },
  })
}

async function addAdjustmentStep(
  tx: Db,
  actorId: string,
  settlement: SettlementForUpdate,
  input: { kind: AdjustmentKind; label: string; amount: number; note: string | null }
) {
  requireDraft(settlement)
  if (input.kind === 'BONUS' && input.amount <= 0) throw new PayrollError('Premia musi być dodatnia.')
  if (input.amount === 0) throw new PayrollError('Kwota nie może być zerowa.')
  await bumpRevision(tx, settlement.id, settlement.revision, CLEAR_CONFIRMATION)
  const row = await tx.payrollAdjustment.create({
    data: {
      settlementId: settlement.id,
      kind: input.kind,
      label: input.label,
      amountGrosze: input.amount,
      note: input.note,
      createdById: actorId,
    },
  })
  await audit(tx, {
    ...auditBase(settlement, actorId),
    action: 'adjustment.add',
    entityType: 'PayrollAdjustment',
    entityId: row.id,
    after: { kind: row.kind, label: row.label, amountGrosze: row.amountGrosze, note: row.note },
  })
}

async function updateAdjustmentStep(
  tx: Db,
  actorId: string,
  settlement: SettlementForUpdate,
  input: { adjustmentId: string; label: string; amount: number; note: string | null; reason: string }
) {
  requireDraft(settlement)
  const row = settlement.adjustments.find((a) => a.id === input.adjustmentId && a.deletedAt === null)
  if (!row) throw new PayrollError('Pozycja nie istnieje lub została usunięta.', 404)
  if (row.kind === 'BONUS' && input.amount <= 0) throw new PayrollError('Premia musi być dodatnia.')
  if (input.amount === 0) throw new PayrollError('Kwota nie może być zerowa.')
  await bumpRevision(tx, settlement.id, settlement.revision, CLEAR_CONFIRMATION)
  await tx.payrollAdjustment.update({
    where: { id: row.id },
    data: { label: input.label, amountGrosze: input.amount, note: input.note },
  })
  await audit(tx, {
    ...auditBase(settlement, actorId),
    action: 'adjustment.update',
    entityType: 'PayrollAdjustment',
    entityId: row.id,
    before: { kind: row.kind, label: row.label, amountGrosze: row.amountGrosze, note: row.note },
    after: { kind: row.kind, label: input.label, amountGrosze: input.amount, note: input.note },
    reason: input.reason,
  })
}

async function deleteAdjustmentStep(
  tx: Db,
  actorId: string,
  settlement: SettlementForUpdate,
  input: { adjustmentId: string; reason: string }
) {
  requireDraft(settlement)
  const row = settlement.adjustments.find((a) => a.id === input.adjustmentId && a.deletedAt === null)
  if (!row) throw new PayrollError('Pozycja nie istnieje lub została usunięta.', 404)
  await bumpRevision(tx, settlement.id, settlement.revision, CLEAR_CONFIRMATION)
  await tx.payrollAdjustment.update({
    where: { id: row.id },
    data: { deletedAt: new Date(), deletedById: actorId },
  })
  await audit(tx, {
    ...auditBase(settlement, actorId),
    action: 'adjustment.delete',
    entityType: 'PayrollAdjustment',
    entityId: row.id,
    before: { kind: row.kind, label: row.label, amountGrosze: row.amountGrosze, note: row.note },
    reason: input.reason,
  })
}

async function confirmPayrollOfficeStep(
  tx: Db,
  actorId: string,
  settlement: SettlementForUpdate,
  input: { finalGross: number; finalNet: number; employerCost?: number | null; reference: string | null }
) {
  requireDraft(settlement)
  const period = settlementPeriod(settlement)
  const context = await loadEmployerCostContext(tx, settlement.employee, period)
  const summary = await currentSummary(tx, settlement, context)
  if (summary.inputBlockers.length > 0) {
    throw new PayrollError('Uzupełnij dane wejściowe przed potwierdzeniem kadrowej.', 409, {
      blockers: summary.inputBlockers.map((code) => ({ code, message: BLOCKER_LABELS[code] })),
    })
  }
  const overridden = input.employerCost != null
  if (!overridden && !context.rates) {
    throw new PayrollError('Ten rodzaj umowy nie ma stawek pracodawcy — podaj pełny koszt pracodawcy ręcznie.')
  }
  const figures = {
    finalGrossGrosze: input.finalGross,
    finalNetGrosze: input.finalNet,
    employerCostGrosze: overridden
      ? (input.employerCost as number)
      : calculateEmployerCostGrosze(input.finalGross, context.rates as NonNullable<typeof context.rates>),
    employerCostSource: overridden ? 'OVERRIDDEN' : 'CALCULATED',
  }
  const invalid = validatePayrollOfficeFigures({ employmentType: settlement.employee.employmentType, ...figures })
  if (invalid) throw new PayrollError(invalid)
  await bumpRevision(tx, settlement.id, settlement.revision, {
    ...figures,
    payrollOfficeReference: input.reference,
    payrollOfficeConfirmedAt: new Date(),
    payrollOfficeConfirmedById: actorId,
  })
  await audit(tx, {
    ...auditBase(settlement, actorId),
    action: 'payrollOffice.confirm',
    entityType: 'PayrollSettlement',
    entityId: settlement.id,
    before: {
      finalGrossGrosze: settlement.finalGrossGrosze,
      finalNetGrosze: settlement.finalNetGrosze,
      employerCostGrosze: settlement.employerCostGrosze,
      employerCostSource: settlement.employerCostSource,
      reference: settlement.payrollOfficeReference,
    },
    after: { ...figures, rates: overridden ? null : context.rates, reference: input.reference },
  })
}

/** Approves the draft as a new effective version; returns the new version number. */
async function approveStep(
  tx: Db,
  actorId: string,
  settlement: SettlementForUpdate,
  note: string | null,
  origin: PayrollVersionOrigin = 'MANUAL'
) {
  requireDraft(settlement)
  const period = settlementPeriod(settlement)
  const id = settlement.id
  const context = await loadEmployerCostContext(tx, settlement.employee, period)
  const summary = await currentSummary(tx, settlement, context)
  if (summary.approvalBlockers.length > 0) {
    throw new PayrollError('Rozliczenia nie można zatwierdzić.', 409, {
      blockers: summary.approvalBlockers.map((code) => ({ code, message: BLOCKER_LABELS[code] })),
    })
  }
  const previous = await tx.payrollSettlementVersion.findFirst({
    where: { settlementId: id, supersededAt: null },
  })
  const versionNumber = settlement.currentVersionNumber + 1
  const versionId = randomUUID()
  const activeAdjustments = settlement.adjustments.filter((a) => a.deletedAt === null)
  const employerCostGrosze = settlement.employerCostGrosze as number
  const costAllocation = allocateEmployerCost(employerCostGrosze, context.split as NonNullable<typeof context.split>)
  const employerCostSource = settlement.employerCostSource ?? 'ENTERED'
  // Inputs the amount depends on besides the calendar; a later stage compares them with the live state.
  const absences = await loadPayAffectingAbsences(tx, [settlement.employeeId], period)
  const inputs = {
    employment: employmentInPeriod(settlement.employee, period),
    payAffectingAbsenceIds: (absences.get(settlement.employeeId) ?? []).slice().sort(),
  }

  await bumpRevision(tx, id, settlement.revision)
  if (previous) {
    await tx.payrollSettlementVersion.update({
      where: { id: previous.id },
      data: { supersededAt: new Date(), supersededByVersionId: versionId },
    })
  }
  await tx.payrollSettlementVersion.create({
    data: {
      id: versionId,
      settlementId: id,
      employeeId: settlement.employeeId,
      year: settlement.year,
      month: settlement.month,
      versionNumber,
      costCenterId: settlement.employee.costCenterId,
      employmentType: settlement.employee.employmentType,
      baseSalaryGrosze: settlement.baseSalaryGrosze as number,
      baseBasis: settlement.baseBasis as string,
      bonusesGrosze: summary.bonusesGrosze,
      correctionsGrosze: summary.correctionsGrosze,
      payoutOvertimeMinutes: summary.payoutOvertimeMinutes,
      timeOffOvertimeMinutes: summary.timeOffOvertimeMinutes,
      approvedWorkedMinutes: settlement.approvedWorkedMinutes,
      finalGrossGrosze: settlement.finalGrossGrosze as number,
      finalNetGrosze: settlement.finalNetGrosze as number,
      employerCostGrosze,
      employerCostSource,
      employerRatesJson: employerCostSource === 'CALCULATED'
        ? JSON.stringify({
          settlementType: context.settlementType,
          ratesSource: context.ratesSource,
          ratesEffectiveFrom: context.ratesEffectiveFrom,
          rates: context.rates,
          exemptions: context.exemptions,
        })
        : null,
      costAllocationJson: JSON.stringify(costAllocation),
      payrollOfficeReference: settlement.payrollOfficeReference,
      payrollOfficeConfirmedAt: settlement.payrollOfficeConfirmedAt as Date,
      snapshotJson: JSON.stringify({
        employee: {
          firstName: settlement.employee.firstName,
          lastName: settlement.employee.lastName,
          position: settlement.employee.position,
        },
        baseSegments: JSON.parse(settlement.baseSegmentsJson),
        calendarFingerprint: settlement.calendarFingerprint,
        overtimeLines: settlement.overtimeLines.map(({ timeEntryId, date, overtimeMinutes, entryStatus, isSaturday, resolution }) => ({
          timeEntryId, date, overtimeMinutes, entryStatus, isSaturday, resolution,
        })),
        adjustments: activeAdjustments.map(({ id: adjustmentId, kind, label, amountGrosze, note: adjustmentNote }) => ({
          id: adjustmentId, kind, label, amountGrosze, note: adjustmentNote,
        })),
        inputs,
      }),
      approvalNote: note,
      approvedById: actorId,
      origin,
    },
  })
  await tx.payrollSettlement.update({
    where: { id },
    data: { status: 'APPROVED', currentVersionNumber: versionNumber },
  })
  await audit(tx, {
    ...auditBase(settlement, actorId),
    action: 'settlement.approve',
    entityType: 'PayrollSettlementVersion',
    entityId: versionId,
    before: previous ? { versionNumber: previous.versionNumber, employerCostGrosze: previous.employerCostGrosze } : null,
    after: {
      versionNumber,
      finalGrossGrosze: settlement.finalGrossGrosze,
      finalNetGrosze: settlement.finalNetGrosze,
      employerCostGrosze: settlement.employerCostGrosze,
      employerCostSource,
      costAllocation,
      origin,
    },
    reason: note,
  })
  return versionNumber
}

async function reopenStep(tx: Db, actorId: string, settlement: SettlementForUpdate, reason: string) {
  if (settlement.status !== 'APPROVED') throw new PayrollError('Otworzyć do korekty można tylko zatwierdzone rozliczenie.', 409)
  await bumpRevision(tx, settlement.id, settlement.revision, { status: 'DRAFT', ...CLEAR_CONFIRMATION })
  await audit(tx, {
    ...auditBase(settlement, actorId),
    action: 'settlement.reopen',
    entityType: 'PayrollSettlement',
    entityId: settlement.id,
    before: { status: 'APPROVED', versionNumber: settlement.currentVersionNumber },
    after: { status: 'DRAFT', effectiveVersionStillCounted: settlement.currentVersionNumber },
    reason,
  })
}

export async function applySettlementAction(
  db: PrismaClient,
  actorId: string,
  id: string,
  action: PayrollSettlementAction
) {
  await db.$transaction(async (tx) => {
    const settlement = await loadSettlementForUpdate(tx, id)
    if (!settlement) throw new PayrollError('Rozliczenie nie istnieje.', 404)
    if (settlement.revision !== action.expectedRevision) {
      throw new PayrollError('Rozliczenie zostało w międzyczasie zmienione. Odśwież widok.', 409)
    }

    switch (action.action) {
      case 'calendar.sync':
        return syncCalendarStep(tx, actorId, settlement)
      case 'overtime.resolve':
        return resolveOvertimeStep(tx, actorId, settlement, action)
      case 'adjustment.add':
        return addAdjustmentStep(tx, actorId, settlement, action)
      case 'adjustment.update':
        return updateAdjustmentStep(tx, actorId, settlement, action)
      case 'adjustment.delete':
        return deleteAdjustmentStep(tx, actorId, settlement, action)
      case 'payrollOffice.confirm':
        return confirmPayrollOfficeStep(tx, actorId, settlement, action)
      case 'approve':
        await approveStep(tx, actorId, settlement, action.note)
        return
      case 'reopen':
        return reopenStep(tx, actorId, settlement, action.reason)
    }
  })

  return getSettlementDetail(db, id)
}

// ─── Month sheet: approve one person in one transaction ──────────────────────

/** Reason recorded when an approved amount is corrected directly on the month sheet (D5). */
export const SHEET_CORRECTION_REASON = 'Korekta kwot na liście miesiąca'

export type SettleEmployeeMonthInput = {
  employeeId: string
  period: PayrollPeriod
  finalGross: number
  finalNet: number
  /** Omitted or null → calculated from gross and current rates; a number → manual override. */
  employerCost?: number | null
  /** Revision the caller saw; must be omitted when the caller saw no settlement. */
  expectedRevision?: number | null
  /** MANUAL (default) or AUTO_CARRYOVER; the automat may only create a new settlement, never correct one. */
  origin?: PayrollVersionOrigin
  /** Note stored on the new version (e.g. "Automatyczne przeniesienie z 2026-10"). */
  approvalNote?: string | null
}

export type SettleEmployeeMonthResult = {
  outcome: 'APPROVED' | 'UNCHANGED'
  settlementId: string
  versionNumber: number
}

const CONCURRENT_SETTLEMENT_MESSAGE = 'Rozliczenie tej osoby zostało w międzyczasie utworzone lub zmienione. Odśwież arkusz.'

function sameApprovedFigures(
  effective: { finalGrossGrosze: number; finalNetGrosze: number; employerCostGrosze: number; employerCostSource: string },
  input: SettleEmployeeMonthInput,
  context: EmployerCostContext
): boolean {
  if (effective.finalGrossGrosze !== input.finalGross || effective.finalNetGrosze !== input.finalNet) return false
  if (input.employerCost != null) return input.employerCost === effective.employerCostGrosze
  return effective.employerCostSource === 'CALCULATED'
    && context.rates !== null
    && calculateEmployerCostGrosze(input.finalGross, context.rates) === effective.employerCostGrosze
}

/**
 * Creates (if needed), confirms and approves one person's month in ONE transaction, composing the
 * same steps as the detail page. Any blocker or validation error rolls everything back, so a failed
 * attempt never leaves a settlement row behind (settlements cannot be deleted). An approved
 * settlement is reopened as a correction; identical figures return UNCHANGED without a new version.
 */
export async function settleEmployeeMonth(
  db: PrismaClient,
  actorId: string,
  input: SettleEmployeeMonthInput
): Promise<SettleEmployeeMonthResult> {
  if (isFuturePeriod(input.period)) throw new PayrollError('Nie można rozliczyć przyszłego miesiąca.', 400)
  try {
    return await db.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: input.employeeId }, select: EMPLOYEE_SELECT })
      if (!employee) throw new PayrollError('Pracownik nie istnieje.', 404)
      const existing = await tx.payrollSettlement.findUnique({
        where: { employeeId_year_month: { employeeId: employee.id, year: input.period.year, month: input.period.month } },
        select: { id: true, revision: true },
      })
      if (existing ? existing.revision !== input.expectedRevision : input.expectedRevision != null) {
        throw new PayrollError(CONCURRENT_SETTLEMENT_MESSAGE, 409)
      }
      // D9: the automat never reopens or corrects an existing settlement (approved or draft).
      if (existing && input.origin === 'AUTO_CARRYOVER') throw new PayrollError(CONCURRENT_SETTLEMENT_MESSAGE, 409)

      let settlement: SettlementForUpdate
      if (!existing) {
        // D12/D13: an external contractor is never put on the payroll list. A settlement that already
        // exists for such a card (legacy, or created on the detail page) can still be finished.
        if (isExternalContractor(employee)) {
          throw new PayrollError('Wykonawca zewnętrzny nie jest rozliczany na liście płac.', 400)
        }
        if (!isEmployedInPeriod(employee, input.period)) {
          throw new PayrollError('Pracownik nie był zatrudniony w tym miesiącu.', 400)
        }
        const created = await createSettlementInTx(tx, actorId, employee, input.period)
        settlement = await reloadSettlement(tx, created.id)
      } else {
        settlement = await reloadSettlement(tx, existing.id)
        if (settlement.status === 'APPROVED') {
          const effective = await tx.payrollSettlementVersion.findFirst({
            where: { settlementId: settlement.id, supersededAt: null },
          })
          const context = await loadEmployerCostContext(tx, employee, input.period)
          if (effective && sameApprovedFigures(effective, input, context)) {
            return { outcome: 'UNCHANGED' as const, settlementId: settlement.id, versionNumber: effective.versionNumber }
          }
          await reopenStep(tx, actorId, settlement, SHEET_CORRECTION_REASON)
          settlement = await reloadSettlement(tx, settlement.id)
        }
      }

      const live = await loadCalendarSnapshot(tx, settlement.employeeId, input.period, settlement.overtimeLines)
      if (live.fingerprint !== settlement.calendarFingerprint) {
        await syncCalendarStep(tx, actorId, settlement)
        settlement = await reloadSettlement(tx, settlement.id)
      }

      const payrollMonth = await tx.payrollMonth.findUnique({
        where: { year_month: { year: input.period.year, month: input.period.month } },
        select: { listReference: true },
      })
      await confirmPayrollOfficeStep(tx, actorId, settlement, {
        finalGross: input.finalGross,
        finalNet: input.finalNet,
        employerCost: input.employerCost,
        reference: payrollMonth?.listReference ?? null,
      })
      settlement = await reloadSettlement(tx, settlement.id)
      const versionNumber = await approveStep(tx, actorId, settlement, input.approvalNote ?? null, input.origin ?? 'MANUAL')
      return { outcome: 'APPROVED' as const, settlementId: settlement.id, versionNumber }
    }, { maxWait: 10_000, timeout: 30_000 })
  } catch (error) {
    // Two tabs creating the same employee-month: the loser hits the unique index and rolls back.
    if (isUniqueViolation(error)) throw new PayrollError(CONCURRENT_SETTLEMENT_MESSAGE, 409)
    throw error
  }
}

async function currentSummary(
  tx: Db,
  settlement: {
    employeeId: string
    finalGrossGrosze: number | null
    employerCostGrosze: number | null
    employerCostSource: string | null
    year: number
    month: number
    baseSalaryGrosze: number | null
    baseBasis: string | null
    baseSegmentsJson: string
    pendingEntryCount: number
    calendarFingerprint: string | null
    payrollOfficeConfirmedAt: Date | null
    overtimeLines: Array<{ timeEntryId: string; overtimeMinutes: number; entryStatus: string; resolution: string | null; resolutionSource: string | null }>
    adjustments: Array<{ kind: string; amountGrosze: number; deletedAt: Date | null }>
  },
  context: EmployerCostContext
) {
  const live = await loadCalendarSnapshot(
    tx,
    settlement.employeeId,
    { year: settlement.year, month: settlement.month },
    settlement.overtimeLines
  )
  return summarizeSettlement({
    baseSalaryGrosze: settlement.baseSalaryGrosze,
    baseBasis: settlement.baseBasis,
    baseSegmentCount: (JSON.parse(settlement.baseSegmentsJson) as unknown[]).length,
    pendingEntryCount: settlement.pendingEntryCount,
    openEntryCount: live.openEntryCount,
    calendarInSync: live.fingerprint === settlement.calendarFingerprint,
    payrollOfficeConfirmedAt: settlement.payrollOfficeConfirmedAt,
    lines: settlement.overtimeLines,
    adjustments: settlement.adjustments,
    costSplitMissing: context.split === null,
    employerCostStale: isCalculatedEmployerCostStale(settlement, context),
  })
}

// ─── Month sheet (read) ──────────────────────────────────────────────────────

/** Approved leave requests overlapping the month whose type changes the payroll amount, per employee. */
export async function loadPayAffectingAbsences(
  db: Db,
  employeeIds: string[],
  period: PayrollPeriod
): Promise<Map<string, string[]>> {
  const range = periodTimeEntryQueryRange(period)
  const first = periodFirstDay(period)
  const last = periodLastDay(period)
  const requests = await db.leaveRequestNew.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: 'approved',
      startDate: { lt: range.lt },
      endDate: { gte: range.gte },
    },
    select: { id: true, employeeId: true, startDate: true, endDate: true, leaveType: { select: { isPaid: true, code: true } } },
  })
  const byEmployee = new Map<string, string[]>()
  for (const request of requests) {
    if (!isPayAffectingLeave(request.leaveType)) continue
    const start = getWarsawBusinessDate(request.startDate).isoDate
    const end = getWarsawBusinessDate(request.endDate).isoDate
    if (start > last || end < first) continue
    byEmployee.set(request.employeeId, [...(byEmployee.get(request.employeeId) ?? []), request.id])
  }
  return byEmployee
}

/**
 * Blockers the sheet shows for one person: everything that would stop settleEmployeeMonth, computed
 * from the live calendar. Calendar drift and the payroll office confirmation are not blockers here —
 * the sheet re-syncs and confirms in the same transaction as the approval.
 */
function sheetBlockers(snapshot: CalendarSnapshot, costSplitMissing: boolean): PayrollBlocker[] {
  return summarizeSettlement({
    baseSalaryGrosze: snapshot.baseSalaryGrosze,
    baseBasis: snapshot.baseBasis,
    baseSegmentCount: snapshot.baseSegments.length,
    pendingEntryCount: snapshot.pendingEntryCount,
    openEntryCount: snapshot.openEntryCount,
    calendarInSync: true,
    payrollOfficeConfirmedAt: new Date(0),
    lines: snapshot.lines,
    adjustments: [],
    costSplitMissing,
    employerCostStale: false,
  }).approvalBlockers
}

const VERSION_FIGURES_SELECT = {
  employeeId: true,
  year: true,
  month: true,
  versionNumber: true,
  baseSalaryGrosze: true,
  baseBasis: true,
  bonusesGrosze: true,
  correctionsGrosze: true,
  payoutOvertimeMinutes: true,
  finalGrossGrosze: true,
  finalNetGrosze: true,
  employerCostGrosze: true,
  employerCostSource: true,
  payrollOfficeReference: true,
} as const

const CURRENT_VERSION_SELECT = {
  ...VERSION_FIGURES_SELECT,
  snapshotJson: true,
  approvedWorkedMinutes: true,
  origin: true,
} as const

// ─── Change after approval (D9) ──────────────────────────────────────────────

/** Audit action of "Kwota aktualna": the ADMIN confirmed the approved amount despite a change. */
export const CHANGES_ACKNOWLEDGED_ACTION = 'settlement.changesAcknowledged'

type StoredAcknowledgement = PayChangesAcknowledgement & { versionNumber: number }

function parseAcknowledgement(afterJson: string | null): StoredAcknowledgement | null {
  if (!afterJson) return null
  try {
    const value = JSON.parse(afterJson) as { versionNumber?: unknown; signature?: unknown; state?: unknown }
    if (typeof value.versionNumber !== 'number' || typeof value.signature !== 'string') return null
    return {
      versionNumber: value.versionNumber,
      signature: value.signature,
      state: typeof value.state === 'object' && value.state !== null ? value.state as PayInputsState : null,
    }
  } catch {
    return null
  }
}

/** The latest acknowledgement of each settlement, for the given effective version numbers only. */
async function loadAcknowledgements(db: Db, effective: Map<string, number>): Promise<Map<string, StoredAcknowledgement>> {
  if (effective.size === 0) return new Map()
  const events = await db.payrollAuditEvent.findMany({
    where: { settlementId: { in: [...effective.keys()] }, action: CHANGES_ACKNOWLEDGED_ACTION },
    orderBy: { createdAt: 'desc' },
    select: { settlementId: true, afterJson: true },
  })
  const latest = new Map<string, StoredAcknowledgement>()
  for (const event of events) {
    if (!event.settlementId || latest.has(event.settlementId)) continue
    const parsed = parseAcknowledgement(event.afterJson)
    if (parsed && parsed.versionNumber === effective.get(event.settlementId)) latest.set(event.settlementId, parsed)
  }
  return latest
}

function changeAfterApprovalFor(input: {
  version: { snapshotJson: string; approvedWorkedMinutes: number; baseBasis: string }
  snapshot: CalendarSnapshot
  employee: { startDate: Date; endDate: Date | null }
  period: PayrollPeriod
  absenceIds: string[]
  acknowledgement: StoredAcknowledgement | null
}): ChangeAfterApproval | null {
  return evaluateChangeAfterApproval({
    version: input.version,
    live: {
      overtimeLines: input.snapshot.lines,
      baseSegments: input.snapshot.baseSegments,
      approvedWorkedMinutes: input.snapshot.approvedWorkedMinutes,
      employment: employmentInPeriod(input.employee, input.period),
      absenceIds: input.absenceIds,
    },
    acknowledgement: input.acknowledgement,
  })
}

/**
 * "Kwota aktualna": records that the approved amount stays valid for the current pay-relevant inputs.
 * The signature must be the one the ADMIN saw; a state that changed since then is refused (409).
 * Never touches the settlement or its version — only an append-only history event.
 */
export async function acknowledgePayrollChanges(
  db: PrismaClient,
  actorId: string,
  input: { settlementId: string; signature: string }
) {
  return db.$transaction(async (tx) => {
    const settlement = await loadSettlementForUpdate(tx, input.settlementId)
    if (!settlement) throw new PayrollError('Rozliczenie nie istnieje.', 404)
    if (settlement.status !== 'APPROVED') {
      throw new PayrollError('Rozliczenie nie jest zatwierdzone — dokończ je na stronie szczegółów.', 409)
    }
    const version = await tx.payrollSettlementVersion.findFirst({ where: { settlementId: settlement.id, supersededAt: null } })
    if (!version) throw new PayrollError('Rozliczenie nie ma obowiązującej wersji.', 409)
    const period = settlementPeriod(settlement)
    const [snapshot, absences, acknowledgements] = await Promise.all([
      loadCalendarSnapshot(tx, settlement.employeeId, period, settlement.overtimeLines),
      loadPayAffectingAbsences(tx, [settlement.employeeId], period),
      loadAcknowledgements(tx, new Map([[settlement.id, version.versionNumber]])),
    ])
    const change = changeAfterApprovalFor({
      version,
      snapshot,
      employee: settlement.employee,
      period,
      absenceIds: absences.get(settlement.employeeId) ?? [],
      acknowledgement: acknowledgements.get(settlement.id) ?? null,
    })
    if (!change) throw new PayrollError('Nie ma niepotwierdzonej zmiany po zatwierdzeniu. Odśwież arkusz.', 409)
    if (change.signature !== input.signature) {
      throw new PayrollError('Dane osoby zmieniły się w międzyczasie. Odśwież arkusz i sprawdź kwotę ponownie.', 409)
    }
    await audit(tx, {
      ...auditBase(settlement, actorId),
      action: CHANGES_ACKNOWLEDGED_ACTION,
      entityType: 'PayrollSettlementVersion',
      entityId: version.id,
      after: {
        versionNumber: version.versionNumber,
        changesText: describePayInputChanges(change.changes),
        signature: change.signature,
        state: change.state,
      },
      reason: 'Kwota aktualna mimo zmiany po zatwierdzeniu',
    })
    return { settlementId: settlement.id, versionNumber: version.versionNumber, signature: change.signature }
  })
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item])
  return map
}

/**
 * The month sheet: one row per person employed in the month who is not an external contractor,
 * plus everyone who already has a settlement in the month. Suggestions are computed on read and
 * never stored.
 */
export async function getPayrollSheet(db: Db, period: PayrollPeriod) {
  const previous = previousPayrollPeriod(period)
  const range = periodTimeEntryQueryRange(period)
  const lastDay = periodLastDay(period)

  const settlements = await db.payrollSettlement.findMany({
    where: period,
    select: {
      id: true,
      employeeId: true,
      status: true,
      revision: true,
      currentVersionNumber: true,
      payrollOfficeConfirmedAt: true,
      finalGrossGrosze: true,
      finalNetGrosze: true,
      employerCostGrosze: true,
      employerCostSource: true,
      overtimeLines: { select: { timeEntryId: true, resolution: true, resolutionSource: true } },
    },
  })
  const settledIds = settlements.map((settlement) => settlement.employeeId)

  const candidates = await db.employee.findMany({
    where: {
      OR: [
        {
          AND: [
            { startDate: { lt: range.lt } },
            { OR: [{ endDate: null }, { endDate: { gte: range.gte } }] },
            STAFF_WHERE,
          ],
        },
        { id: { in: settledIds } },
      ],
    },
    select: EMPLOYEE_SELECT,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  const settledSet = new Set(settledIds)
  const employees = candidates.filter((employee) =>
    settledSet.has(employee.id) || (isEmployedInPeriod(employee, period) && !isExternalContractor(employee)))
  const ids = employees.map((employee) => employee.id)

  const [entries, overtimeRequests, baseSalaries, currentVersions, previousVersions, payrollMonth, absences, previousAbsences, contexts] = await Promise.all([
    db.timeEntry.findMany({
      where: { employeeId: { in: ids }, date: range },
      select: { id: true, employeeId: true, date: true, status: true, clockOut: true, totalMinutes: true, breakMinutes: true, overtimeMinutes: true },
    }),
    db.overtimeRequest.findMany({
      where: { employeeId: { in: ids }, date: range },
      select: { employeeId: true, date: true, status: true, resolution: true },
    }),
    db.payrollBaseSalary.findMany({
      where: { employeeId: { in: ids }, effectiveFrom: { lte: lastDay } },
      select: { id: true, employeeId: true, amountGrosze: true, basis: true, effectiveFrom: true, revokedAt: true },
    }),
    db.payrollSettlementVersion.findMany({ where: { ...period, supersededAt: null }, select: CURRENT_VERSION_SELECT }),
    db.payrollSettlementVersion.findMany({ where: { ...previous, supersededAt: null }, select: VERSION_FIGURES_SELECT }),
    db.payrollMonth.findUnique({ where: { year_month: period }, select: { listReference: true, updatedAt: true } }),
    loadPayAffectingAbsences(db, ids, period),
    loadPayAffectingAbsences(db, ids, previous),
    loadEmployerCostContexts(db, employees, period),
  ])

  const entriesBy = groupBy(entries, (entry) => entry.employeeId)
  const requestsBy = groupBy(overtimeRequests, (request) => request.employeeId)
  const basesBy = groupBy(baseSalaries, (base) => base.employeeId)
  const settlementBy = new Map(settlements.map((settlement) => [settlement.employeeId, settlement]))
  const currentBy = new Map(currentVersions.map((version) => [version.employeeId, version]))
  const previousBy = new Map(previousVersions.map((version) => [version.employeeId, version]))
  const effectiveBySettlement = new Map(settlements
    .filter((settlement) => settlement.status === 'APPROVED' && currentBy.has(settlement.employeeId))
    .map((settlement) => [settlement.id, (currentBy.get(settlement.employeeId) as { versionNumber: number }).versionNumber]))
  const acknowledgements = await loadAcknowledgements(db, effectiveBySettlement)

  const rows = employees.map((employee) => {
    const settlement = settlementBy.get(employee.id) ?? null
    const snapshot = buildCalendarSnapshot({
      period,
      entries: entriesBy.get(employee.id) ?? [],
      overtimeRequests: requestsBy.get(employee.id) ?? [],
      baseSalaries: basesBy.get(employee.id) ?? [],
      existingLines: settlement?.overtimeLines ?? [],
    })
    const context = contexts.get(employee.id) as EmployerCostContext
    const blockers = sheetBlockers(snapshot, context.split === null)
    const source = previousBy.get(employee.id) ?? null
    const absenceIds = absences.get(employee.id) ?? []
    const evaluation = evaluateCarryover({
      period,
      employee,
      baseSegments: snapshot.baseSegments,
      source,
      costContext: context,
      blockers,
      payAffectingAbsenceIds: absenceIds,
      previousPayAffectingAbsenceIds: previousAbsences.get(employee.id) ?? [],
    })
    const current = currentBy.get(employee.id) ?? null
    const latestBase = snapshot.baseSegments.at(-1) ?? null
    const base = latestBase
      ? (basesBy.get(employee.id) ?? []).find((row) => row.id === latestBase.baseSalaryId) ?? null
      : null
    const { overtimeLines: _lines, ...settlementFields } = settlement ?? { overtimeLines: [] }
    void _lines
    const change = settlement?.status === 'APPROVED' && current
      ? changeAfterApprovalFor({
        version: current,
        snapshot,
        employee,
        period,
        absenceIds,
        acknowledgement: acknowledgements.get(settlement.id) ?? null,
      })
      : null

    return {
      employee,
      contractor: isExternalContractor(employee),
      currentBase: base ? { amountGrosze: base.amountGrosze, basis: base.basis as PayrollBasis, effectiveFrom: base.effectiveFrom } : null,
      settlement: settlement ? settlementFields as Omit<typeof settlement, 'overtimeLines'> : null,
      effectiveVersion: current
        ? {
          versionNumber: current.versionNumber,
          finalGrossGrosze: current.finalGrossGrosze,
          finalNetGrosze: current.finalNetGrosze,
          employerCostGrosze: current.employerCostGrosze,
          employerCostSource: current.employerCostSource,
          payrollOfficeReference: current.payrollOfficeReference,
          origin: current.origin as PayrollVersionOrigin,
        }
        : null,
      previous: source
        ? {
          month: payrollMonthKey(previous),
          finalGrossGrosze: source.finalGrossGrosze,
          finalNetGrosze: source.finalNetGrosze,
          employerCostGrosze: source.employerCostGrosze,
        }
        : null,
      suggestion: evaluation.suggestion,
      flags: evaluation.flags.map((code) => ({
        code,
        message: describeCarryoverFlag(code, {
          period,
          employment: evaluation.employment,
          previousEmployment: evaluation.previousEmployment,
          source,
        }),
      })),
      blockers: blockers.map((code) => ({ code, message: BLOCKER_LABELS[code] })),
      autoEligible: evaluation.autoEligible,
      rates: context.rates,
      employment: evaluation.employment,
      /** Approved rows only: pay-relevant inputs changed after approval and nobody confirmed the amount yet. */
      changeAfterApproval: change
        ? {
          changes: change.changes.map((code) => ({ code, message: describePayInputChanges([code]) })),
          signature: change.signature,
        }
        : null,
    }
  })

  const sum = (versions: Array<{ employerCostGrosze: number }>) => versions.reduce((total, v) => total + v.employerCostGrosze, 0)
  return {
    month: payrollMonthKey(period),
    previousMonth: payrollMonthKey(previous),
    listReference: payrollMonth?.listReference ?? null,
    listReferenceUpdatedAt: payrollMonth?.updatedAt ?? null,
    approvedEmployerCostGrosze: sum(currentVersions),
    previousApprovedEmployerCostGrosze: previousVersions.length > 0 ? sum(previousVersions) : null,
    rows,
  }
}

export type PayrollSheet = Awaited<ReturnType<typeof getPayrollSheet>>
export type PayrollSheetRow = PayrollSheet['rows'][number]

// ─── Month sheet (write) ─────────────────────────────────────────────────────

export type SheetRowResult =
  | { employeeId: string; status: 'APPROVED'; versionNumber: number; settlementId: string }
  | { employeeId: string; status: 'UNCHANGED'; versionNumber: number; settlementId: string }
  | { employeeId: string; status: 'BLOCKED'; message: string; blockers: Array<{ code: string; message: string }> }
  | { employeeId: string; status: 'CONFLICT'; message: string }
  | { employeeId: string; status: 'INVALID'; message: string }

function blockersOf(details: unknown): Array<{ code: string; message: string }> | null {
  if (typeof details !== 'object' || details === null || !('blockers' in details)) return null
  const blockers = (details as { blockers: unknown }).blockers
  return Array.isArray(blockers) ? blockers as Array<{ code: string; message: string }> : null
}

export function sheetRowResultFromError(employeeId: string, error: unknown): SheetRowResult {
  if (error instanceof PayrollError) {
    const blockers = blockersOf(error.details)
    if (blockers) return { employeeId, status: 'BLOCKED', message: error.message, blockers }
    if (error.status === 409) return { employeeId, status: 'CONFLICT', message: error.message }
    return { employeeId, status: 'INVALID', message: error.message }
  }
  if (isUniqueViolation(error)) return { employeeId, status: 'CONFLICT', message: CONCURRENT_SETTLEMENT_MESSAGE }
  if (error instanceof Error && /append-only|are immutable|cannot be deleted|is locked|is not a draft|requires its effective version/.test(error.message)) {
    return { employeeId, status: 'CONFLICT', message: 'Operacja zablokowana przez zabezpieczenia danych płacowych. Odśwież arkusz.' }
  }
  console.error('[payroll] sheet row failed', error)
  return { employeeId, status: 'INVALID', message: 'Nie udało się zapisać tego wiersza.' }
}

function rowEmployeeId(row: unknown): string {
  if (typeof row === 'object' && row !== null && 'employeeId' in row && typeof row.employeeId === 'string') return row.employeeId
  return ''
}

/**
 * Approves the given rows, each validated on its own and settled in its own transaction; a failure
 * of one row never affects another, and every row reports its own outcome in request order.
 */
export async function submitPayrollSheet(
  db: PrismaClient,
  actorId: string,
  period: PayrollPeriod,
  rows: unknown[]
): Promise<SheetRowResult[]> {
  const results: SheetRowResult[] = []
  const seen = new Set<string>()
  for (const raw of rows) {
    const parsed = PayrollSheetRowSchema.safeParse(raw)
    if (!parsed.success) {
      results.push({ employeeId: rowEmployeeId(raw), status: 'INVALID', message: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane wiersza.' })
      continue
    }
    const row = parsed.data
    if (seen.has(row.employeeId)) {
      results.push({ employeeId: row.employeeId, status: 'INVALID', message: 'Ta osoba występuje w zapisie więcej niż raz.' })
      continue
    }
    seen.add(row.employeeId)
    try {
      const result = await settleEmployeeMonth(db, actorId, { ...row, period })
      results.push({ employeeId: row.employeeId, status: result.outcome, versionNumber: result.versionNumber, settlementId: result.settlementId })
    } catch (error) {
      results.push(sheetRowResultFromError(row.employeeId, error))
    }
  }
  return results
}

// ─── Month-level data ────────────────────────────────────────────────────────

/** Sets the payroll list number of a month. Never touches settlements or versions (D6). */
export async function setPayrollMonthReference(
  db: Db,
  actorId: string,
  period: PayrollPeriod,
  listReference: string | null
) {
  const row = await db.payrollMonth.upsert({
    where: { year_month: period },
    create: { ...period, listReference, updatedById: actorId },
    update: { listReference, updatedById: actorId },
  })
  return { month: payrollMonthKey(period), listReference: row.listReference, updatedAt: row.updatedAt }
}
