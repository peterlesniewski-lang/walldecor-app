import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessInstallationOrder, type InstallationOrderViewer } from '@/lib/installations/access'
import { INSTALLATION_ROLES, type InstallationRole } from '@/lib/installations/constants'
import { InstallationOrderValidationError } from '@/lib/installations/schemas'
import {
  archiveInstallationOrder,
  getInstallationOrder,
  InstallationOrderNotFoundError,
  updateInstallationOrder,
} from '@/lib/installations/order-service'

type Params = { params: Promise<{ id: string }> }

function viewerFromSession(session: { user: { role: string; employeeId?: string | null } }): InstallationOrderViewer {
  const role = INSTALLATION_ROLES.includes(session.user.role as InstallationRole)
    ? session.user.role as InstallationRole
    : 'EMPLOYEE'
  return { role, employeeId: session.user.employeeId }
}

async function loadAccessibleOrder(id: string, viewer: InstallationOrderViewer) {
  const order = await getInstallationOrder(prisma, id)
  if (!order) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (!canAccessInstallationOrder(viewer, order)) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { order }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const loaded = await loadAccessibleOrder(id, viewerFromSession(session))
  if ('response' in loaded) return loaded.response
  return NextResponse.json(loaded.order)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const loaded = await loadAccessibleOrder(id, viewerFromSession(session))
  if ('response' in loaded) return loaded.response
  if (viewerFromSession(session).role === 'INSTALLER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const order = await updateInstallationOrder(prisma, id, await req.json(), session.user.id)
    return NextResponse.json(order)
  } catch (error) {
    if (error instanceof InstallationOrderValidationError) {
      return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    }
    if (error instanceof InstallationOrderNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    }
    throw error
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const loaded = await loadAccessibleOrder(id, viewerFromSession(session))
  if ('response' in loaded) return loaded.response
  if (viewerFromSession(session).role === 'INSTALLER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const order = await archiveInstallationOrder(prisma, id, session.user.id)
    return NextResponse.json(order)
  } catch (error) {
    if (error instanceof InstallationOrderNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw error
  }
}
