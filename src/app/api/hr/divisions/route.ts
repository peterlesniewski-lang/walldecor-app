import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const divisionCreateSchema = z.object({
  name: z.string().min(1).max(100),
  costCenterId: z.string().optional(),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const divisions = await prisma.division.findMany({
    orderBy: { name: 'asc' },
    include: {
      departments: {
        include: {
          _count: { select: { employees: true } },
        },
      },
      _count: { select: { employees: true } },
    },
  })

  return NextResponse.json(divisions)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = divisionCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const division = await prisma.division.create({
    data: parsed.data,
    include: {
      _count: { select: { employees: true } },
    },
  })

  return NextResponse.json(division, { status: 201 })
}
