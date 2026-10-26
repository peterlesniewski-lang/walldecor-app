import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AcceptanceLinkNotFoundError, resolvePublicAcceptanceProtocol } from '@/lib/installations/acceptance-client'
import { AcceptanceProtocolError } from '@/lib/installations/acceptance-protocol'
import { getOrCreateAcceptancePdf, type AcceptancePdfKind } from '@/lib/installations/acceptance-pdf'

type Params = { params: Promise<{ token: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    const { protocolId } = await resolvePublicAcceptanceProtocol(prisma, token)
    const kind: AcceptancePdfKind = req.nextUrl.searchParams.get('kind') === 'UNILATERAL' ? 'UNILATERAL' : 'ACCEPTANCE'
    const document = await getOrCreateAcceptancePdf(prisma, protocolId, kind)
    return new NextResponse(new Uint8Array(document.bytes), { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="walldecor-protokol-${kind.toLowerCase()}.pdf"`,
      'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    } })
  } catch (error) {
    if (error instanceof AcceptanceLinkNotFoundError) return NextResponse.json({ error: 'Nie znaleziono dokumentu.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: error.code === 'NOT_FOUND' ? 404 : 409 })
    throw error
  }
}
