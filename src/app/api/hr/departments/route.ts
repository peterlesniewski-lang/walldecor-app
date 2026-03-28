import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const departmentCreateSchema = z.object({
  name: z.string().min(1).max(100),
  divisionId: z.string().min(1),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const divisionId = searchParams.get('divisionId')

  const departments = await prisma.department.findMany({
    where: divisionId ? { divisionId } : undefined,
    orderBy: { name: 'asc' },
    include: {
      division: true,
      _count: { select: { employees: true } },
    },
  })

  return NextResponse.json(departments)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = departmentCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const department = await prisma.department.create({
    data: parsed.data,
    include: {
      division: true,
      _count: { select: { employees: true } },
    },
  })

  return NextResponse.json(department, { status: 201 })
}
