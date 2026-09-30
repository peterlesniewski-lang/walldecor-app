import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@/generated/prisma'
import { buildCalendarSnapshot, type CalendarSnapshot } from './calendar'
import {
  isEmployedInPeriod,
  isFuturePeriod,
  payrollMonthKey,
  periodLastDay,
  periodTimeEntryQueryRange,
  type PayrollPeriod,
} from './period'
import { summarizeSettlement, validatePayrollOfficeFigures, BLOCKER_LABELS } from './summary'
import type { PayrollSettlementAction } from '@/lib/validations/payroll'
import type { PayrollBasis } from './types'

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

async function audit(
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
    return await db.$transaction(async (tx) => {
      const snapshot = await loadCalendarSnapshot(tx, employee.id, input.period)
      const settlement = await tx.payrollSettlement.create({
        data: {
          employeeId: employee.id,
          year: input.period.year,
          month: input.period.month,
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
          month: payrollMonthKey(input.period),
          baseSalaryGrosze: snapshot.baseSalaryGrosze,
          overtimeLines: snapshot.lines.length,
        },
        actorId,
      })
      return settlement
    })
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
  })

  const actorIds = [...new Set([
    ...settlement.auditEvents.map((event) => event.actorId),
    ...settlement.versions.map((version) => version.approvedById),
  ])]
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })

  return {
    ...settlement,
    baseSegments: JSON.parse(settlement.baseSegmentsJson),
    versions: settlement.versions.map(({ snapshotJson, ...version }) => ({
      ...version,
      snapshot: JSON.parse(snapshotJson),
    })),
    calendarInSync,
    summary,
    actors: Object.fromEntries(actors.map((actor) => [actor.id, actor.name])),
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

export async function applySettlementAction(
  db: PrismaClient,
  actorId: string,
  id: string,
  action: PayrollSettlementAction
) {
  await db.$transaction(async (tx) => {
    const settlement = await tx.payrollSettlement.findUnique({
      where: { id },
      include: {
        employee: { select: EMPLOYEE_SELECT },
        overtimeLines: true,
        adjustments: true,
      },
    })
    if (!settlement) throw new PayrollError('Rozliczenie nie istnieje.', 404)
    if (settlement.revision !== action.expectedRevision) {
      throw new PayrollError('Rozliczenie zostało w międzyczasie zmienione. Odśwież widok.', 409)
    }
    const period = { year: settlement.year, month: settlement.month }
    const base = { employeeId: settlement.employeeId, settlementId: settlement.id, actorId }

    switch (action.action) {
      case 'calendar.sync': {
        requireDraft(settlement)
        const snapshot = await loadCalendarSnapshot(tx, settlement.employeeId, period, settlement.overtimeLines)
        const resolutionsBefore = JSON.stringify(settlement.overtimeLines
          .map((l) => [l.timeEntryId, l.resolution]).sort())
        const resolutionsAfter = JSON.stringify(snapshot.lines.map((l) => [l.timeEntryId, l.resolution]).sort())
        const changed = snapshot.fingerprint !== settlement.calendarFingerprint || resolutionsBefore !== resolutionsAfter
        await bumpRevision(tx, id, action.expectedRevision, {
          ...snapshotSettlementData(snapshot),
          ...(changed ? CLEAR_CONFIRMATION : {}),
        })
        await replaceOvertimeLines(tx, id, snapshot)
        await audit(tx, {
          ...base,
          action: 'calendar.sync',
          entityType: 'PayrollSettlement',
          entityId: id,
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
        return
      }

      case 'overtime.resolve': {
        requireDraft(settlement)
        const line = settlement.overtimeLines.find((l) => l.id === action.lineId)
        if (!line) throw new PayrollError('Pozycja nadgodzin nie istnieje.', 404)
        if (line.entryStatus !== 'approved') {
          throw new PayrollError('Najpierw zatwierdź ten wpis w kalendarzu czasu pracy.', 409)
        }
        await bumpRevision(tx, id, action.expectedRevision, CLEAR_CONFIRMATION)
        await tx.payrollOvertimeLine.update({
          where: { id: line.id },
          data: { resolution: action.resolution, resolutionSource: 'ADMIN' },
        })
        await audit(tx, {
          ...base,
          action: 'overtime.resolve',
          entityType: 'PayrollOvertimeLine',
          entityId: line.id,
          before: { date: line.date, minutes: line.overtimeMinutes, resolution: line.resolution },
          after: { date: line.date, minutes: line.overtimeMinutes, resolution: action.resolution },
        })
        return
      }

      case 'adjustment.add': {
        requireDraft(settlement)
        if (action.kind === 'BONUS' && action.amount <= 0) throw new PayrollError('Premia musi być dodatnia.')
        if (action.amount === 0) throw new PayrollError('Kwota nie może być zerowa.')
        await bumpRevision(tx, id, action.expectedRevision, CLEAR_CONFIRMATION)
        const row = await tx.payrollAdjustment.create({
          data: {
            settlementId: id,
            kind: action.kind,
            label: action.label,
            amountGrosze: action.amount,
            note: action.note,
            createdById: actorId,
          },
        })
        await audit(tx, {
          ...base,
          action: 'adjustment.add',
          entityType: 'PayrollAdjustment',
          entityId: row.id,
          after: { kind: row.kind, label: row.label, amountGrosze: row.amountGrosze, note: row.note },
        })
        return
      }

      case 'adjustment.update': {
        requireDraft(settlement)
        const row = settlement.adjustments.find((a) => a.id === action.adjustmentId && a.deletedAt === null)
        if (!row) throw new PayrollError('Pozycja nie istnieje lub została usunięta.', 404)
        if (row.kind === 'BONUS' && action.amount <= 0) throw new PayrollError('Premia musi być dodatnia.')
        if (action.amount === 0) throw new PayrollError('Kwota nie może być zerowa.')
        await bumpRevision(tx, id, action.expectedRevision, CLEAR_CONFIRMATION)
        await tx.payrollAdjustment.update({
          where: { id: row.id },
          data: { label: action.label, amountGrosze: action.amount, note: action.note },
        })
        await audit(tx, {
          ...base,
          action: 'adjustment.update',
          entityType: 'PayrollAdjustment',
          entityId: row.id,
          before: { kind: row.kind, label: row.label, amountGrosze: row.amountGrosze, note: row.note },
          after: { kind: row.kind, label: action.label, amountGrosze: action.amount, note: action.note },
          reason: action.reason,
        })
        return
      }

      case 'adjustment.delete': {
        requireDraft(settlement)
        const row = settlement.adjustments.find((a) => a.id === action.adjustmentId && a.deletedAt === null)
        if (!row) throw new PayrollError('Pozycja nie istnieje lub została usunięta.', 404)
        await bumpRevision(tx, id, action.expectedRevision, CLEAR_CONFIRMATION)
        await tx.payrollAdjustment.update({
          where: { id: row.id },
          data: { deletedAt: new Date(), deletedById: actorId },
        })
        await audit(tx, {
          ...base,
          action: 'adjustment.delete',
          entityType: 'PayrollAdjustment',
          entityId: row.id,
          before: { kind: row.kind, label: row.label, amountGrosze: row.amountGrosze, note: row.note },
          reason: action.reason,
        })
        return
      }

      case 'payrollOffice.confirm': {
        requireDraft(settlement)
        const summary = await currentSummary(tx, settlement)
        if (summary.inputBlockers.length > 0) {
          throw new PayrollError('Uzupełnij dane wejściowe przed potwierdzeniem kadrowej.', 409, {
            blockers: summary.inputBlockers.map((code) => ({ code, message: BLOCKER_LABELS[code] })),
          })
        }
        const figures = {
          finalGrossGrosze: action.finalGross,
          finalNetGrosze: action.finalNet,
          employerCostGrosze: action.employerCost,
        }
        const invalid = validatePayrollOfficeFigures({ employmentType: settlement.employee.employmentType, ...figures })
        if (invalid) throw new PayrollError(invalid)
        await bumpRevision(tx, id, action.expectedRevision, {
          ...figures,
          payrollOfficeReference: action.reference,
          payrollOfficeConfirmedAt: new Date(),
          payrollOfficeConfirmedById: actorId,
        })
        await audit(tx, {
          ...base,
          action: 'payrollOffice.confirm',
          entityType: 'PayrollSettlement',
          entityId: id,
          before: {
            finalGrossGrosze: settlement.finalGrossGrosze,
            finalNetGrosze: settlement.finalNetGrosze,
            employerCostGrosze: settlement.employerCostGrosze,
            reference: settlement.payrollOfficeReference,
          },
          after: { ...figures, reference: action.reference },
        })
        return
      }

      case 'approve': {
        requireDraft(settlement)
        const summary = await currentSummary(tx, settlement)
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

        await bumpRevision(tx, id, action.expectedRevision)
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
            employerCostGrosze: settlement.employerCostGrosze as number,
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
              adjustments: activeAdjustments.map(({ id: adjustmentId, kind, label, amountGrosze, note }) => ({
                id: adjustmentId, kind, label, amountGrosze, note,
              })),
            }),
            approvalNote: action.note,
            approvedById: actorId,
          },
        })
        await tx.payrollSettlement.update({
          where: { id },
          data: { status: 'APPROVED', currentVersionNumber: versionNumber },
        })
        await audit(tx, {
          ...base,
          action: 'settlement.approve',
          entityType: 'PayrollSettlementVersion',
          entityId: versionId,
          before: previous ? { versionNumber: previous.versionNumber, employerCostGrosze: previous.employerCostGrosze } : null,
          after: {
            versionNumber,
            finalGrossGrosze: settlement.finalGrossGrosze,
            finalNetGrosze: settlement.finalNetGrosze,
            employerCostGrosze: settlement.employerCostGrosze,
          },
          reason: action.note,
        })
        return
      }

      case 'reopen': {
        if (settlement.status !== 'APPROVED') throw new PayrollError('Otworzyć do korekty można tylko zatwierdzone rozliczenie.', 409)
        await bumpRevision(tx, id, action.expectedRevision, { status: 'DRAFT', ...CLEAR_CONFIRMATION })
        await audit(tx, {
          ...base,
          action: 'settlement.reopen',
          entityType: 'PayrollSettlement',
          entityId: id,
          before: { status: 'APPROVED', versionNumber: settlement.currentVersionNumber },
          after: { status: 'DRAFT', effectiveVersionStillCounted: settlement.currentVersionNumber },
          reason: action.reason,
        })
        return
      }
    }
  })

  return getSettlementDetail(db, id)
}

async function currentSummary(
  tx: Db,
  settlement: {
    employeeId: string
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
  }
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
  })
}
