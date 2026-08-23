import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { InstallationClientLinkNotFoundError, publicClientLinkNotFound } from '@/lib/installations/client-link'
import { submitClientForm, InstallationFormConflictError, InstallationFormValidationError, InstallationVisitFeeAcceptanceConflictError } from '@/lib/installations/form-service'
import { InstallationClientIpConfigurationError, readTrustedClientIp } from '@/lib/installations/client-ip'

type Params = { params: Promise<{ token: string }> }

const submitSchema = z.object({
  revisionNumber: z.number().int().min(1),
  draftVersion: z.number().int().min(0),
  clientMutationId: z.string().trim().min(12).max(160),
  visitFeeAccepted: z.literal(true).optional(),
  visitFeeSnapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
}).strict().superRefine((value, context) => {
  if ((value.visitFeeAccepted === true) !== (value.visitFeeSnapshotDigest !== undefined)) {
    context.addIssue({ code: 'custom', path: ['visitFeeAccepted'], message: 'Potwierdzenie opłaty wymaga dokładnej migawki.' })
  }
})
const noStore = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    const parsed = submitSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Dane wysłania formularza są niepoprawne.' }, { status: 400, headers: noStore })
    const submission = await submitClientForm(prisma, token, {
      ...parsed.data,
      clientIp: readTrustedClientIp(req.headers),
      clientUserAgent: req.headers.get('user-agent')?.trim() || undefined,
    })
    return NextResponse.json(submission, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof InstallationClientLinkNotFoundError) return publicClientLinkNotFound()
    if (error instanceof InstallationFormValidationError) return NextResponse.json({ error: 'Uzupełnij wymagane widoczne odpowiedzi.', fieldErrors: error.fieldErrors }, { status: 400, headers: noStore })
    if (error instanceof InstallationFormConflictError) return NextResponse.json({ error: 'Formularz został zapisany w nowszej wersji. Odśwież dane i spróbuj ponownie.' }, { status: 409, headers: noStore })
    if (error instanceof InstallationVisitFeeAcceptanceConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: noStore })
    if (error instanceof InstallationClientIpConfigurationError) return NextResponse.json({ error: 'Nie udało się bezpiecznie odczytać metadanych połączenia.' }, { status: 400, headers: noStore })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Dane wysłania formularza są niepoprawne.' }, { status: 400, headers: noStore })
    throw error
  }
}
