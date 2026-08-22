import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageInstallationCatalog } from '@/lib/installations/access'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { InstallationCatalogValidationError, publishInstallationFormTemplate } from '@/lib/installations/catalog-service'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageInstallationCatalog(await installationViewerFromSession(session))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  try {
    return NextResponse.json(await publishInstallationFormTemplate(prisma, id, session.user.id))
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    throw error
  }
}
