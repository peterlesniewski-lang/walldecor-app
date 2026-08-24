import { Prisma, PrismaClient } from '@/generated/prisma'
import {
  InstallationVisitParticipantsUnavailableError,
  refreshConfirmedInstallationVisitsAfterScopeAssignment,
} from './visit-service'

type InstallationDb = PrismaClient | Prisma.TransactionClient

export type ScopeAssignmentView = {
  scopeId: string
  employeeIds: string[]
}

export class InstallationScopeAssignmentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstallationScopeAssignmentValidationError'
  }
}

/** A Task 5 route maps this distinct lifecycle conflict to HTTP 409. */
export class InstallationScopeAssignmentArchivedOrderError extends Error {
  constructor() {
    super('Nie można zmieniać ekipy zarchiwizowanej karty montażu.')
    this.name = 'InstallationScopeAssignmentArchivedOrderError'
  }
}

function normalizeEmployeeIds(employeeIds: string[]): string[] {
  return [...new Set(employeeIds.map((employeeId) => employeeId.trim()).filter(Boolean))].sort()
}

async function assertScopeBelongsToOrder(
  db: InstallationDb,
  orderId: string,
  scopeId: string,
) {
  const scope = await db.installationScope.findUnique({
    where: { id: scopeId },
    select: { room: { select: { orderId: true, order: { select: { archivedAt: true } } } } },
  })
  if (!scope || scope.room.orderId !== orderId) {
    throw new InstallationScopeAssignmentValidationError('Zakres nie należy do tego zlecenia montażu.')
  }
  if (scope.room.order.archivedAt) throw new InstallationScopeAssignmentArchivedOrderError()
}

async function assertActiveEmployees(db: InstallationDb, employeeIds: string[]) {
  if (employeeIds.length === 0) return

  const activeEmployees = await db.employee.findMany({
    where: { id: { in: employeeIds }, active: true },
    select: { id: true },
  })
  if (activeEmployees.length !== employeeIds.length) {
    throw new InstallationScopeAssignmentValidationError('Do zakresu można przypisać wyłącznie aktywnych pracowników.')
  }
}

export async function setScopeInstallerAssignments(
  db: PrismaClient,
  orderId: string,
  scopeId: string,
  employeeIds: string[],
  actorId: string,
): Promise<ScopeAssignmentView> {
  const normalizedEmployeeIds = normalizeEmployeeIds(employeeIds)

  return db.$transaction(async (tx) => {
    await assertScopeBelongsToOrder(tx, orderId, scopeId)
    const before = await tx.installationScopeAssignment.findMany({
      where: { orderId, scopeId },
      select: { employeeId: true },
      orderBy: { employeeId: 'asc' },
    })
    const beforeEmployeeIds = before.map((assignment) => assignment.employeeId)
    if (beforeEmployeeIds.length === normalizedEmployeeIds.length
      && beforeEmployeeIds.every((employeeId, index) => employeeId === normalizedEmployeeIds[index])) {
      return { scopeId, employeeIds: normalizedEmployeeIds }
    }

    await assertActiveEmployees(tx, normalizedEmployeeIds)

    await tx.installationScopeAssignment.deleteMany({ where: { orderId, scopeId } })
    if (normalizedEmployeeIds.length > 0) {
      await tx.installationScopeAssignment.createMany({
        data: normalizedEmployeeIds.map((employeeId) => ({ orderId, scopeId, employeeId, createdById: actorId })),
      })
    }
    try {
      await refreshConfirmedInstallationVisitsAfterScopeAssignment(tx, orderId, scopeId, actorId)
    } catch (error) {
      if (error instanceof InstallationVisitParticipantsUnavailableError) {
        throw new InstallationScopeAssignmentValidationError(
          'Nie można zmienić ekipy: potwierdzona wizyta musi zachować co najmniej jednego aktywnego instalatora z adresem e-mail.',
        )
      }
      throw error
    }
    await tx.installationAuditEvent.create({
      data: {
        orderId,
        actorId,
        action: 'INSTALLATION_SCOPE_ASSIGNMENTS_CHANGED',
        beforeJson: JSON.stringify({ scopeId, employeeIds: beforeEmployeeIds }),
        afterJson: JSON.stringify({ scopeId, employeeIds: normalizedEmployeeIds }),
      },
    })

    return { scopeId, employeeIds: normalizedEmployeeIds }
  })
}

export async function listScopeInstallerAssignments(
  db: InstallationDb,
  orderId: string,
): Promise<ScopeAssignmentView[]> {
  const [scopes, assignments] = await Promise.all([
    db.installationScope.findMany({
      where: { room: { orderId } },
      select: { id: true, sortOrder: true, room: { select: { sortOrder: true } } },
    }),
    db.installationScopeAssignment.findMany({
      where: { orderId },
      select: { scopeId: true, employeeId: true },
      orderBy: { employeeId: 'asc' },
    }),
  ])
  const employeeIdsByScope = new Map<string, string[]>()
  for (const assignment of assignments) {
    const employeeIds = employeeIdsByScope.get(assignment.scopeId) ?? []
    employeeIds.push(assignment.employeeId)
    employeeIdsByScope.set(assignment.scopeId, employeeIds)
  }

  return scopes
    .sort((left, right) => left.room.sortOrder - right.room.sortOrder || left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .flatMap((scope) => {
      const employeeIds = employeeIdsByScope.get(scope.id)
      return employeeIds?.length ? [{ scopeId: scope.id, employeeIds }] : []
    })
}
