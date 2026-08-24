import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { InstallationClientLinkNotFoundError, publicClientLinkNotFound } from '@/lib/installations/client-link'
import { startClientFormCorrection, InstallationFormValidationError } from '@/lib/installations/form-service'

type Params = { params: Promise<{ token: string }> }
const noStore = { 'Cache-Control': 'no-store' }
const correctionSchema = z.object({ clientMutationId: z.string().trim().min(12).max(160) }).strict()

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    const parsed = correctionSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Dane korekty formularza są niepoprawne.' }, { status: 400, headers: noStore })
    const submission = await startClientFormCorrection(prisma, token)
    return NextResponse.json(submission, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof InstallationClientLinkNotFoundError) return publicClientLinkNotFound()
    if (error instanceof InstallationFormValidationError) return NextResponse.json({ error: 'Nie można rozpocząć korekty formularza.' }, { status: 400, headers: noStore })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Dane korekty formularza są niepoprawne.' }, { status: 400, headers: noStore })
    throw error
  }
}
