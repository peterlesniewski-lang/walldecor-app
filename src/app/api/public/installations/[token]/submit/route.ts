import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { InstallationClientLinkNotFoundError, publicClientLinkNotFound } from '@/lib/installations/client-link'
import { submitClientForm, InstallationFormConflictError, InstallationFormValidationError } from '@/lib/installations/form-service'

type Params = { params: Promise<{ token: string }> }

const submitSchema = z.object({
  revisionNumber: z.number().int().min(1),
  draftVersion: z.number().int().min(0),
  clientMutationId: z.string().trim().min(12).max(160),
}).strict()
const noStore = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    const parsed = submitSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Dane wysłania formularza są niepoprawne.' }, { status: 400, headers: noStore })
    const submission = await submitClientForm(prisma, token, parsed.data)
    return NextResponse.json(submission, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof InstallationClientLinkNotFoundError) return publicClientLinkNotFound()
    if (error instanceof InstallationFormValidationError) return NextResponse.json({ error: 'Uzupełnij wymagane widoczne odpowiedzi.', fieldErrors: error.fieldErrors }, { status: 400, headers: noStore })
    if (error instanceof InstallationFormConflictError) return NextResponse.json({ error: 'Formularz został zapisany w nowszej wersji. Odśwież dane i spróbuj ponownie.' }, { status: 409, headers: noStore })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Dane wysłania formularza są niepoprawne.' }, { status: 400, headers: noStore })
    throw error
  }
}
