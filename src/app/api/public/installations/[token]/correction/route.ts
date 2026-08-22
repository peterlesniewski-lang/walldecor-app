import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { InstallationClientLinkNotFoundError, publicClientLinkNotFound } from '@/lib/installations/client-link'
import { startClientFormCorrection, InstallationFormValidationError } from '@/lib/installations/form-service'

type Params = { params: Promise<{ token: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    const submission = await startClientFormCorrection(prisma, token)
    return NextResponse.json(submission, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof InstallationClientLinkNotFoundError) return publicClientLinkNotFound()
    if (error instanceof InstallationFormValidationError) return NextResponse.json({ error: 'Nie można rozpocząć korekty formularza.' }, { status: 400 })
    throw error
  }
}
