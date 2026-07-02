import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'

function normalizeName(value: unknown) {
  return typeof value === 'string' ? value.trim() : undefined
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  const body = await req.json() as Record<string, unknown>
  const name = normalizeName(body.name)
  const active = typeof body.active === 'boolean' ? body.active : undefined

  if (name != null && name.length < 2) {
    return NextResponse.json({ error: 'Nazwa obszaru musi mieć co najmniej 2 znaki.' }, { status: 400 })
  }
  if (name == null && active == null) {
    return NextResponse.json({ error: 'Brak danych do aktualizacji.' }, { status: 400 })
  }

  const existing = await prisma.costTag.findFirst({
    where: { id, group: { slug: 'area' } },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Obszar nie istnieje.' }, { status: 404 })
  }

  const tag = await prisma.costTag.update({
    where: { id },
    data: {
      ...(name != null ? { name } : {}),
      ...(active != null ? { active } : {}),
    },
  })

  return NextResponse.json({ tag })
}
