import { NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
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

  return NextResponse.json({
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      slug: group.slug,
      tags: group.tags,
    })),
  })
}
