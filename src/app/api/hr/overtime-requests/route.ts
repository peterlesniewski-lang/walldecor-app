import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { overtimeRequestSchema } from '@/lib/hr/schemas'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const role = session.user.role
  const isAdminOrManager = role === 'ADMIN' || role === 'MANAGER'

  // EMPLOYEE can only see their own requests
  const employeeIdParam = searchParams.get('employeeId')
  const statusParam = searchParams.get('status')
  const monthParam = searchParams.get('month') // "YYYY-MM"

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}

  if (!isAdminOrManager) {
    // Force filter to own employeeId
    if (!session.user.employeeId) {
      return NextResponse.json({ requests: [] })
    }
    where.employeeId = session.user.employeeId
  } else {
    if (employeeIdParam) where.employeeId = employeeIdParam
  }

  if (statusParam) where.status = statusParam

  if (monthParam) {
    const [year, month] = monthParam.split('-').map(Number)
    if (!isNaN(year) && !isNaN(month)) {
      const start = new Date(year, month - 1, 1, 0, 0, 0, 0)
      const end = new Date(year, month, 0, 23, 59, 59, 999)
      where.date = { gte: start, lte: end }
    }
  }

  const requests = await prisma.overtimeRequest.findMany({
    where,
    orderBy: { date: 'desc' },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          position: true,
        },
      },
    },
  })

  return NextResponse.json(requests)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = overtimeRequestSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { employeeId, date, minutes, reason } = parsed.data

  // EMPLOYEE can only submit for themselves
  const role = session.user.role
  if (role === 'EMPLOYEE') {
    if (session.user.employeeId !== employeeId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Verify employee exists
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  const request = await prisma.overtimeRequest.create({
    data: {
      employeeId,
      date,
      minutes,
      reason,
      status: 'pending',
    },
    include: {
      employee: {
        select: { id: true, firstName: true, lastName: true, position: true },
      },
    },
  })

  return NextResponse.json(request, { status: 201 })
}
