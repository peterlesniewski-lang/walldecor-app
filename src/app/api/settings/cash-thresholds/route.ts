import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const settings = await prisma.appSetting.findMany({
    where: { key: { in: ['cashThresholdVeryGood', 'cashThresholdGood', 'cashThresholdBad'] } },
  })
  const result: Record<string, number> = {}
  for (const s of settings) result[s.key] = parseFloat(s.value)
  return NextResponse.json(result)
}

const UpdateSchema = z.object({
  cashThresholdVeryGood: z.number().positive(),
  cashThresholdGood: z.number().positive(),
  cashThresholdBad: z.number().positive(),
})

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = UpdateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid', details: parsed.error.flatten() }, { status: 400 })
  await Promise.all([
    prisma.appSetting.upsert({ where: { key: 'cashThresholdVeryGood' }, update: { value: String(parsed.data.cashThresholdVeryGood) }, create: { key: 'cashThresholdVeryGood', value: String(parsed.data.cashThresholdVeryGood) } }),
    prisma.appSetting.upsert({ where: { key: 'cashThresholdGood' }, update: { value: String(parsed.data.cashThresholdGood) }, create: { key: 'cashThresholdGood', value: String(parsed.data.cashThresholdGood) } }),
    prisma.appSetting.upsert({ where: { key: 'cashThresholdBad' }, update: { value: String(parsed.data.cashThresholdBad) }, create: { key: 'cashThresholdBad', value: String(parsed.data.cashThresholdBad) } }),
  ])
  return NextResponse.json({ ok: true })
}
