import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { accessibleInstallationOrder, installationViewerFromSession } from '@/lib/installations/http-access'

export async function installerAcceptanceAccess(orderId: string): Promise<{ employeeId: string } | { response: NextResponse }> {
  const session = await getServerSession(authOptions)
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const viewer = await installationViewerFromSession(session)
  if (viewer.role !== 'INSTALLER' || viewer.employeeActive !== true || !viewer.employeeId || viewer.authorized === false) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const orderAccess = await accessibleInstallationOrder(orderId, viewer)
  if (orderAccess.response) return { response: orderAccess.response }
  return { employeeId: viewer.employeeId }
}
