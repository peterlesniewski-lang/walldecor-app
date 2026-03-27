import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const RenameSchema = z.object({
  name: z.string().min(1).max(100).trim(),
})

const ALLOWED_ROLES = ['ADMIN', 'MANAGER']

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const parsed = RenameSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
  }

  const sub = await prisma.subCategory.update({
    where: { id },
    data: { name: parsed.data.name },
  })

  return NextResponse.json(sub)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const [budgetCount, actualCount] = await Promise.all([
    prisma.budgetEntry.count({ where: { subCategoryId: id } }),
    prisma.actualEntry.count({ where: { subCategoryId: id } }),
  ])

  if (budgetCount + actualCount > 0) {
    return NextResponse.json(
      { error: `Nie można usunąć — podkategoria ma ${budgetCount + actualCount} wpis(ów) w budżecie/wykonaniu.` },
      { status: 409 }
    )
  }

  await prisma.subCategory.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
