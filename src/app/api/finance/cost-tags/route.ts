import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { buildUniqueCostTagSlug, canCreateCustomCostTagInGroup, sortCostTagGroupsForDisplay } from '@/lib/finance/cost-tags'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const groups = await prisma.costTagGroup.findMany({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: {
      tags: {
        where: { active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true },
      },
    },
  })

  const sortedGroups = sortCostTagGroupsForDisplay(groups.map((group) => ({
    id: group.id,
    name: group.name,
    slug: group.slug,
    tags: group.tags,
  })))

  return NextResponse.json({
    groups: sortedGroups,
  })
}

function normalizeName(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const body = await req.json() as Record<string, unknown>
  const groupSlug = normalizeName(body.groupSlug)
  const name = normalizeName(body.name)

  if (!canCreateCustomCostTagInGroup(groupSlug)) {
    return NextResponse.json({ error: 'Tagi można dodawać tylko do grup Obszar i Typ wydatku.' }, { status: 400 })
  }
  if (name.length < 2) {
    return NextResponse.json({ error: 'Nazwa tagu musi mieć co najmniej 2 znaki.' }, { status: 400 })
  }

  const group = await prisma.costTagGroup.findUnique({ where: { slug: groupSlug } })
  if (!group) {
    return NextResponse.json({ error: 'Grupa tagów nie istnieje.' }, { status: 404 })
  }

  const existingTags = await prisma.costTag.findMany({ select: { slug: true } })
  const slug = buildUniqueCostTagSlug(name, existingTags.map((tag) => tag.slug))
  const tag = await prisma.costTag.create({
    data: {
      groupId: group.id,
      name,
      slug,
      active: true,
    },
    select: { id: true, name: true, slug: true },
  })

  return NextResponse.json({ tag }, { status: 201 })
}
