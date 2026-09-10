import { MAX_MONEY_CENTS } from './contracts'
import { CashierError } from './errors'

export function checkedCents(value: number, signed = false): number {
  if (!Number.isSafeInteger(value) || value > MAX_MONEY_CENTS || value < (signed ? -MAX_MONEY_CENTS : 0)) {
    throw new CashierError(400, 'MONEY_RANGE', 'Kwota lub suma przekracza dopuszczalny zakres całkowitych groszy.')
  }
  return value
}

export function accountBalanceCents(balance: number) {
  return checkedCents(Math.round(balance * 100), true)
}

type CalculationInput = {
  openingCents: number
  targetFloatCents: number
  cashReceiptsCents: number | null
  cardReceiptsCents: number | null
  countedCents: number | null
  operations: Array<{ kind: string; method: string; amountCents: number; cancelledAt: Date | string | null }>
}

export function calculateCashierReport(report: CalculationInput) {
  let cashMovementCents = 0
  let cardRefundCents = 0
  for (const operation of report.operations) {
    if (operation.cancelledAt) continue
    checkedCents(operation.amountCents)
    if (!['SALES_REFUND', 'DEPOSIT_IN', 'DEPOSIT_REFUND'].includes(operation.kind) || !['CASH', 'CARD'].includes(operation.method)) {
      throw new CashierError(409, 'UNKNOWN_OPERATION', 'Raport zawiera nierozpoznany typ operacji. Wymagana jest kontrola administratora.')
    }
    if (operation.method === 'CASH') {
      cashMovementCents += operation.kind === 'DEPOSIT_IN' ? operation.amountCents : -operation.amountCents
    }
    if (operation.method === 'CARD' && operation.kind === 'SALES_REFUND') cardRefundCents += operation.amountCents
  }
  checkedCents(cashMovementCents, true)
  checkedCents(cardRefundCents)
  const expectedCents = report.cashReceiptsCents == null
    ? null : checkedCents(report.openingCents + report.cashReceiptsCents + cashMovementCents, true)
  const cardAfterRefundsCents = report.cardReceiptsCents == null
    ? null : checkedCents(report.cardReceiptsCents - cardRefundCents, true)
  const counted = report.countedCents == null ? null : checkedCents(report.countedCents)
  return {
    expectedCents,
    differenceCents: counted == null || expectedCents == null ? null : checkedCents(counted - expectedCents, true),
    retainedCents: counted == null ? null : Math.min(counted, report.targetFloatCents),
    depositCents: counted == null ? null : Math.max(counted - report.targetFloatCents, 0),
    shortfallCents: counted == null ? null : Math.max(report.targetFloatCents - counted, 0),
    cardAfterRefundsCents,
  }
}
