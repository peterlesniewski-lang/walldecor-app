/** Polish noun/adjective form for a count: 1 → one, 2–4 (not 12–14) → few, otherwise → many. */
export function pluralPl(count: number, one: string, few: string, many: string) {
  if (count === 1) return one
  const lastDigit = count % 10
  const lastTwo = count % 100
  return lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many
}
