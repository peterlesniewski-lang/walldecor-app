import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const divisionUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  costCenterId: z.string().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const parsed = divisionUpdateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const division = await prisma.division.update({
    where: { id },
    data: parsed.data,
  })

  return NextResponse.json(division)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const employeeCount = await prisma.employee.count({ where: { divisionId: id } })
  if (employeeCount > 0) {
    return NextResponse.json(
      { error: 'Cannot delete division with employees', count: employeeCount },
      { status: 409 }
    )
  }

  await prisma.division.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
