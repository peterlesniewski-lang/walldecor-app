/**
 * Break-Even Point calculation.
 *
 * @param fc  Fixed costs (suma kosztów stałych)
 * @param vc  Variable costs (suma kosztów zmiennych)
 * @param rev Revenue (przychody)
 * @returns   BEP threshold in PLN, 0 when FC=0, null when unreachable / no data
 */
export function calcBep(fc: number, vc: number, rev: number): number | null {
  if (fc === 0) return 0
  if (rev <= 0 || rev <= vc) return null
  return (fc * rev) / (rev - vc)
}
