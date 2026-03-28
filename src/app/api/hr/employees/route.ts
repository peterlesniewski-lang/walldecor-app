import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { employeeCreateSchema } from '@/lib/hr/schemas'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const divisionId = searchParams.get('divisionId')
  const departmentId = searchParams.get('departmentId')
  const status = searchParams.get('status')
  const employmentType = searchParams.get('employmentType')
  const search = searchParams.get('search')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = {}

  if (divisionId) where.divisionId = divisionId
  if (departmentId) where.departmentId = departmentId
  if (employmentType) where.employmentType = employmentType
  if (status === 'active') where.active = true
  if (status === 'inactive') where.active = false
  if (search) {
    // SQLite does not support mode:'insensitive' — use default (case-insensitive by default for ASCII in SQLite)
    where.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { email: { contains: search } },
    ]
  }

  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        division: true,
        department: true,
        team: true,
        positionRef: true,
        costCenter: true,
      },
    }),
    prisma.employee.count({ where }),
  ])

  return NextResponse.json({ employees, total, page, limit })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = employeeCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const employee = await prisma.employee.create({
    data: parsed.data,
    include: {
      division: true,
      department: true,
      team: true,
      positionRef: true,
      costCenter: true,
    },
  })

  return NextResponse.json(employee, { status: 201 })
}
