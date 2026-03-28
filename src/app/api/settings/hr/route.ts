import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const HR_DEFAULTS: Record<string, string> = {
  hr_saturday_workable: 'true',
  hr_standard_clock_in: '11:00',
  hr_standard_clock_out: '19:00',
  hr_overtime_threshold_minutes: '480',
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = await prisma.appSetting.findMany({
    where: { key: { startsWith: 'hr_' } },
  })

  const result: Record<string, string> = { ...HR_DEFAULTS }
  for (const s of settings) {
    result[s.key] = s.value
  }

  return NextResponse.json(result)
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()

  if (!Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid body — expected array of {key, value}' }, { status: 400 })
  }

  const updates = body as { key: string; value: string }[]

  await Promise.all(
    updates.map(({ key, value }) =>
      prisma.appSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  )

  return NextResponse.json({ ok: true })
}
