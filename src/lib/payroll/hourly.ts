// Hourly pay (D15, D17): gross = approved hours × rate, net from the person's last approved net/gross
// proportion. Pure integer arithmetic on grosze — no floats ever touch an amount.

/**
 * Gross for `minutes` of approved work at `rateGrosze` per hour: minutes × rate / 60, rounded to the
 * grosz half up. Every approved minute is paid at the same rate (no Saturday or overtime premium).
 */
export function hourlyGrossGrosze(minutes: number, rateGrosze: number): number {
  if (!Number.isInteger(minutes) || !Number.isInteger(rateGrosze) || minutes < 0 || rateGrosze < 0) {
    throw new Error('hourlyGrossGrosze expects non-negative integers')
  }
  // BigInt keeps the product exact beyond 2^53; BigInt() calls because the target is ES2017 (no `2n`).
  const product = BigInt(minutes) * BigInt(rateGrosze)
  return Number((product * BigInt(2) + BigInt(60)) / BigInt(120))
}

export type ApprovedFigures = { year: number; month: number; finalGrossGrosze: number; finalNetGrosze: number }

/**
 * Net suggested from the proportion net / gross of the last approved version (D17), rounded half up;
 * null when there is no usable earlier version. A person whose net equalled gross gets net = gross.
 */
export function netFromLastApproved(grossGrosze: number, last: ApprovedFigures | null): number | null {
  if (!last || last.finalGrossGrosze <= 0 || last.finalNetGrosze < 0 || grossGrosze < 0) return null
  const numerator = BigInt(grossGrosze) * BigInt(last.finalNetGrosze)
  const denominator = BigInt(last.finalGrossGrosze)
  return Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)))
}

