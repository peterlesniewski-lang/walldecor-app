import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getInstallationCalendarReadiness } from '@/lib/installations/calendar-config'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(getInstallationCalendarReadiness(), { headers: { 'Cache-Control': 'no-store' } })
}
