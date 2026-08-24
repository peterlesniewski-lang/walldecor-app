import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { isInstallationViewerAuthorized } from '@/lib/installations/access'
import { InstallationOrderValidationError } from '@/lib/installations/schemas'
import { createInstallationOrder, listInstallationOrders } from '@/lib/installations/order-service'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const viewer = await installationViewerFromSession(session)
  if (!isInstallationViewerAuthorized(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orders = await listInstallationOrders(prisma, { viewer })
  return NextResponse.json(orders)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const viewer = await installationViewerFromSession(session)
  if (!isInstallationViewerAuthorized(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (viewer.role === 'INSTALLER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json()
    if (!isPlainObject(body)) {
      return NextResponse.json({
        error: 'Dane zlecenia są niepoprawne.',
        fieldErrors: { form: 'Prześlij formularz zlecenia w poprawnym formacie.' },
      }, { status: 400 })
    }
    if (viewer.role === 'EMPLOYEE' && (
      viewer.employeeActive !== true ||
      !viewer.employeeId ||
      body.primaryEmployeeId !== viewer.employeeId
    )) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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
