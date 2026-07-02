import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { supplierMatchesRule } from '@/lib/finance/ksef-inbox'

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const body = await req.json().catch(() => ({}))
  const ruleId = typeof body.ruleId === 'string' ? body.ruleId.trim() : ''
  if (!ruleId) {
    return NextResponse.json({ error: 'Missing ruleId' }, { status: 400 })
  }

  const rule = await prisma.ksefSupplierRule.findUnique({ where: { id: ruleId } })
  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  const approvedInvoices = await prisma.ksefInvoice.findMany({
    where: { status: 'APPROVED' },
    select: {
      id: true,
      invoiceNumber: true,
      supplierName: true,
      supplierNip: true,
      costCenterId: true,
      subCategoryId: true,
    },
    orderBy: [{ issueDate: 'desc' }, { invoiceNumber: 'asc' }],
  })

  const diffs = approvedInvoices
    .filter((invoice) => supplierMatchesRule(invoice, rule))
    .map((invoice) => ({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierName: invoice.supplierName,
      before: {
        costCenterId: invoice.costCenterId,
        subCategoryId: invoice.subCategoryId,
      },
      after: {
        costCenterId: rule.costCenterId,
        subCategoryId: rule.subCategoryId,
      },
    }))

  return NextResponse.json({
    ruleId,
    affectedCount: diffs.length,
    diffs,
  })
}
