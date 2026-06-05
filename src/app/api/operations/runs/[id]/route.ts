import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRun } from '@/lib/operations/queries'
import { createRunName } from '@/lib/operations/run-factory'
import { UpdateChecklistRunSchema } from '@/lib/validations/operations'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const run = await getRun(id)
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({
      ...run,
      items: run.items.filter((item) => item.ownerId === session.user.id),
    })
  }

  return NextResponse.json(run)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const parsed = UpdateChecklistRunSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const existing = await prisma.checklistRun.findUnique({
    where: { id },
    include: { template: { select: { name: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const periodYear = parsed.data.periodYear ?? existing.periodYear
  const periodMonth = parsed.data.periodMonth === undefined ? existing.periodMonth : parsed.data.periodMonth
  const periodChanged = parsed.data.periodYear !== undefined || parsed.data.periodMonth !== undefined
  const name = parsed.data.name ?? (periodChanged ? createRunName(existing.template.name, periodYear, periodMonth) : undefined)

  const run = await prisma.checklistRun.update({
    where: { id },
    data: {
      name,
      periodYear: parsed.data.periodYear,
      periodMonth: parsed.data.periodMonth,
      status: parsed.data.status,
    },
  })

  return NextResponse.json(run)
}
