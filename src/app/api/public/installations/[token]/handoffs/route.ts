import QRCode from 'qrcode'
import { NextRequest, NextResponse } from 'next/server'
import { publicClientLinkNotFound } from '@/lib/installations/client-link'
import { createMobileUploadHandoff, InstallationMediaAccessError, InstallationMediaValidationError } from '@/lib/installation-media/service'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ token: string }> }
const noStore = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    const body = await req.json() as { questionKey?: unknown }
    if (typeof body.questionKey !== 'string' || !body.questionKey.trim() || body.questionKey.length > 160) {
      return NextResponse.json({ error: 'Wskaż pytanie, którego dotyczy zdjęcie.' }, { status: 400, headers: noStore })
    }
    const handoff = await createMobileUploadHandoff(prisma, token, { questionKey: body.questionKey.trim() })
    const handoffUrl = new URL(`/m/u/${handoff.code}`, req.nextUrl.origin).toString()
    const qrSvg = await QRCode.toString(handoffUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    return NextResponse.json({ handoffId: handoff.handoffId, handoffUrl, qrSvg, expiresAt: handoff.expiresAt.toISOString() }, { status: 201, headers: noStore })
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return publicClientLinkNotFound()
    if (error instanceof InstallationMediaValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400, headers: noStore })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Dane przekazania telefonu są niepoprawne.' }, { status: 400, headers: noStore })
    throw error
  }
}
