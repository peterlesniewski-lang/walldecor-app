import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canViewInstallationOrder, type InstallationOrderViewer } from './access'
import { INSTALLATION_ROLES, type InstallationRole } from './constants'
import { getInstallationOrder } from './order-service'

export async function installationViewerFromSession(session: { user: { role: string; employeeId?: string | null } }): Promise<InstallationOrderViewer> {
  const role = INSTALLATION_ROLES.includes(session.user.role as InstallationRole) ? session.user.role as InstallationRole : 'EMPLOYEE'
  if (role !== 'EMPLOYEE') return { role, employeeId: session.user.employeeId }
  if (!session.user.employeeId) return { role, employeeId: null, employeeActive: false }
  const employee = await prisma.employee.findUnique({ where: { id: session.user.employeeId }, select: { active: true } })
  return { role, employeeId: session.user.employeeId, employeeActive: employee?.active === true }
}

export async function accessibleInstallationOrder(id: string, viewer: InstallationOrderViewer) {
  const order = await getInstallationOrder(prisma, id)
  if (!order) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (!canViewInstallationOrder(viewer, order)) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { order }
}
