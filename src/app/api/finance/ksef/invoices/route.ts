import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findMatchingSupplierRule, normalizeSupplierNip, roundMoney } from '@/lib/finance/ksef-inbox'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { KsefInvoiceCreateSchema, KsefInvoiceQuerySchema } from '@/lib/validations/ksef-inbox'
import type { Prisma } from '@/generated/prisma'

export async function GET(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefInvoiceQuerySchema.safeParse({
    status: req.nextUrl.searchParams.get('status') || undefined,
    page: req.nextUrl.searchParams.get('page') || undefined,
    pageSize: req.nextUrl.searchParams.get('pageSize') || undefined,
    search: req.nextUrl.searchParams.get('search') || undefined,
    amountMin: req.nextUrl.searchParams.get('amountMin') || undefined,
    amountMax: req.nextUrl.searchParams.get('amountMax') || undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, { status: 400 })
  }

  const filters: Prisma.KsefInvoiceWhereInput[] = []
  if (parsed.data.status) filters.push({ status: parsed.data.status })
  if (parsed.data.search) {
    const normalizedNip = normalizeSupplierNip(parsed.data.search)
    filters.push({
      OR: [
        { supplierName: { contains: parsed.data.search } },
        ...(normalizedNip ? [{ supplierNip: { contains: normalizedNip } }] : []),
      ],
    })
  }
  if (parsed.data.amountMin != null || parsed.data.amountMax != null) {
    filters.push({
      grossAmount: {
        ...(parsed.data.amountMin != null ? { gte: parsed.data.amountMin } : {}),
        ...(parsed.data.amountMax != null ? { lte: parsed.data.amountMax } : {}),
      },
    })
  }

  const where: Prisma.KsefInvoiceWhereInput | undefined = filters.length > 0 ? { AND: filters } : undefined
  const skip = (parsed.data.page - 1) * parsed.data.pageSize
  const [invoices, total, grossAmountAggregate, statusCounts] = await Promise.all([
    prisma.ksefInvoice.findMany({
      where,
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
        supplierRule: true,
      },
      orderBy: [{ status: 'asc' }, { issueDate: 'desc' }, { invoiceNumber: 'asc' }],
      skip,
      take: parsed.data.pageSize,
    }),
    prisma.ksefInvoice.count({ where }),
    prisma.ksefInvoice.aggregate({ where, _sum: { grossAmount: true } }),
    prisma.ksefInvoice.groupBy({ by: ['status'], _count: { _all: true } }),
  ])
  const counts = { NEW: 0, MAPPED: 0, APPROVED: 0, IGNORED: 0 }
  for (const row of statusCounts) {
    counts[row.status as keyof typeof counts] = row._count._all
  }

  return NextResponse.json({
    invoices,
    total,
    grossAmountTotal: roundMoney(grossAmountAggregate._sum.grossAmount ?? 0),
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
    counts,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefInvoiceCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const rules = await prisma.ksefSupplierRule.findMany({ where: { active: true } })
  const match = findMatchingSupplierRule(
    { supplierName: data.supplierName, supplierNip: data.supplierNip },
    rules
  )

  const invoice = await prisma.ksefInvoice.create({
    data: {
      source: 'MANUAL',
      supplierName: data.supplierName,
      supplierNip: data.supplierNip || null,
      invoiceNumber: data.invoiceNumber,
      issueDate: new Date(`${data.issueDate}T00:00:00.000Z`),
      grossAmount: roundMoney(data.grossAmount),
      netAmount: data.netAmount == null ? null : roundMoney(data.netAmount),
      vatAmount: data.vatAmount == null ? null : roundMoney(data.vatAmount),
      currency: data.currency,
      notes: data.notes || null,
      status: match ? 'MAPPED' : 'NEW',
      costCenterId: match?.costCenterId ?? null,
      subCategoryId: match?.subCategoryId ?? null,
      supplierRuleId: match?.id ?? null,
    },
    include: {
      costCenter: true,
      subCategory: { include: { category: true } },
      supplierRule: true,
    },
  })

  return NextResponse.json(invoice, { status: 201 })
}
