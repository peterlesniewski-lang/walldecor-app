import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const updateSchema = z.object({
  date: z.coerce.date().optional(),
  minutes: z.number().int().min(1).optional(),
  reason: z.string().min(1).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const existing = await prisma.overtimeRequest.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only own pending requests can be edited
  if (existing.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending requests can be edited' }, { status: 409 })
  }

  if (existing.employeeId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const request = await prisma.overtimeRequest.update({
    where: { id },
    data: parsed.data,
    include: {
      employee: {
        select: { id: true, firstName: true, lastName: true, position: true },
      },
    },
  })

  return NextResponse.json(request)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const existing = await prisma.overtimeRequest.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending requests can be deleted' }, { status: 409 })
  }

  if (existing.employeeId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.overtimeRequest.delete({ where: { id } })

  return NextResponse.json({ success: true })
}
