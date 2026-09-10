const MONEY_LIMIT = 2_147_483_647
export function parseCashierMoney(value: string): number | null {
  const normalized = value.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  if (!normalized) return null
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Podaj nieujemną kwotę z najwyżej dwoma miejscami po przecinku.')
  const [whole, fraction = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > MONEY_LIMIT) throw new Error('Kwota przekracza dopuszczalny limit.')
  return cents
}
export const cashInput = (cents: number | null) => cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',')
export const cashFormat = (cents: number | null) => cents === null ? 'Brak danych' : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(cents / 100)
