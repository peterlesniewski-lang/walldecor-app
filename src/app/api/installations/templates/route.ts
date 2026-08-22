import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageInstallationCatalog } from '@/lib/installations/access'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { createInstallationFormTemplate, InstallationCatalogValidationError, listInstallationFormTemplates } from '@/lib/installations/catalog-service'

async function catalogManager() {
  const session = await getServerSession(authOptions)
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!canManageInstallationCatalog(await installationViewerFromSession(session))) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

export async function GET() {
  const authorization = await catalogManager()
  if ('response' in authorization) return authorization.response
  return NextResponse.json(await listInstallationFormTemplates(prisma))
}

export async function POST(req: NextRequest) {
  const authorization = await catalogManager()
  if ('response' in authorization) return authorization.response
  try {
    const body = await req.json()
    const template = await createInstallationFormTemplate(prisma, { ...body, actorId: authorization.session.user.id })
    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}
