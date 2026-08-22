import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageInstallationCatalog } from '@/lib/installations/access'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { getInstallationFormTemplate, InstallationCatalogValidationError, updateInstallationFormTemplateDraft } from '@/lib/installations/catalog-service'

type Params = { params: Promise<{ id: string }> }

async function catalogManager() {
  const session = await getServerSession(authOptions)
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!canManageInstallationCatalog(await installationViewerFromSession(session))) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const authorization = await catalogManager()
  if ('response' in authorization) return authorization.response
  const { id } = await params
  const template = await getInstallationFormTemplate(prisma, id)
  return template ? NextResponse.json(template) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const authorization = await catalogManager()
  if ('response' in authorization) return authorization.response
  const { id } = await params
  try {
    return NextResponse.json(await updateInstallationFormTemplateDraft(prisma, id, await req.json(), authorization.session.user.id))
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}
