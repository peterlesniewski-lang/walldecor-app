import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calculatePaymentAgingBucket, type PaymentAgingBucket } from '@/lib/finance/cost-control'
import { findMatchingSupplierRule, normalizeSupplierNip, roundMoney } from '@/lib/finance/ksef-inbox'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { KsefInvoiceCreateSchema, KsefInvoiceQuerySchema } from '@/lib/validations/ksef-inbox'
import type { Prisma } from '@/generated/prisma'

const PAYMENT_AGING_BUCKETS: PaymentAgingBucket[] = [
  'OVERDUE',
  'DUE_0_7',
  'DUE_8_14',
  'DUE_15_30',
  'LATER',
  'MISSING_DUE_DATE',
]

function emptyPaymentAging() {
  return Object.fromEntries(
    PAYMENT_AGING_BUCKETS.map((bucket) => [bucket, { count: 0, grossAmount: 0 }])
  ) as Record<PaymentAgingBucket, { count: number; grossAmount: number }>
}

function reportingGrossAmount(invoice: { grossAmount: number; reportingGrossAmount?: number | null }) {
  return roundMoney(invoice.reportingGrossAmount ?? invoice.grossAmount)
}

export async function GET(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefInvoiceQuerySchema.safeParse({
    status: req.nextUrl.searchParams.get('status') || undefined,
    paymentStatus: req.nextUrl.searchParams.get('paymentStatus') || undefined,
    paymentDeadline: req.nextUrl.searchParams.get('paymentDeadline') || undefined,
    documentStatus: req.nextUrl.searchParams.get('documentStatus') || undefined,
    ruleMatchStatus: req.nextUrl.searchParams.get('ruleMatchStatus') || undefined,
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
  if (parsed.data.paymentStatus) filters.push({ paymentStatus: parsed.data.paymentStatus })
  if (parsed.data.documentStatus) filters.push({ documentStatus: parsed.data.documentStatus })
  if (parsed.data.ruleMatchStatus) filters.push({ ruleMatchStatus: parsed.data.ruleMatchStatus })
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
  if (parsed.data.paymentDeadline && !parsed.data.paymentStatus) {
    filters.push({ paymentStatus: 'UNPAID' })
  }

  if (parsed.data.paymentDeadline) {
    const candidateWhere: Prisma.KsefInvoiceWhereInput | undefined = filters.length > 0 ? { AND: filters } : undefined
    const candidates = await prisma.ksefInvoice.findMany({
      where: candidateWhere,
      select: { id: true, dueDate: true },
    })
    filters.push({
      id: {
        in: candidates
          .filter((invoice) => calculatePaymentAgingBucket(invoice.dueDate) === parsed.data.paymentDeadline)
          .map((invoice) => invoice.id),
      },
    })
  }

  const where: Prisma.KsefInvoiceWhereInput | undefined = filters.length > 0 ? { AND: filters } : undefined
  const skip = (parsed.data.page - 1) * parsed.data.pageSize
  const [invoices, total, amountRows, statusCounts] = await Promise.all([
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
    prisma.ksefInvoice.findMany({
      where,
      select: {
        grossAmount: true,
        reportingGrossAmount: true,
        paymentStatus: true,
        dueDate: true,
      },
    }),
    prisma.ksefInvoice.groupBy({ by: ['status'], _count: { _all: true } }),
  ])
  const counts = { NEW: 0, MAPPED: 0, APPROVED: 0, IGNORED: 0 }
  for (const row of statusCounts) {
    counts[row.status as keyof typeof counts] = row._count._all
  }
  const paymentAging = emptyPaymentAging()
  let grossAmountTotal = 0
  let unpaidAmountTotal = 0
  for (const invoice of amountRows) {
    const amount = reportingGrossAmount(invoice)
    grossAmountTotal = roundMoney(grossAmountTotal + amount)
    if (invoice.paymentStatus !== 'PAID') {
      unpaidAmountTotal = roundMoney(unpaidAmountTotal + amount)
      const bucket = calculatePaymentAgingBucket(invoice.dueDate)
      paymentAging[bucket].count += 1
      paymentAging[bucket].grossAmount = roundMoney(paymentAging[bucket].grossAmount + amount)
    }
  }

  return NextResponse.json({
    invoices,
    total,
    grossAmountTotal,
    unpaidAmountTotal,
    paymentAging,
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
