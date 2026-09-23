import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { InvoiceImportError } from '@/lib/invoice-import/errors'
import { InvoiceImportHttpError, invoiceHttpErrorResponse } from '@/lib/invoice-import/http-errors'
import { invoiceImportReviewRequiredResponse } from '@/lib/invoice-import/legacy-write-guard'
import { KsefReconciliationPolicyError } from '@/lib/invoice-import/ksef-reconciliation-policy'
import { KsefApiError, describeKsefApiError } from '@/lib/finance/ksef-client'
import {
  KsefSyncConfigError,
  KsefSyncInProgressError,
  runKsefSync,
  withKsefSyncLock,
} from '@/lib/finance/ksef-sync-service'

export async function POST() {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  try {
    const result = await withKsefSyncLock(() => runKsefSync(prisma, auth.session.user.id))
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof KsefSyncConfigError) return NextResponse.json({ error: err.message }, { status: 400 })
    if (err instanceof KsefSyncInProgressError) return NextResponse.json({ error: err.message }, { status: 409 })
    const importedConflict = invoiceImportReviewRequiredResponse(err)
    if (importedConflict) return importedConflict
    if (err instanceof InvoiceImportError) return invoiceHttpErrorResponse(err)
    if (err instanceof KsefReconciliationPolicyError) {
      return invoiceHttpErrorResponse(new InvoiceImportHttpError(err.code, 422))
    }
    return NextResponse.json(
      { error: err instanceof KsefApiError ? describeKsefApiError(err) : 'Nie udało się przeprowadzić synchronizacji KSeF.' },
      { status: err instanceof KsefApiError && err.status === 429 ? 429 : 502 }
    )
  }
}
