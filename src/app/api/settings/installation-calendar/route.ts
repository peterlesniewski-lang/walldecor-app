import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isInstallationViewerAuthorized } from '@/lib/installations/access'
import { getInstallationCalendarReadiness } from '@/lib/installations/calendar-server-config'
import { installationViewerFromSession } from '@/lib/installations/http-access'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const viewer = await installationViewerFromSession(session)
  if (!isInstallationViewerAuthorized(viewer) || viewer.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(getInstallationCalendarReadiness(), { headers: { 'Cache-Control': 'no-store' } })
}
