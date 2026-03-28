import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { employeeUpdateSchema } from '@/lib/hr/schemas'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      division: true,
      department: true,
      team: true,
      positionRef: true,
      costCenter: true,
      manager: { select: { id: true, firstName: true, lastName: true, email: true } },
      contracts: { orderBy: { startDate: 'desc' } },
      leaveBalancesNew: { include: { leaveType: true } },
    },
  })

  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(employee)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const parsed = employeeUpdateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const existing = await prisma.employee.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const employee = await prisma.employee.update({
    where: { id },
    data: parsed.data,
    include: {
      division: true,
      department: true,
      team: true,
      positionRef: true,
      costCenter: true,
    },
  })

  return NextResponse.json(employee)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const existing = await prisma.employee.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.employee.update({
    where: { id },
    data: { active: false },
  })

  return NextResponse.json({ success: true })
}
