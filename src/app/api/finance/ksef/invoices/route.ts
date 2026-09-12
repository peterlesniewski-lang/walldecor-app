import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calculatePaymentAgingBucket, type PaymentAgingBucket } from '@/lib/finance/cost-control'
import { normalizeSupplierNip, resolveSupplierRuleMatch, roundMoney } from '@/lib/finance/ksef-inbox'
import { summarizeInvoicePayments } from '@/lib/finance/invoice-money'
import { isActiveInvoiceMoneyRow } from '@/lib/finance/invoice-money-scope'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { withAiQueueMutation } from '@/lib/ai/queue'
import { findExistingInvoiceDuplicate, invoiceDuplicateBody } from '@/lib/invoice-import/duplicate-lookup'
import { INVOICE_IMPORT_LIST_SELECT, invoiceImportListSummary } from '@/lib/invoice-import/invoice-list-ksef-summary'
import {
  KsefInvoiceCreateSchema,
  KsefInvoiceQuerySchema,
  type KsefInvoiceSortBy,
  type KsefInvoiceSortDir,
} from '@/lib/validations/ksef-inbox'
import type { Prisma } from '@/generated/prisma'

const PAYMENT_AGING_BUCKETS: PaymentAgingBucket[] = [
  'OVERDUE',
  'DUE_0_7',
  'DUE_8_14',
  'DUE_15_30',
  'LATER',
  'MISSING_DUE_DATE',
]

function invoiceOrderBy(
  sortBy: KsefInvoiceSortBy,
  sortDir: KsefInvoiceSortDir
): Prisma.KsefInvoiceOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'invoiceNumber':
      return [{ invoiceNumber: sortDir }, { issueDate: 'desc' }]
    case 'supplierName':
      return [{ supplierName: sortDir }, { issueDate: 'desc' }, { invoiceNumber: 'asc' }]
    case 'grossAmount':
      return [{ grossAmount: sortDir }, { issueDate: 'desc' }, { invoiceNumber: 'asc' }]
    case 'status':
      return [{ status: sortDir }, { issueDate: 'desc' }, { invoiceNumber: 'asc' }]
    case 'paymentStatus':
      return [{ paymentStatus: sortDir }, { issueDate: 'desc' }, { invoiceNumber: 'asc' }]
    case 'dueDate':
      return [{ dueDate: sortDir }, { issueDate: 'desc' }, { invoiceNumber: 'asc' }]
    case 'costCenterId':
      return [{ costCenterId: sortDir }, { issueDate: 'desc' }, { invoiceNumber: 'asc' }]
    case 'issueDate':
    default:
      return [{ issueDate: sortDir }, { invoiceNumber: 'asc' }, { status: 'asc' }]
  }
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
    issueDateFrom: req.nextUrl.searchParams.get('issueDateFrom') || undefined,
    issueDateTo: req.nextUrl.searchParams.get('issueDateTo') || undefined,
    sortBy: req.nextUrl.searchParams.get('sortBy') || undefined,
    sortDir: req.nextUrl.searchParams.get('sortDir') || undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, { status: 400 })
  }

  const filters: Prisma.KsefInvoiceWhereInput[] = []
  if (parsed.data.status) filters.push({ status: parsed.data.status })
  if (parsed.data.paymentStatus) filters.push({ paymentStatus: parsed.data.paymentStatus })
  if (parsed.data.documentStatus) filters.push({ documentStatus: parsed.data.documentStatus })
  if (parsed.data.ruleMatchStatus) filters.push({ ruleMatchStatus: parsed.data.ruleMatchStatus })
  if (parsed.data.issueDateFrom || parsed.data.issueDateTo) {
    // issueDate is the invoice's date-only value, stored as UTC by import/manual entry.
    filters.push({ issueDate: {
      ...(parsed.data.issueDateFrom ? { gte: new Date(`${parsed.data.issueDateFrom}T00:00:00.000Z`) } : {}),
      ...(parsed.data.issueDateTo ? { lte: new Date(`${parsed.data.issueDateTo}T23:59:59.999Z`) } : {}),
    } })
  }
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
    filters.push({ paymentStatus: { not: 'PAID' } })
  }

  if (parsed.data.paymentDeadline) {
    const candidateWhere: Prisma.KsefInvoiceWhereInput | undefined = filters.length > 0 ? { AND: [...filters] } : undefined
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
        invoiceImportDraft: { select: INVOICE_IMPORT_LIST_SELECT },
        costCenter: true,
        subCategory: { include: { category: true } },
        supplierRule: true,
        parts: {
          include: {
            tags: { include: { tag: true } },
            allocations: true,
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: invoiceOrderBy(parsed.data.sortBy, parsed.data.sortDir),
      skip,
      take: parsed.data.pageSize,
    }),
    prisma.ksefInvoice.count({ where }),
    prisma.ksefInvoice.findMany({
      where,
      select: {
        currency: true,
        grossAmount: true,
        reportingGrossAmount: true,
        paymentStatus: true,
        dueDate: true,
        documentStatus: true,
        invoiceImportDraft: { select: { state: true } },
      },
    }),
    prisma.ksefInvoice.groupBy({ by: ['status'], _count: { _all: true } }),
  ])
  const counts = { NEW: 0, MAPPED: 0, APPROVED: 0, IGNORED: 0 }
  for (const row of statusCounts) {
    counts[row.status as keyof typeof counts] = row._count._all
  }
  const paymentSummary = summarizeInvoicePayments(amountRows.filter(isActiveInvoiceMoneyRow))
  const paymentAging = Object.fromEntries(PAYMENT_AGING_BUCKETS.map((bucket) => [bucket, {
    ...paymentSummary.paymentAging[bucket],
    grossAmount: paymentSummary.paymentAging[bucket].plnAmount,
  }])) as Record<PaymentAgingBucket, typeof paymentSummary.paymentAging[PaymentAgingBucket] & { grossAmount: number }>

  return NextResponse.json({
    invoices: invoices.map((invoice) => ({ ...invoice, invoiceImportDraft: invoiceImportListSummary(invoice.invoiceImportDraft) })),
    total,
    grossAmountTotal: paymentSummary.gross.plnAmount,
    grossAmountSummary: paymentSummary.gross,
    unpaidAmountTotal: paymentSummary.unpaid.plnAmount,
    unpaidAmountSummary: paymentSummary.unpaid,
    unpaidCount: paymentSummary.unpaidCount,
    uncertainPaymentCount: paymentSummary.uncertainPaymentCount,
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
  const outcome = await withAiQueueMutation(prisma, () => new Date(), async (tx) => {
    const duplicate = await findExistingInvoiceDuplicate(tx, {
      supplierName: data.supplierName, taxId: data.supplierNip,
      invoiceNumber: data.invoiceNumber, issueDate: data.issueDate,
    })
    if (duplicate) return { kind: 'duplicate' as const, duplicate }

    const rules = await tx.ksefSupplierRule.findMany({
      where: { active: true },
      include: { tags: true },
    })
    const ruleDecision = resolveSupplierRuleMatch(
      { supplierName: data.supplierName, supplierNip: data.supplierNip },
      rules
    )
    const match = ruleDecision.status === 'MATCHED' ? ruleDecision.rule : null

    const invoice = await tx.ksefInvoice.create({
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
        ruleMatchStatus: ruleDecision.status === 'CONFLICT' ? 'CONFLICT' : match ? 'MATCHED' : 'NO_RULE',
        costCenterId: match?.costCenterId ?? null,
        subCategoryId: match?.subCategoryId ?? null,
        supplierRuleId: match?.id ?? null,
        ...(match?.tags && match.tags.length > 0
          ? {
              parts: {
                create: {
                  label: data.invoiceNumber,
                  grossAmount: roundMoney(data.grossAmount),
                  order: 0,
                  tags: { create: match.tags.map((tag) => ({ tagId: tag.tagId })) },
                  allocations: { create: { costCenterId: match.costCenterId, percent: 100 } },
                },
              },
            }
          : {}),
      },
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
        supplierRule: true,
        parts: {
          include: {
            tags: { include: { tag: true } },
            allocations: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    })
    return { kind: 'created' as const, invoice }
  })

  if (outcome.kind === 'duplicate') {
    return NextResponse.json(invoiceDuplicateBody(outcome.duplicate), { status: 409 })
  }
  return NextResponse.json(outcome.invoice, { status: 201 })
}
