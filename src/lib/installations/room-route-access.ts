import { NextResponse } from 'next/server'
import { canEditInstallationOrder } from './access'
import { accessibleInstallationOrder, installationViewerFromSession } from './http-access'
import { getInstallationOrderRooms } from './catalog-service'
import { prisma } from '@/lib/prisma'
import { INSTALLATION_ROLES, type InstallationRole } from './constants'

export type InternalMeasurementActor = {
  userId: string
  role: InstallationRole
  employeeId: string | null
}

export async function editableInstallationOrder(session: { user: { role: string; employeeId?: string | null } }, orderId: string) {
  const viewer = await installationViewerFromSession(session)
  const loaded = await accessibleInstallationOrder(orderId, viewer)
  if ('response' in loaded) return loaded
  if (!canEditInstallationOrder(viewer, loaded.order)) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  if (loaded.order.archivedAt) return { response: NextResponse.json({ error: 'Archived' }, { status: 409 }) }
  return loaded
}

export async function roomInInstallationOrder(orderId: string, roomId: string) {
  const rooms = await getInstallationOrderRooms(prisma, orderId)
  return rooms.find((room) => room.id === roomId) ?? null
}

/**
 * Provenance comes only from the authenticated server session. An inactive
 * employee is never recorded as the measurement author; ADMIN/MANAGER still
 * retain their user ID and role without impersonating an Employee row.
 */
export async function measurementActorFromSession(session: { user: { id: string; role: string; employeeId?: string | null } }): Promise<InternalMeasurementActor> {
  const role = INSTALLATION_ROLES.includes(session.user.role as InstallationRole) ? session.user.role as InstallationRole : 'EMPLOYEE'
  const employee = session.user.employeeId
    ? await prisma.employee.findUnique({ where: { id: session.user.employeeId }, select: { active: true } })
    : null
  return { userId: session.user.id, role, employeeId: employee?.active ? session.user.employeeId ?? null : null }
}
