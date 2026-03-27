import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const RenameSchema = z.object({
  name: z.string().min(1).max(100).trim(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Brak dostępu' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = RenameSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const category = await prisma.accountCategory.update({
    where: { id },
    data: { name: parsed.data.name },
  })

  return NextResponse.json(category)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Brak dostępu' }, { status: 403 })
  }

  const { id } = await params

  const subcategories = await prisma.subCategory.findMany({
    where: { categoryId: id },
    select: { id: true },
  })

  if (subcategories.length > 0) {
    const subIds = subcategories.map((s) => s.id)

    const [budgetCount, actualCount] = await Promise.all([
      prisma.budgetEntry.count({ where: { subCategoryId: { in: subIds } } }),
      prisma.actualEntry.count({ where: { subCategoryId: { in: subIds } } }),
    ])

    if (budgetCount > 0 || actualCount > 0) {
      const total = budgetCount + actualCount
      return NextResponse.json(
        { error: `Nie można usunąć — kategoria zawiera podkategorie z ${total} wpis(ami) w budżecie/wykonaniu.` },
        { status: 409 }
      )
    }

    await prisma.subCategory.deleteMany({ where: { categoryId: id } })
  }

  await prisma.accountCategory.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
