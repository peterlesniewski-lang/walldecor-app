import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const rejectSchema = z.object({
  rejectionNote: z.string().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const existing = await prisma.overtimeRequest.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending requests can be rejected' }, { status: 409 })
  }

  const parsed = rejectSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const request = await prisma.overtimeRequest.update({
    where: { id },
    data: {
      status: 'rejected',
      rejectionNote: parsed.data.rejectionNote,
    },
    include: {
      employee: {
        select: { id: true, firstName: true, lastName: true, position: true },
      },
    },
  })

  return NextResponse.json(request)
}
