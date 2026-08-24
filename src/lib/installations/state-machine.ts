import type { InstallationOrderStatus } from './constants'

export class InstallationOrderTransitionError extends Error {
  constructor() {
    super('Nie można oznaczyć zlecenia jako gotowego do planowania, dopóki istnieją otwarte kwestie do ustalenia.')
    this.name = 'InstallationOrderTransitionError'
  }
}

export function assertInstallationStatusTransition({
  from: _from,
  to,
  readiness,
}: {
  from: InstallationOrderStatus | string
  to: InstallationOrderStatus | string
  readiness: { isReady: boolean; openBlockingCount: number; submittedCount: number }
}) {
  if (to === 'READY_TO_PLAN' && (!readiness.isReady || readiness.openBlockingCount > 0 || readiness.submittedCount === 0)) {
    throw new InstallationOrderTransitionError()
  }
}
