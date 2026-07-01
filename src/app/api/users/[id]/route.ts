import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { normalizeUsername } from '@/lib/accounts/security'

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

const patchUserSchema = z.object({
  username: z.string().min(2).optional(),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE']).optional(),
  name: z.string().min(1).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = patchUserSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = await params
  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const data = { ...parsed.data }
  if (data.username) {
    data.username = normalizeUsername(data.username)
    if (data.username.length < 2) {
      return NextResponse.json({ error: 'Login musi mieć co najmniej 2 znaki.' }, { status: 400 })
    }
    const usernameOwner = await prisma.user.findUnique({ where: { username: data.username } })
    if (usernameOwner && usernameOwner.id !== id) {
      return NextResponse.json({ error: 'Login już istnieje w systemie.' }, { status: 409 })
    }
  }

  if (data.email) {
    const emailOwner = await prisma.user.findUnique({ where: { email: data.email } })
    if (emailOwner && emailOwner.id !== id) {
      return NextResponse.json({ error: 'Email już istnieje w systemie.' }, { status: 409 })
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: userSelect,
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  // Prevent self-deletion
  if (session.user.id === id) {
    return NextResponse.json({ error: 'Nie możesz usunąć własnego konta.' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (existing.employeeId) {
    return NextResponse.json({ error: 'Nie można usunąć konta powiązanego z pracownikiem.' }, { status: 400 })
  }

  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
