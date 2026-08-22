import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageInstallationCatalog, type InstallationOrderViewer } from '@/lib/installations/access'
import { INSTALLATION_ROLES, type InstallationRole } from '@/lib/installations/constants'
import {
  createCatalogCategory,
  createCatalogProduct,
  createCatalogType,
  InstallationCatalogValidationError,
  listInstallationCatalog,
} from '@/lib/installations/catalog-service'

async function viewerFromSession(session: { user: { role: string; employeeId?: string | null } }): Promise<InstallationOrderViewer> {
  const role = INSTALLATION_ROLES.includes(session.user.role as InstallationRole) ? session.user.role as InstallationRole : 'EMPLOYEE'
  if (role !== 'EMPLOYEE') return { role, employeeId: session.user.employeeId }
  if (!session.user.employeeId) return { role, employeeId: null, employeeActive: false }
  const employee = await prisma.employee.findUnique({ where: { id: session.user.employeeId }, select: { active: true } })
  return { role, employeeId: session.user.employeeId, employeeActive: employee?.active === true }
}

function bodyWithoutKind(body: Record<string, unknown>) {
  const { kind: _kind, ...input } = body
  return input
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function GET(req?: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const viewer = await viewerFromSession(session)
  const includeInactive = req?.nextUrl.searchParams.get('includeInactive') === 'true'
  if (includeInactive && !canManageInstallationCatalog(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(await listInstallationCatalog(prisma, { includeInactive }))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const viewer = await viewerFromSession(session)
  if (!canManageInstallationCatalog(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await req.json()
    if (!isRecord(body)) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    const input = bodyWithoutKind(body)
    const entity = body.kind === 'category'
      ? await createCatalogCategory(prisma, input)
      : body.kind === 'type'
        ? await createCatalogType(prisma, input)
        : body.kind === 'product'
          ? await createCatalogProduct(prisma, input)
          : null
    if (!entity) return NextResponse.json({ error: 'Wskaż category, type albo product.' }, { status: 400 })
    return NextResponse.json(entity, { status: 201 })
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}
