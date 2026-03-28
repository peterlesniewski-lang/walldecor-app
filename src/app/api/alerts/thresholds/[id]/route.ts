import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { budgetThresholdPatchSchema } from '@/lib/validations/alerts'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const existing = await prisma.budgetThreshold.findUnique({
    where: { id: params.id },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = budgetThresholdPatchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const data = parsed.data

  // Cross-field validation when only one side is provided
  const newWarning = data.warningPercent ?? existing.warningPercent
  const newCritical = data.criticalPercent ?? existing.criticalPercent
  if (newWarning >= newCritical) {
    return NextResponse.json(
      { error: 'warningPercent must be less than criticalPercent' },
      { status: 400 }
    )
  }

  const threshold = await prisma.budgetThreshold.update({
    where: { id: params.id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.warningPercent !== undefined && { warningPercent: data.warningPercent }),
      ...(data.criticalPercent !== undefined && { criticalPercent: data.criticalPercent }),
      ...('costCenterId' in data && { costCenterId: data.costCenterId ?? null }),
      ...('subCategoryId' in data && { subCategoryId: data.subCategoryId ?? null }),
      ...(data.active !== undefined && { active: data.active }),
    },
    include: {
      costCenter: true,
      subCategory: true,
    },
  })

  return NextResponse.json(threshold)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const existing = await prisma.budgetThreshold.findUnique({
    where: { id: params.id },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.budgetThreshold.delete({ where: { id: params.id } })

  return NextResponse.json({ success: true })
}
