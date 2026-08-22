import { NextResponse } from 'next/server'
import { canEditInstallationOrder } from './access'
import { accessibleInstallationOrder, installationViewerFromSession } from './http-access'
import { getInstallationOrderRooms } from './catalog-service'
import { prisma } from '@/lib/prisma'

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
