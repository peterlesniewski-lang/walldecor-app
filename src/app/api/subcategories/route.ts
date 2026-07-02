import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const CreateSchema = z.object({
  categoryId: z.string().cuid(),
  name: z.string().min(1).max(100).trim(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = CreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid data', details: parsed.error.flatten() }, { status: 400 })
  }

  const { categoryId, name } = parsed.data

  const maxOrder = await prisma.subCategory.aggregate({
    where: { categoryId },
    _max: { order: true },
  })

  const sub = await prisma.subCategory.create({
    data: { name, categoryId, order: (maxOrder._max.order ?? 0) + 1 },
  })

  return NextResponse.json(sub, { status: 201 })
}
