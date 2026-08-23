import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { InstallationClientLinkNotFoundError, loadPublicInstallationProjection, publicClientLinkNotFound } from '@/lib/installations/client-link'
import {
  acceptClientVisitFee,
  InstallationFormValidationError,
  InstallationVisitFeeAcceptanceConflictError,
} from '@/lib/installations/form-service'
import { InstallationClientIpConfigurationError, readTrustedClientIp } from '@/lib/installations/client-ip'

type Params = { params: Promise<{ token: string }> }

const bodySchema = z.object({
  accepted: z.literal(true),
  snapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict()
const noStore = { 'Cache-Control': 'no-store' }

/** Accepts only the exact fee snapshot shown after a previously submitted form. */
export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Potwierdź aktualną kwotę i wersję klauzuli.' }, { status: 400, headers: noStore })
    await acceptClientVisitFee(prisma, token, {
      ...parsed.data,
      clientIp: readTrustedClientIp(req.headers),
      clientUserAgent: req.headers.get('user-agent')?.trim() || undefined,
    })
    return NextResponse.json(await loadPublicInstallationProjection(prisma, token), { headers: noStore })
  } catch (error) {
    if (error instanceof InstallationClientLinkNotFoundError) return publicClientLinkNotFound()
    if (error instanceof InstallationVisitFeeAcceptanceConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: noStore })
    if (error instanceof InstallationFormValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400, headers: noStore })
    if (error instanceof InstallationClientIpConfigurationError) return NextResponse.json({ error: 'Nie udało się bezpiecznie odczytać metadanych połączenia.' }, { status: 400, headers: noStore })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Potwierdź aktualną kwotę i wersję klauzuli.' }, { status: 400, headers: noStore })
    throw error
  }
}
