import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageInstallationCatalog } from '@/lib/installations/access'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import {
  InstallationCatalogValidationError,
  reorderCatalogCategories,
  reorderCatalogProducts,
  reorderCatalogTypes,
} from '@/lib/installations/catalog-service'

type Params = { params: Promise<{ kind: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageInstallationCatalog(await installationViewerFromSession(session))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { kind } = await params
  try {
    const body = await req.json() as { orderedIds?: unknown; parentId?: unknown }
    if (!Array.isArray(body.orderedIds) || body.orderedIds.some((id) => typeof id !== 'string')) return NextResponse.json({ error: 'orderedIds musi być listą ID.' }, { status: 400 })
    if (kind === 'category') await reorderCatalogCategories(prisma, body.orderedIds)
    else if (kind === 'type' && typeof body.parentId === 'string') await reorderCatalogTypes(prisma, body.parentId, body.orderedIds)
    else if (kind === 'product' && typeof body.parentId === 'string') await reorderCatalogProducts(prisma, body.parentId, body.orderedIds)
    else return NextResponse.json({ error: 'Nieprawidłowy rodzaj lub rodzic kolejności.' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}
