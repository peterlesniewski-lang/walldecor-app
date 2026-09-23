import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AcceptanceLinkNotFoundError, publicAcceptanceProjection, submitClientAcceptance } from '@/lib/installations/acceptance-client'
import { AcceptanceProtocolError } from '@/lib/installations/acceptance-protocol'
import { z } from 'zod'
import { dispatchPendingAcceptanceAlerts } from '@/lib/installations/acceptance-alerts'

type Params = { params: Promise<{ token: string }> }
const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const responseSchema = z.object({
  decision: z.enum(['ACCEPTED', 'ACCEPTED_WITH_REMARKS', 'REFUSED']),
  firstName: z.string().min(1).max(100), lastName: z.string().min(1).max(100),
  relationship: z.string().min(1).max(120), note: z.string().max(3000),
  signature: z.string().max(400_000).nullable(),
}).strict()

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    return NextResponse.json({ protocol: await publicAcceptanceProjection(prisma, token) }, { headers: noStore })
  } catch (error) {
    if (error instanceof AcceptanceLinkNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: noStore })
    throw error
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    const parsed = responseSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Uzupełnij dane odbioru.' }, { status: 400, headers: noStore })
    const result = await submitClientAcceptance(prisma, token, parsed.data, req.headers.get('user-agent') ?? undefined)
    if (result.decision !== 'ACCEPTED') {
      // The response is already committed; a mail transport failure must not make
      // the client believe their signature was lost. The outbox remains retryable.
      try { await dispatchPendingAcceptanceAlerts(prisma, result.protocolId) } catch { /* retry from coordinator panel */ }
    }
    return NextResponse.json(result, { headers: noStore })
  } catch (error) {
    if (error instanceof AcceptanceLinkNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: noStore })
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: error.code === 'CONFLICT' ? 409 : 400, headers: noStore })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowe dane.' }, { status: 400, headers: noStore })
    throw error
  }
}
