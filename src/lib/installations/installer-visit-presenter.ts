import type { InstallationOrderViewer } from './access'
import type { InstallationVisitView } from './visit-service'

export type InstallerInstallationVisitView = {
  id: string
  orderId: string
  status: string
  startsAt: Date | null
  endsAt: Date | null
  timezone: string
  revision: number
  scopeIds: string[]
  participants: Array<{
    employeeId: string
    name: string
    scopeIds: string[]
    inviteStatus: 'READY' | 'MISSING_EMAIL'
  }>
  syncState: { status: string }
}

/**
 * Fail-closed, explicit allowlist for installer-facing visit payloads.
 * A visit is visible only when the active linked employee participates in it.
 */
export function presentInstallerInstallationVisits(
  visits: InstallationVisitView[],
  viewer: InstallationOrderViewer,
): InstallerInstallationVisitView[] {
  if (viewer.role !== 'INSTALLER' || viewer.employeeActive !== true || !viewer.employeeId) return []

  return visits.flatMap((visit) => {
    const ownParticipants = visit.participants.filter((participant) => participant.employeeId === viewer.employeeId)
    if (ownParticipants.length === 0) return []

    return [{
      id: visit.id,
      orderId: visit.orderId,
      status: visit.status,
      startsAt: visit.startsAt,
      endsAt: visit.endsAt,
      timezone: visit.timezone,
      revision: visit.revision,
      scopeIds: [...visit.scopeIds],
      participants: ownParticipants.map((participant) => ({
        employeeId: participant.employeeId,
        name: participant.name,
        scopeIds: [...participant.scopeIds],
        inviteStatus: participant.inviteStatus,
      })),
      syncState: { status: visit.syncState.status },
    }]
  })
}
