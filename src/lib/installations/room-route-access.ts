import { NextResponse } from 'next/server'
import { canEditInstallationOrder, type InstallationOrderViewer } from './access'
import { accessibleInstallationOrder, installationViewerFromSession, type AccessibleInstallationOrderResult } from './http-access'
import { getInstallationOrderRooms } from './catalog-service'
import { prisma } from '@/lib/prisma'
import type { InstallationRole } from './constants'

export type InternalMeasurementActor = {
  userId: string
  role: InstallationRole
  employeeId: string | null
}

export type EditableInstallationOrderResult =
  | { response: NextResponse; order?: never; viewer?: never }
  | { order: Extract<AccessibleInstallationOrderResult, { order: unknown }>['order']; viewer: InstallationOrderViewer; response?: never }

export async function editableInstallationOrder(
  session: { user: { id: string; role: string; employeeId?: string | null } },
  orderId: string,
): Promise<EditableInstallationOrderResult> {
  const viewer = await installationViewerFromSession(session)
  const loaded = await accessibleInstallationOrder(orderId, viewer)
  if (loaded.response) return { response: loaded.response }
  if (!canEditInstallationOrder(viewer, loaded.order)) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  if (loaded.order.archivedAt) return { response: NextResponse.json({ error: 'Archived' }, { status: 409 }) }
  return { order: loaded.order, viewer }
}

export async function roomInInstallationOrder(orderId: string, roomId: string) {
  const rooms = await getInstallationOrderRooms(prisma, orderId)
  return rooms.find((room) => room.id === roomId) ?? null
}

/**
 * Provenance is derived from the same current User record that authorized the
 * write. An inactive or demoted session can never write a stale role into a
 * measurement audit record.
 */
export function measurementActorFromViewer(userId: string, viewer: InstallationOrderViewer): InternalMeasurementActor {
  const employeeId = viewer.role === 'EMPLOYEE' || viewer.role === 'INSTALLER'
    ? viewer.employeeId ?? null
    : null
  return { userId, role: viewer.role, employeeId }
}
