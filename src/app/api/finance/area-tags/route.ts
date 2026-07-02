import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { buildUniqueAreaTagSlug } from '@/lib/finance/cost-tags'
import { prisma } from '@/lib/prisma'

function normalizeName(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const body = await req.json() as Record<string, unknown>
  const name = normalizeName(body.name)
  if (name.length < 2) {
    return NextResponse.json({ error: 'Nazwa obszaru musi mieć co najmniej 2 znaki.' }, { status: 400 })
  }

  const areaGroup = await prisma.costTagGroup.findUnique({ where: { slug: 'area' } })
  if (!areaGroup) {
    return NextResponse.json({ error: 'Brak grupy tagów Obszar.' }, { status: 500 })
  }

  const existingTags = await prisma.costTag.findMany({ select: { slug: true } })
  const slug = buildUniqueAreaTagSlug(name, existingTags.map((tag) => tag.slug))
  const tag = await prisma.costTag.create({
    data: {
      groupId: areaGroup.id,
      name,
      slug,
      active: true,
    },
  })

  return NextResponse.json({ tag }, { status: 201 })
}
