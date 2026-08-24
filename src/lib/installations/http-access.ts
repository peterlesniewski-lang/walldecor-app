import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canViewInstallationOrder, isInstallationViewerAuthorized, type InstallationOrderViewer } from './access'
import { INSTALLATION_ROLES, type InstallationRole } from './constants'
import { getInstallationOrder } from './order-service'

type InstallationSession = { user: { id: string; role: string; employeeId?: string | null } }

const deniedViewer: InstallationOrderViewer = {
  role: 'EMPLOYEE', employeeId: null, employeeActive: false, authorized: false,
}

/**
 * Resolves installation access from the current database row, not JWT claims.
 * A missing, disabled, or no-longer-supported account is denied before any
 * installation data is queried.
 */
export async function installationViewerFromSession(session: InstallationSession): Promise<InstallationOrderViewer> {
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      isActive: true,
      employeeId: true,
      employee: { select: { active: true } },
    },
  })
  if (!user?.isActive || !INSTALLATION_ROLES.includes(user.role as InstallationRole)) return deniedViewer

  const role = user.role as InstallationRole
  if (role === 'ADMIN' || role === 'MANAGER') {
    return { role, employeeId: user.employeeId, authorized: true }
  }

  const employeeActive = user.employee?.active === true
  if (!user.employeeId || !employeeActive) return deniedViewer
  return { role, employeeId: user.employeeId, employeeActive: true, authorized: true }
}

export async function accessibleInstallationOrder(id: string, viewer: InstallationOrderViewer) {
  if (!isInstallationViewerAuthorized(viewer)) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const order = await getInstallationOrder(prisma, id)
  if (!order) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (!canViewInstallationOrder(viewer, order)) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { order }
}
