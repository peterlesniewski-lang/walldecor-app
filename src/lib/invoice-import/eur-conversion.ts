import { z } from 'zod'

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER)
const TEN = BigInt(10)
const ZERO = BigInt(0)

/** Rates use ASCII decimals only, at most eight fractional digits and 10,000 PLN/EUR. */
export function parseCanonicalRate(value: string | number): string {
  const text = String(value)
  if (text.length > 18 || !/^(0|[1-9]\d{0,4})(\.\d{1,8})?$/.test(text)
    || !Number.isFinite(Number(text)) || Number(text) <= 0 || Number(text) > 10_000) {
    throw new Error('INVALID_EXCHANGE_RATE')
  }
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

function decimal(value: number | string): { digits: bigint; scale: number } {
  const text = String(value)
  if (text.length > 40 || (typeof value === 'string' && text.includes('e'))
    || !/^(0|[1-9]\d*)(\.\d+)?(e-\d{1,3})?$/.test(text)
    || !Number.isFinite(Number(text)) || Number(text) < 0 || Number(text) > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error('INVALID_AMOUNT')
  }
  const [coefficient, exponent = '0'] = text.split('e')
  const [whole, fraction = ''] = coefficient.split('.')
  return { digits: BigInt(whole + fraction), scale: fraction.length - Number(exponent) }
}

export function convertEurAmounts(
  amounts: { gross: number | string; net?: number | string | null; vat?: number | string | null },
  rate: string | number,
): { reportingGross: number; reportingNet: number | null; reportingVat: number | null } {
  const factor = decimal(parseCanonicalRate(rate))
  function convert(value: number | string): number {
    const amount = decimal(value)
    const product = amount.digits * factor.digits
    const scale = amount.scale + factor.scale - 2
    const divisor = scale > 0 ? TEN ** BigInt(scale) : BigInt(1)
    const cents = scale <= 0 ? product * TEN ** BigInt(-scale)
      : product / divisor + (product % divisor * BigInt(2) >= divisor ? BigInt(1) : ZERO)
    if (cents > MAX_CENTS) throw new Error('AMOUNT_OUT_OF_RANGE')
    return Number(cents) / 100
  }
  return {
    reportingGross: convert(amounts.gross),
    reportingNet: amounts.net == null ? null : convert(amounts.net),
    reportingVat: amounts.vat == null ? null : convert(amounts.vat),
  }
}

const rateSchema = z.string().refine((value) => {
  try { return parseCanonicalRate(value) === value } catch { return false }
}, 'Kurs musi być dodatnią liczbą dziesiętną.')
const tableSchema = z.string().regex(/^\d{3}\/A\/NBP\/\d{4}$/)
export const invoiceEurConversionSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('NBP'), paymentDate: z.iso.date(), rate: rateSchema, rateDate: z.iso.date(), tableNumber: tableSchema }),
  z.strictObject({ mode: z.literal('MANUAL_RATE'), paymentDate: z.iso.date().nullable(), rate: rateSchema, rateDate: z.null(), tableNumber: z.null() }),
  z.strictObject({ mode: z.literal('MANUAL_AMOUNT'), paymentDate: z.iso.date().nullable(), rate: z.null(), rateDate: z.null(), tableNumber: z.null() }),
]).refine((value) => value.mode !== 'NBP' || (value.rateDate < value.paymentDate
  && value.tableNumber.endsWith(value.rateDate.slice(0, 4))), 'Nieprawidłowa data lub tabela NBP.')
export type InvoiceEurConversion = z.infer<typeof invoiceEurConversionSchema>

export const nbpEurQuoteSchema = z.strictObject({
  currency: z.literal('EUR'), paymentDate: z.iso.date(), rate: rateSchema, rateDate: z.iso.date(), tableNumber: tableSchema,
}).refine((value) => invoiceEurConversionSchema.safeParse({ mode: 'NBP', paymentDate: value.paymentDate,
  rate: value.rate, rateDate: value.rateDate, tableNumber: value.tableNumber }).success)
export type NbpEurQuote = z.infer<typeof nbpEurQuoteSchema>

export const EUR_CONVERSION_BASIS_FIELDS = ['currency', 'gross', 'net', 'vat', 'paidAt', 'conversion', 'reportingGross', 'reportingNet', 'reportingVat'] as const

export function hasEurSourceCentPrecision(data: {
  conversion?: InvoiceEurConversion | null; gross?: number | null; net?: number | null; vat?: number | null
}): boolean {
  if (!data.conversion || data.conversion.mode === 'MANUAL_AMOUNT') return true
  try {
    return [data.gross, data.net, data.vat].every((amount) => amount == null
      || convertEurAmounts({ gross: amount }, '1').reportingGross === amount)
  } catch { return false }
}

/** Independent validation for confirmed structured conversions at save and approval. */
export function isValidConfirmedEurConversion(data: {
  currency?: string | null; gross?: number | null; net?: number | null; vat?: number | null; paidAt?: string | null
  conversion?: InvoiceEurConversion | null; reportingGross?: number | null; reportingNet?: number | null; reportingVat?: number | null
}): boolean {
  if (!data.conversion) return true // Previously saved manual foreign-currency drafts.
  if (!hasEurSourceCentPrecision(data)) return false
  const conversion = data.conversion
  if (data.currency !== 'EUR' || conversion.paymentDate !== (data.paidAt ?? null)
    || !invoiceEurConversionSchema.safeParse(conversion).success) return false
  const amounts = [data.reportingGross, data.reportingNet, data.reportingVat]
  if (data.reportingGross == null || amounts.some((amount) => amount != null
    && (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 100))) return false
  if (conversion.mode === 'MANUAL_AMOUNT') return true
  if (data.gross == null) return false
  try {
    const expected = convertEurAmounts({ gross: data.gross, net: data.net, vat: data.vat }, conversion.rate)
    return Object.entries(expected).every(([field, amount]) => (data[field as keyof typeof expected] ?? null) === amount)
  } catch { return false }
}
