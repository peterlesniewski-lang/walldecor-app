import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createRunItemInputs, createRunName } from '@/lib/operations/run-factory'
import { getRuns } from '@/lib/operations/queries'
import { CreateChecklistRunSchema } from '@/lib/validations/operations'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const runs = await getRuns()
  return NextResponse.json(runs)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = CreateChecklistRunSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const template = await prisma.checklistTemplate.findUnique({
    where: { id: parsed.data.templateId },
    include: { items: { orderBy: { order: 'asc' } } },
  })

  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  let itemInputs: ReturnType<typeof createRunItemInputs>
  try {
    itemInputs = createRunItemInputs(template.items)
  } catch (error) {
    if (error instanceof Error && error.message === 'EMPTY_TEMPLATE') {
      return NextResponse.json({ error: 'Template has no items' }, { status: 400 })
    }
    throw error
  }

  const name = parsed.data.name ?? createRunName(template.name, parsed.data.periodYear, parsed.data.periodMonth ?? null)

  const run = await prisma.checklistRun.create({
    data: {
      templateId: template.id,
      name,
      periodYear: parsed.data.periodYear,
      periodMonth: parsed.data.periodMonth,
      createdById: session.user.id,
      items: {
        create: itemInputs,
      },
    },
    include: {
      template: { include: { module: { include: { area: true } } } },
      items: { orderBy: { order: 'asc' } },
    },
  })

  return NextResponse.json(run, { status: 201 })
}
