import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const positionUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const parsed = positionUpdateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const position = await prisma.position.update({
    where: { id },
    data: parsed.data,
  })

  return NextResponse.json(position)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const employeeCount = await prisma.employee.count({ where: { positionId: id } })
  if (employeeCount > 0) {
    return NextResponse.json(
      { error: 'Cannot delete position with employees', count: employeeCount },
      { status: 409 }
    )
  }

  await prisma.position.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
