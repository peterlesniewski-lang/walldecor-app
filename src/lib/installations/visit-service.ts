import { Prisma, PrismaClient } from '@/generated/prisma'
import {
  InstallationVisitValidationError,
  parseCreateInstallationVisit,
  parseInstallationVisitAction,
  type UpdateInstallationVisitActionInput,
} from './visit-schemas'

type InstallationDb = PrismaClient | Prisma.TransactionClient

const calendarKind = 'GOOGLE_CALENDAR'

const visitInclude = {
  scopes: {
    include: {
      scope: {
        select: {
          id: true,
          sortOrder: true,
          room: { select: { sortOrder: true } },
        },
      },
    },
  },
  syncStates: { where: { kind: calendarKind } },
} satisfies Prisma.InstallationVisitInclude

type StoredInstallationVisit = Prisma.InstallationVisitGetPayload<{ include: typeof visitInclude }>

export type InstallationVisitParticipant = {
  employeeId: string
  name: string
  email: string | null
  scopeIds: string[]
  inviteStatus: 'READY' | 'MISSING_EMAIL'
}

export type InstallationVisitSyncState = {
  status: string
  externalId: string | null
  externalUrl: string | null
  externalEtag: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  lastAttemptAt: Date | null
  lastSyncedAt: Date | null
}

export type InstallationVisitView = {
  id: string
  orderId: string
  status: string
  startsAt: Date | null
  endsAt: Date | null
  timezone: string
  note: string | null
  revision: number
  confirmedAt: Date | null
  cancelledAt: Date | null
  completedAt: Date | null
  createdById: string
  createdAt: Date
  updatedAt: Date
  scopeIds: string[]
  participants: InstallationVisitParticipant[]
  syncState: InstallationVisitSyncState
}

export class InstallationVisitRevisionConflictError extends Error {
  constructor() {
    super('Wizyta została zmieniona w nowszej wersji. Odśwież dane i spróbuj ponownie.')
    this.name = 'InstallationVisitRevisionConflictError'
  }
}

export class InstallationVisitArchivedOrderError extends Error {
  constructor() {
    super('Nie można zmieniać wizyt zarchiwizowanej karty montażu.')
    this.name = 'InstallationVisitArchivedOrderError'
  }
}

export class InstallationVisitNotFoundError extends Error {
  constructor() {
    super('Nie znaleziono wizyty dla tej karty montażu.')
    this.name = 'InstallationVisitNotFoundError'
  }
}

function missingCalendarState(): InstallationVisitSyncState {
  return {
    status: 'NOT_REQUESTED',
    externalId: null,
    externalUrl: null,
    externalEtag: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastAttemptAt: null,
    lastSyncedAt: null,
  }
}

function orderedScopeIds(visit: StoredInstallationVisit): string[] {
  return visit.scopes
    .slice()
    .sort((left, right) => left.scope.room.sortOrder - right.scope.room.sortOrder
      || left.scope.sortOrder - right.scope.sortOrder
      || left.scopeId.localeCompare(right.scopeId))
    .map((scope) => scope.scopeId)
}

function normalizeEmail(value: string): string | null {
  const email = value.trim()
  return email.length > 0 ? email : null
}

async function participantsForScopeIds(
  db: InstallationDb,
  orderId: string,
  scopeIds: string[],
): Promise<InstallationVisitParticipant[]> {
  if (scopeIds.length === 0) return []

  const assignments = await db.installationScopeAssignment.findMany({
    where: {
      orderId,
      scopeId: { in: scopeIds },
      employee: { active: true },
    },
    select: {
      scopeId: true,
      employee: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })
  const scopeOrder = new Map(scopeIds.map((scopeId, index) => [scopeId, index]))
  const participants = new Map<string, InstallationVisitParticipant>()

  for (const assignment of assignments) {
    const existing = participants.get(assignment.employee.id)
    if (existing) {
      existing.scopeIds.push(assignment.scopeId)
      continue
    }
    const email = normalizeEmail(assignment.employee.email)
    participants.set(assignment.employee.id, {
      employeeId: assignment.employee.id,
      name: `${assignment.employee.firstName} ${assignment.employee.lastName}`.trim(),
      email,
      scopeIds: [assignment.scopeId],
      inviteStatus: email ? 'READY' : 'MISSING_EMAIL',
    })
  }

  return [...participants.values()]
    .map((participant) => ({
      ...participant,
      scopeIds: [...new Set(participant.scopeIds)].sort((left, right) => (scopeOrder.get(left) ?? 0) - (scopeOrder.get(right) ?? 0)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'pl') || left.employeeId.localeCompare(right.employeeId))
}

async function toInstallationVisitView(db: InstallationDb, visit: StoredInstallationVisit): Promise<InstallationVisitView> {
  const scopeIds = orderedScopeIds(visit)
  const participants = await participantsForScopeIds(db, visit.orderId, scopeIds)
  const syncState = visit.syncStates[0]

  return {
    id: visit.id,
    orderId: visit.orderId,
    status: visit.status,
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
    timezone: visit.timezone,
    note: visit.note,
    revision: visit.revision,
    confirmedAt: visit.confirmedAt,
    cancelledAt: visit.cancelledAt,
    completedAt: visit.completedAt,
    createdById: visit.createdById,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
    scopeIds,
    participants,
    syncState: syncState ? {
      status: syncState.status,
      externalId: syncState.externalId,
      externalUrl: syncState.externalUrl,
      externalEtag: syncState.externalEtag,
      lastErrorCode: syncState.lastErrorCode,
      lastErrorMessage: syncState.lastErrorMessage,
      lastAttemptAt: syncState.lastAttemptAt,
      lastSyncedAt: syncState.lastSyncedAt,
    } : missingCalendarState(),
  }
}

async function loadVisitOrThrow(db: InstallationDb, orderId: string, visitId: string): Promise<StoredInstallationVisit> {
  const visit = await db.installationVisit.findFirst({
    where: { id: visitId, orderId },
    include: visitInclude,
  })
  if (!visit) throw new InstallationVisitNotFoundError()
  return visit
}

async function assertOrderIsMutable(db: InstallationDb, orderId: string) {
  const order = await db.installationOrder.findUnique({ where: { id: orderId }, select: { id: true, archivedAt: true } })
  if (!order) throw new InstallationVisitNotFoundError()
  if (order.archivedAt) throw new InstallationVisitArchivedOrderError()
}

async function assertScopesBelongToOrder(db: InstallationDb, orderId: string, scopeIds: string[]) {
  if (scopeIds.length === 0) return

  const scopes = await db.installationScope.findMany({
    where: { id: { in: scopeIds } },
    select: { id: true, room: { select: { orderId: true } } },
  })
  if (scopes.length !== scopeIds.length || scopes.some((scope) => scope.room.orderId !== orderId)) {
    throw new InstallationVisitValidationError({ scopeIds: 'Wybrany zakres nie należy do tej karty montażu.' })
  }
}

async function assertConfirmableParticipants(db: InstallationDb, orderId: string, scopeIds: string[]) {
  const participants = await participantsForScopeIds(db, orderId, scopeIds)
  if (participants.length === 0) {
    throw new InstallationVisitValidationError({ scopeIds: 'Potwierdzenie wymaga co najmniej jednego aktywnego instalatora przypisanego do wybranych zakresów.' })
  }
  if (!participants.some((participant) => participant.inviteStatus === 'READY')) {
    throw new InstallationVisitValidationError({ scopeIds: 'Potwierdzenie wymaga co najmniej jednego instalatora z adresem e-mail.' })
  }
}

function auditSnapshot(visit: StoredInstallationVisit) {
  return {
    id: visit.id,
    status: visit.status,
    startsAt: visit.startsAt?.toISOString() ?? null,
    endsAt: visit.endsAt?.toISOString() ?? null,
    timezone: visit.timezone,
    note: visit.note,
    revision: visit.revision,
    scopeIds: orderedScopeIds(visit),
  }
}

async function ensureCalendarSyncState(db: Prisma.TransactionClient, visitId: string) {
  return db.integrationSyncState.upsert({
    where: { visitId_kind: { visitId, kind: calendarKind } },
    create: { visitId, kind: calendarKind, status: 'NOT_REQUESTED' },
    update: {},
  })
}

async function enqueueCalendarOperation(
  db: Prisma.TransactionClient,
  visitId: string,
  revision: number,
  operation: 'CALENDAR_UPSERT' | 'CALENDAR_CANCEL',
) {
  await db.integrationSyncState.upsert({
    where: { visitId_kind: { visitId, kind: calendarKind } },
    create: { visitId, kind: calendarKind, status: 'PENDING' },
    update: { status: 'PENDING', lastErrorCode: null, lastErrorMessage: null },
  })
  await db.integrationOutbox.create({
    data: {
      visitId,
      revision,
      operation,
      idempotencyKey: `calendar:${visitId}:${revision}:${operation}`,
      status: 'PENDING',
    },
  })
}

function actionAuditName(action: UpdateInstallationVisitActionInput['action']): string {
  switch (action) {
    case 'SAVE_DRAFT': return 'INSTALLATION_VISIT_DRAFT_SAVED'
    case 'CONFIRM': return 'INSTALLATION_VISIT_CONFIRMED'
    case 'CANCEL': return 'INSTALLATION_VISIT_CANCELLED'
    case 'COMPLETE': return 'INSTALLATION_VISIT_COMPLETED'
  }
}

const allowedActionsByStatus: Readonly<Partial<Record<string, readonly UpdateInstallationVisitActionInput['action'][]>>> = {
  DRAFT: ['SAVE_DRAFT', 'CONFIRM', 'CANCEL'],
  CONFIRMED: ['CONFIRM', 'CANCEL', 'COMPLETE'],
}

function assertAllowedVisitTransition(status: string, action: UpdateInstallationVisitActionInput['action']) {
  if (!allowedActionsByStatus[status]?.includes(action)) {
    throw new InstallationVisitValidationError({
      action: `Nie można wykonać akcji ${action} dla wizyty o statusie ${status}.`,
    })
  }
}

async function replaceVisitScopes(
  db: Prisma.TransactionClient,
  visitId: string,
  orderId: string,
  scopeIds: string[],
) {
  await db.installationVisitScope.deleteMany({ where: { visitId } })
  if (scopeIds.length > 0) {
    await db.installationVisitScope.createMany({
      data: scopeIds.map((scopeId) => ({ visitId, orderId, scopeId })),
    })
  }
}

export async function listInstallationVisits(db: InstallationDb, orderId: string): Promise<InstallationVisitView[]> {
  const visits = await db.installationVisit.findMany({
    where: { orderId },
    include: visitInclude,
    orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
  })
  return Promise.all(visits.map((visit) => toInstallationVisitView(db, visit)))
}

export async function createInstallationVisit(
  db: PrismaClient,
  orderId: string,
  input: unknown,
  actorId: string,
): Promise<InstallationVisitView> {
  const parsed = parseCreateInstallationVisit(input)

  return db.$transaction(async (tx) => {
    await assertOrderIsMutable(tx, orderId)
    await assertScopesBelongToOrder(tx, orderId, parsed.scopeIds)
    const visit = await tx.installationVisit.create({
      data: {
        orderId,
        status: 'DRAFT',
        startsAt: parsed.startsAt ?? null,
        endsAt: parsed.endsAt ?? null,
        note: parsed.note ?? null,
        createdById: actorId,
        scopes: { create: parsed.scopeIds.map((scopeId) => ({ orderId, scopeId })) },
        syncStates: { create: { kind: calendarKind, status: 'NOT_REQUESTED' } },
      },
      include: visitInclude,
    })
    await tx.installationAuditEvent.create({
      data: {
        orderId,
        actorId,
        action: 'INSTALLATION_VISIT_CREATED',
        afterJson: JSON.stringify(auditSnapshot(visit)),
      },
    })
    return toInstallationVisitView(tx, visit)
  })
}

export async function changeInstallationVisit(
  db: PrismaClient,
  orderId: string,
  visitId: string,
  input: unknown,
  actorId: string,
): Promise<InstallationVisitView> {
  const parsed = parseInstallationVisitAction(input)

  return db.$transaction(async (tx) => {
    await assertOrderIsMutable(tx, orderId)
    const current = await loadVisitOrThrow(tx, orderId, visitId)
    if (current.revision !== parsed.expectedRevision) throw new InstallationVisitRevisionConflictError()
    assertAllowedVisitTransition(current.status, parsed.action)

    let scopeIds = orderedScopeIds(current)
    let nextStatus = current.status
    let operation: 'CALENDAR_UPSERT' | 'CALENDAR_CANCEL' | null = null
    const now = new Date()
    const patch: Prisma.InstallationVisitUpdateManyMutationInput = { revision: { increment: 1 } }

    switch (parsed.action) {
      case 'SAVE_DRAFT': {
        scopeIds = parsed.scopeIds
        await assertScopesBelongToOrder(tx, orderId, scopeIds)
        nextStatus = 'DRAFT'
        patch.status = nextStatus
        patch.startsAt = parsed.startsAt ?? null
        patch.endsAt = parsed.endsAt ?? null
        patch.note = parsed.note ?? null
        break
      }
      case 'CONFIRM': {
        scopeIds = parsed.scopeIds
        await assertScopesBelongToOrder(tx, orderId, scopeIds)
        await assertConfirmableParticipants(tx, orderId, scopeIds)
        nextStatus = 'CONFIRMED'
        patch.status = nextStatus
        patch.startsAt = parsed.startsAt
        patch.endsAt = parsed.endsAt
        patch.note = parsed.note ?? null
        patch.confirmedAt = current.confirmedAt ?? now
        operation = 'CALENDAR_UPSERT'
        break
      }
      case 'CANCEL': {
        nextStatus = 'CANCELLED'
        patch.status = nextStatus
        patch.cancelledAt = now
        operation = current.status === 'CONFIRMED' ? 'CALENDAR_CANCEL' : null
        break
      }
      case 'COMPLETE': {
        nextStatus = 'COMPLETED'
        patch.status = nextStatus
        patch.completedAt = now
        break
      }
    }

    const changed = await tx.installationVisit.updateMany({
      where: { id: visitId, orderId, revision: parsed.expectedRevision },
      data: patch,
    })
    if (changed.count !== 1) throw new InstallationVisitRevisionConflictError()

    if (parsed.action === 'SAVE_DRAFT' || parsed.action === 'CONFIRM') {
      await replaceVisitScopes(tx, visitId, orderId, scopeIds)
    }
    await ensureCalendarSyncState(tx, visitId)

    const revision = parsed.expectedRevision + 1
    if (operation) await enqueueCalendarOperation(tx, visitId, revision, operation)

    const updated = await loadVisitOrThrow(tx, orderId, visitId)
    await tx.installationAuditEvent.create({
      data: {
        orderId,
        actorId,
        action: actionAuditName(parsed.action),
        beforeJson: JSON.stringify(auditSnapshot(current)),
        afterJson: JSON.stringify(auditSnapshot(updated)),
      },
    })
    return toInstallationVisitView(tx, updated)
  })
}

export async function requeueInstallationCalendar(
  db: PrismaClient,
  orderId: string,
  visitId: string,
  forceOverwrite: boolean,
  actorId: string,
): Promise<InstallationVisitView> {
  return db.$transaction(async (tx) => {
    await assertOrderIsMutable(tx, orderId)
    const visit = await loadVisitOrThrow(tx, orderId, visitId)
    const failedJob = await tx.integrationOutbox.findFirst({
      where: { visitId, revision: visit.revision, status: 'DEAD' },
      orderBy: { updatedAt: 'desc' },
    })
    if (!failedJob) {
      throw new InstallationVisitValidationError({ form: 'Nie ma nieudanego zadania kalendarza do ponowienia.' })
    }

    const now = new Date()
    await tx.integrationOutbox.update({
      where: { id: failedJob.id },
      data: {
        status: 'PENDING',
        forceOverwrite,
        attemptCount: 0,
        availableAt: now,
        lockedUntil: null,
        completedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    })
    await tx.integrationSyncState.upsert({
      where: { visitId_kind: { visitId, kind: calendarKind } },
      create: { visitId, kind: calendarKind, status: 'PENDING' },
      update: { status: 'PENDING', lastErrorCode: null, lastErrorMessage: null },
    })
    const updated = await loadVisitOrThrow(tx, orderId, visitId)
    await tx.installationAuditEvent.create({
      data: {
        orderId,
        actorId,
        action: 'INSTALLATION_CALENDAR_REQUEUED',
        beforeJson: JSON.stringify(auditSnapshot(visit)),
        afterJson: JSON.stringify(auditSnapshot(updated)),
        metadataJson: JSON.stringify({ outboxId: failedJob.id, forceOverwrite }),
      },
    })
    return toInstallationVisitView(tx, updated)
  })
}
