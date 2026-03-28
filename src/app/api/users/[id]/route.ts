import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const patchUserSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE']).optional(),
  name: z.string().min(1).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = patchUserSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = params
  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const updated = await prisma.user.update({
    where: { id },
    data: parsed.data,
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
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = params

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
