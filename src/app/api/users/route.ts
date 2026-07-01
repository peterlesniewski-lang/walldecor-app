import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { generateTemporaryPassword, normalizeUsername } from '@/lib/accounts/security'

const userSelect = {
  id: true,
  username: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  employeeId: true,
  createdAt: true,
  employee: {
    select: {
      firstName: true,
      lastName: true,
      position: true,
      divisionId: true,
    },
  },
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const users = await prisma.user.findMany({
    select: userSelect,
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(users)
}

const createUserSchema = z.object({
  username: z.string().min(2),
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
  const username = normalizeUsername(parsed.data.username)
  if (username.length < 2) {
    return NextResponse.json({ error: 'Login musi mieć co najmniej 2 znaki.' }, { status: 400 })
  }

  const existingUsername = await prisma.user.findUnique({ where: { username } })
  if (existingUsername) {
    return NextResponse.json({ error: 'Login już istnieje w systemie.' }, { status: 409 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'Email już istnieje w systemie.' }, { status: 409 })
  }

  if (employeeId) {
    const empUser = await prisma.user.findUnique({ where: { employeeId } })
    if (empUser) {
      return NextResponse.json({ error: 'Ten pracownik ma już powiązane konto.' }, { status: 409 })
    }
  }

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)

  const user = await prisma.user.create({
    data: {
      username,
      email,
      name,
      role,
      passwordHash,
      mustChangePassword: true,
      passwordChangedAt: null,
      isActive: true,
      ...(employeeId ? { employeeId } : {}),
    },
    select: userSelect,
  })

  return NextResponse.json({ ...user, temporaryPassword }, { status: 201 })
}
