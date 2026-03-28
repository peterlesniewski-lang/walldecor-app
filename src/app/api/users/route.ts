import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const users = await prisma.user.findMany({
    include: {
      employee: {
        select: {
          firstName: true,
          lastName: true,
          position: true,
          divisionId: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(users)
}

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE']).default('EMPLOYEE'),
  employeeId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = createUserSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { email, name, role, employeeId } = parsed.data

  // Check email uniqueness
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'Email już istnieje w systemie.' }, { status: 409 })
  }

  // Check employeeId uniqueness if provided
  if (employeeId) {
    const empUser = await prisma.user.findUnique({ where: { employeeId } })
    if (empUser) {
      return NextResponse.json({ error: 'Ten pracownik ma już powiązane konto.' }, { status: 409 })
    }
  }

  const temporaryPassword = Math.random().toString(36).slice(-8)
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)

  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      passwordHash,
      isActive: true,
      ...(employeeId ? { employeeId } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ ...user, temporaryPassword }, { status: 201 })
}
