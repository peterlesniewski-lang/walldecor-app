import type { Prisma } from '@/generated/prisma'

export interface ClosedInvoicePeriod {
  id: string
  year: number
  month: number
  closedAt: string
}

export class ClosedInvoicePeriodsError extends Error {
  readonly code = 'CLOSED_PERIOD_CONFIRMATION_REQUIRED'
  readonly status = 409

  constructor(readonly periods: ClosedInvoicePeriod[]) {
    super('Zmiana dotyczy kompletnego miesiąca. Potwierdź oznaczenie go do ponownego sprawdzenia.')
    this.name = 'ClosedInvoicePeriodsError'
  }
}

interface InvalidationInput {
  actorId: string
  invoiceId?: string
  costEventId?: string
  reason: 'invoice.approve' | 'invoice.revoke' | 'invoice.edit'
  dates: readonly Date[]
  confirmedPeriodIds: readonly string[]
}

/** Transaction-internal helper. The caller must authorize the administrator and
 * reserve the SQLite writer before reading invoice state. Completion IDs (not
 * just month numbers) make a confirmation stale after a new completion.
 * FinancePeriodClose presence means complete in existing dashboard consumers;
 * removal marks the period incomplete while CostAuditLog retains its snapshot.
 */
export async function invalidateClosedInvoicePeriods(
  tx: Prisma.TransactionClient,
  input: InvalidationInput,
): Promise<ClosedInvoicePeriod[]> {
  const affected = new Map<string, { year: number; month: number }>()
  for (const date of input.dates) {
    if (!Number.isFinite(date.getTime())) throw new Error('Nieprawidłowa data kosztu.')
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    affected.set(`${year}-${month}`, { year, month })
  }
  if (affected.size === 0) return []

  const completed = await tx.financePeriodClose.findMany({
    where: { OR: [...affected.values()] }, orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })
  const periods = completed.map(({ id, year, month, closedAt }) => ({
    id, year, month, closedAt: closedAt.toISOString(),
  }))
  const confirmed = new Set(input.confirmedPeriodIds)
  const missing = periods.filter((period) => !confirmed.has(period.id))
  if (missing.length > 0) throw new ClosedInvoicePeriodsError(missing)

  for (const period of completed) {
    await tx.costAuditLog.create({ data: {
      action: 'finance.period.invalidate',
      actorId: input.actorId,
      invoiceId: input.invoiceId,
      costEventId: input.costEventId,
      beforeJson: JSON.stringify(period),
      afterJson: JSON.stringify({
        year: period.year, month: period.month, state: 'REQUIRES_REVIEW', reason: input.reason,
      }),
    } })
    await tx.financePeriodClose.delete({ where: { id: period.id } })
  }
  return periods
}
