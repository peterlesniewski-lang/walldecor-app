import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  KSEF_SETTING_KEYS,
  KsefSettingsUpdateSchema,
  maskSecret,
} from '@/lib/validations/ksef-settings'

const DEFAULTS = {
  enabled: false,
  environment: 'test',
  companyNip: '',
  syncFrom: '2026-02-01',
}

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role !== 'ADMIN') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const settings = await prisma.appSetting.findMany({
    where: { key: { in: [...KSEF_SETTING_KEYS] } },
  })
  const map = new Map(settings.map((setting) => [setting.key, setting.value]))
  const token = map.get('ksef_token') ?? ''

  return NextResponse.json({
    enabled: map.get('ksef_enabled') === 'true',
    environment: map.get('ksef_environment') ?? DEFAULTS.environment,
    companyNip: map.get('ksef_company_nip') ?? DEFAULTS.companyNip,
    syncFrom: map.get('ksef_sync_from') ?? DEFAULTS.syncFrom,
    hasToken: token.length > 0,
    tokenPreview: maskSecret(token),
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const body = await req.json()
  const parsed = KsefSettingsUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const data = parsed.data
  const writes = [
    prisma.appSetting.upsert({
      where: { key: 'ksef_enabled' },
      update: { value: String(data.enabled) },
      create: { key: 'ksef_enabled', value: String(data.enabled) },
    }),
    prisma.appSetting.upsert({
      where: { key: 'ksef_environment' },
      update: { value: data.environment },
      create: { key: 'ksef_environment', value: data.environment },
    }),
    prisma.appSetting.upsert({
      where: { key: 'ksef_company_nip' },
      update: { value: data.companyNip },
      create: { key: 'ksef_company_nip', value: data.companyNip },
    }),
    prisma.appSetting.upsert({
      where: { key: 'ksef_sync_from' },
      update: { value: data.syncFrom },
      create: { key: 'ksef_sync_from', value: data.syncFrom },
    }),
  ]

  if (data.token && data.token.length > 0) {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: 'ksef_token' },
        update: { value: data.token },
        create: { key: 'ksef_token', value: data.token },
      })
    )
  }

  await Promise.all(writes)
  return NextResponse.json({ ok: true })
}
