import { Prisma, type PrismaClient } from '@/generated/prisma'
import { isInstallationViewerAuthorized, type InstallationOrderViewer } from './access'
import { getInstallerInstallationOrderRooms } from './catalog-service'
import { presentInstallerInstallationOrder } from './order-presenter'
import type { InstallerInstallationVisitView } from './installer-visit-presenter'

type InstallationDb = PrismaClient | Prisma.TransactionClient

/** Installer queries must already be private before any promise resolves into RSC traces. */
export async function getInstallerInstallationCardData(db: InstallationDb, orderId: string, viewer: InstallationOrderViewer) {
  if (!isInstallationViewerAuthorized(viewer) || viewer.role !== 'INSTALLER' || viewer.employeeActive !== true || !viewer.employeeId) return null
  const employeeId = viewer.employeeId
  const ownAssignment = { employeeId, employee: { active: true } }
  const order = await db.installationOrder.findFirst({
    where: { id: orderId, OR: [{ installerAssignments: { some: ownAssignment } }, { scopeAssignments: { some: ownAssignment } }] },
    select: {
      id: true, number: true, status: true, archivedAt: true,
      client: { select: { name: true } },
      addressStreet: true, addressBuildingNumber: true, addressApartmentNumber: true, addressPostalCode: true, addressCity: true,
      primaryEmployee: { select: { firstName: true, lastName: true } },
      backupEmployee: { select: { firstName: true, lastName: true } },
    },
  })
  if (!order) return null

  // Same whitespace set as String.trim used by the coordinator visit service.
  // Only the computed eligibility leaves SQL; the email itself is never selected.
  const trimCharacters = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
  const ownEmployees = await db.$queryRaw<Array<{ id: string; firstName: string; lastName: string; inviteStatus: 'READY' | 'MISSING_EMAIL' }>>(Prisma.sql`
    SELECT "id", "firstName", "lastName",
      CASE WHEN length(trim("email", ${trimCharacters})) > 0 THEN 'READY' ELSE 'MISSING_EMAIL' END AS "inviteStatus"
    FROM "Employee" WHERE "id" = ${employeeId} AND "active" = 1
  `)
  const ownEmployee = ownEmployees[0]
  if (!ownEmployee) return null
  const participatingAssignment = { ...ownAssignment, orderId }
  const [rooms, storedVisits] = await Promise.all([
    getInstallerInstallationOrderRooms(db, orderId, employeeId),
    db.installationVisit.findMany({
      where: { orderId, scopes: { some: { scope: { assignments: { some: participatingAssignment } } } } },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, orderId: true, status: true, startsAt: true, endsAt: true, timezone: true, revision: true,
        syncStates: { where: { kind: 'GOOGLE_CALENDAR' }, select: { status: true } },
        scopes: { select: { scopeId: true, scope: { select: {
          sortOrder: true, room: { select: { sortOrder: true } },
          assignments: { where: participatingAssignment, select: { employeeId: true } },
        } } } },
      },
    }),
  ])
  const visits: InstallerInstallationVisitView[] = storedVisits.map((visit) => {
    const scopes = [...visit.scopes].sort((left, right) => left.scope.room.sortOrder - right.scope.room.sortOrder || left.scope.sortOrder - right.scope.sortOrder || left.scopeId.localeCompare(right.scopeId))
    return {
      id: visit.id, orderId: visit.orderId, status: visit.status, startsAt: visit.startsAt, endsAt: visit.endsAt, timezone: visit.timezone, revision: visit.revision,
      scopeIds: scopes.map((scope) => scope.scopeId),
      participants: [{ employeeId, name: `${ownEmployee.firstName} ${ownEmployee.lastName}`.trim(), scopeIds: scopes.filter((scope) => scope.scope.assignments.length > 0).map((scope) => scope.scopeId), inviteStatus: ownEmployee.inviteStatus }],
      syncState: { status: visit.syncStates[0]?.status ?? 'NOT_REQUESTED' },
    }
  })
  return { order: presentInstallerInstallationOrder(order), rooms, visits }
}
