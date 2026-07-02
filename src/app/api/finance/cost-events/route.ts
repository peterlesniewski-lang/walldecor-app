import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin, requireFinanceReportAccess } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/finance/ksef-inbox'
import type { Prisma } from '@/generated/prisma'

export async function GET(req: NextRequest) {
  const auth = await requireFinanceReportAccess()
  if (auth.error) return auth.error

  const search = req.nextUrl.searchParams.get('search')?.trim()
  const dateFrom = req.nextUrl.searchParams.get('dateFrom')
  const dateTo = req.nextUrl.searchParams.get('dateTo')
  const source = req.nextUrl.searchParams.get('source')?.trim()
  const costCenterId = req.nextUrl.searchParams.get('costCenterId')?.trim()
  const tagId = req.nextUrl.searchParams.get('tagId')?.trim()

  const where: Prisma.CostEventWhereInput = {
    status: 'APPROVED',
    ...(auth.session.user.role !== 'ADMIN' ? { isConfidential: false } : {}),
    ...(source ? { source } : {}),
    ...(dateFrom || dateTo ? {
      eventDate: {
        ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
      },
    } : {}),
    ...(search ? {
      OR: [
        { supplierName: { contains: search } },
        { supplierNip: { contains: search.replace(/\D/g, '') || search } },
        { reference: { contains: search } },
      ],
    } : {}),
    ...(costCenterId || tagId ? {
      parts: {
        some: {
          ...(costCenterId ? { allocations: { some: { costCenterId } } } : {}),
          ...(tagId ? { tags: { some: { tagId } } } : {}),
        },
      },
    } : {}),
  }

  const events = await prisma.costEvent.findMany({
    where,
    include: {
      parts: {
        include: {
          tags: { include: { tag: true } },
          allocations: true,
        },
        orderBy: { order: 'asc' },
      },
    },
    orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  })
  const totalGrossAmount = roundMoney(events.reduce((sum, event) => sum + event.grossAmount, 0))

  return NextResponse.json({ events, totalGrossAmount })
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const body = await req.json() as Record<string, unknown>
  const grossAmount = roundMoney(Number(body.grossAmount))
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
    return NextResponse.json({ error: 'Kwota brutto musi być większa od zera.' }, { status: 400 })
  }

  const costCenterId = typeof body.costCenterId === 'string' ? body.costCenterId : 'GLOBAL'
  const tagIds = Array.isArray(body.tagIds) ? body.tagIds.filter((tagId): tagId is string => typeof tagId === 'string') : []
  const event = await prisma.costEvent.create({
    data: {
      source: 'MANUAL',
      eventDate: body.eventDate ? new Date(`${body.eventDate}T00:00:00.000Z`) : new Date(),
      supplierName: typeof body.supplierName === 'string' ? body.supplierName : null,
      supplierNip: typeof body.supplierNip === 'string' ? body.supplierNip.replace(/\D/g, '') || null : null,
      reference: typeof body.reference === 'string' ? body.reference : null,
      grossAmount,
      netAmount: body.netAmount == null || body.netAmount === '' ? null : roundMoney(Number(body.netAmount)),
      vatAmount: body.vatAmount == null || body.vatAmount === '' ? null : roundMoney(Number(body.vatAmount)),
      currency: 'PLN',
      isConfidential: Boolean(body.isConfidential),
      createdById: auth.session.user.id,
      parts: {
        create: [{
          label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Koszt ręczny',
          grossAmount,
          order: 0,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
          allocations: { create: [{ costCenterId, percent: 100, fallbackUsed: false }] },
        }],
      },
      auditLogs: {
        create: {
          action: 'cost_event.manual.create',
          actorId: auth.session.user.id,
          afterJson: JSON.stringify(body),
        },
      },
    },
    include: {
      parts: {
        include: {
          tags: { include: { tag: true } },
          allocations: true,
        },
        orderBy: { order: 'asc' },
      },
    },
  })

  return NextResponse.json({ event }, { status: 201 })
}
