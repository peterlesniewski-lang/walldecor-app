import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ReorderSchema = z.object({
  items: z.array(z.object({ id: z.string(), order: z.number().int().min(0) })).min(1),
})

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = ReorderSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  await Promise.all(
    parsed.data.items.map(({ id, order }) =>
      prisma.subCategory.update({ where: { id }, data: { order } })
    )
  )

  return NextResponse.json({ updated: parsed.data.items.length })
}
