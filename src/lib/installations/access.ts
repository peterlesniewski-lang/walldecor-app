import type { InstallationRole } from './constants'

export type InstallationOrderViewer = {
  role: InstallationRole
  employeeId: string | null | undefined
}

export type InstallationOrderAccessRecord = {
  primaryEmployeeId: string
  backupEmployeeId: string
  isAssignedInstaller: boolean
  delegations: Array<{
    delegateEmployeeId: string
    startsAt: Date
    endsAt: Date | null
    endedAt: Date | null
  }>
}

export function canAccessInstallationOrder(
  viewer: InstallationOrderViewer,
  order: InstallationOrderAccessRecord,
  now = new Date(),
): boolean {
  if (viewer.role === 'ADMIN' || viewer.role === 'MANAGER') return true
  if (viewer.role === 'INSTALLER') return order.isAssignedInstaller
  if (viewer.role !== 'EMPLOYEE' || !viewer.employeeId) return false
  if (viewer.employeeId === order.primaryEmployeeId || viewer.employeeId === order.backupEmployeeId) return true

  return order.delegations.some((delegation) =>
    delegation.delegateEmployeeId === viewer.employeeId &&
    delegation.startsAt <= now &&
    delegation.endedAt === null &&
    (delegation.endsAt === null || delegation.endsAt >= now),
  )
}
