import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessInstallationOrder, type InstallationOrderViewer } from '@/lib/installations/access'
import { INSTALLATION_ROLES, type InstallationRole } from '@/lib/installations/constants'
import { InstallationOrderValidationError } from '@/lib/installations/schemas'
import { createInstallationOrder, listInstallationOrders } from '@/lib/installations/order-service'

function viewerFromSession(session: { user: { role: string; employeeId?: string | null } }): InstallationOrderViewer {
  const role = INSTALLATION_ROLES.includes(session.user.role as InstallationRole)
    ? session.user.role as InstallationRole
    : 'EMPLOYEE'
  return { role, employeeId: session.user.employeeId }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const viewer = viewerFromSession(session)
  const orders = await listInstallationOrders(prisma)
  return NextResponse.json(orders.filter((order) => canAccessInstallationOrder(viewer, order)))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (viewerFromSession(session).role === 'INSTALLER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const order = await createInstallationOrder(prisma, body, session.user.id)
    return NextResponse.json(order, { status: 201 })
  } catch (error) {
    if (error instanceof InstallationOrderValidationError) {
      return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    }
    throw error
  }
}
