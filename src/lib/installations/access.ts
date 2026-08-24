import type { InstallationRole } from './constants'

export type InstallationOrderViewer = {
  role: InstallationRole
  employeeId: string | null | undefined
  /** Set by the session-to-user lookup. Omitted only by legacy pure-policy callers. */
  authorized?: boolean
  /** Verified against Employee.active before EMPLOYEE or INSTALLER policy is evaluated. */
  employeeActive?: boolean
}

/** A session is only a hint; all module policy depends on a current User row. */
export function isInstallationViewerAuthorized(viewer: InstallationOrderViewer): boolean {
  return viewer.authorized !== false
}

export type InstallationOrderAccessRecord = {
  archivedAt?: Date | string | null
  status?: string
  primaryEmployeeId: string
  backupEmployeeId: string
  installerAssignments: Array<{
    employeeId: string
  }>
  scopeAssignments: Array<{
    employeeId: string
  }>
  delegations: Array<{
    delegateEmployeeId: string
    startsAt: Date
    endsAt: Date | null
    endedAt: Date | null
  }>
}

function hasActiveDelegation(
  employeeId: string,
  order: InstallationOrderAccessRecord,
  now: Date,
) {
  return order.delegations.some((delegation) =>
    delegation.delegateEmployeeId === employeeId &&
    delegation.startsAt <= now &&
    delegation.endedAt === null &&
    (delegation.endsAt === null || delegation.endsAt >= now),
  )
}

export function canViewInstallationOrder(
  viewer: InstallationOrderViewer,
  order: InstallationOrderAccessRecord,
  now = new Date(),
): boolean {
  if (!isInstallationViewerAuthorized(viewer)) return false
  if (viewer.role === 'ADMIN' || viewer.role === 'MANAGER') return true
  if (viewer.role === 'INSTALLER') {
    return Boolean(viewer.employeeId && viewer.employeeActive === true && (
      order.installerAssignments.some((assignment) => assignment.employeeId === viewer.employeeId) ||
      order.scopeAssignments.some((assignment) => assignment.employeeId === viewer.employeeId)
    ))
  }
  if (viewer.role !== 'EMPLOYEE' || !viewer.employeeId || viewer.employeeActive !== true) return false
  if (viewer.employeeId === order.primaryEmployeeId || viewer.employeeId === order.backupEmployeeId) return true

  return hasActiveDelegation(viewer.employeeId, order, now)
}

/** Backwards-compatible name for read access. */
export const canAccessInstallationOrder = canViewInstallationOrder

/** Catalog and form publication are global configuration, never field work. */
export function canManageInstallationCatalog(viewer: InstallationOrderViewer): boolean {
  return isInstallationViewerAuthorized(viewer) && (viewer.role === 'ADMIN' || viewer.role === 'MANAGER')
}

export function canEditInstallationOrder(
  viewer: InstallationOrderViewer,
  order: InstallationOrderAccessRecord,
  now = new Date(),
): boolean {
  if (!isInstallationViewerAuthorized(viewer)) return false
  if (order.archivedAt || order.status === 'ARCHIVED') return false
  if (viewer.role === 'ADMIN' || viewer.role === 'MANAGER') return true
  if (viewer.role !== 'EMPLOYEE' || !viewer.employeeId || viewer.employeeActive !== true) return false
  return viewer.employeeId === order.primaryEmployeeId ||
    viewer.employeeId === order.backupEmployeeId ||
    hasActiveDelegation(viewer.employeeId, order, now)
}

export function canArchiveInstallationOrder(
  viewer: InstallationOrderViewer,
  order: InstallationOrderAccessRecord,
): boolean {
  if (!isInstallationViewerAuthorized(viewer)) return false
  if (order.archivedAt || order.status === 'ARCHIVED') return false
  if (viewer.role === 'ADMIN' || viewer.role === 'MANAGER') return true
  return viewer.role === 'EMPLOYEE' &&
    viewer.employeeActive === true &&
    Boolean(viewer.employeeId) &&
    (viewer.employeeId === order.primaryEmployeeId || viewer.employeeId === order.backupEmployeeId)
}
