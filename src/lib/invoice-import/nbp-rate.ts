import { z } from 'zod'
import { nbpEurQuoteSchema, parseCanonicalRate, type NbpEurQuote } from './eur-conversion'

export class NbpRateError extends Error {
  constructor(readonly code: 'NBP_INVALID_DATE' | 'NBP_INVALID_RESPONSE' | 'NBP_UNAVAILABLE', readonly status: 422 | 502 | 503) {
    super(code)
    this.name = 'NbpRateError'
  }
}
export type NbpEurRateLookup = (paymentDate: string) => Promise<NbpEurQuote>
interface Dependencies { fetch?: typeof fetch; clock?: () => Date }
const MAX_BYTES = 64_000
const responseSchema = z.object({
  table: z.literal('A'), currency: z.literal('euro'), code: z.literal('EUR'),
  rates: z.array(z.object({ no: z.string().regex(/^\d{3}\/A\/NBP\/\d{4}$/), effectiveDate: z.iso.date(), mid: z.number().finite().positive() })).min(1).max(32),
})
const isoDay = (date: Date) => date.toISOString().slice(0, 10)

export async function getNbpEurRate(paymentDate: string, dependencies: Dependencies = {}): Promise<NbpEurQuote> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format((dependencies.clock ?? (() => new Date()))())
  if (!z.iso.date().safeParse(paymentDate).success || paymentDate <= '2002-01-01' || paymentDate > today) {
    throw new NbpRateError('NBP_INVALID_DATE', 422)
  }
  const endDate = new Date(`${paymentDate}T00:00:00Z`)
  endDate.setUTCDate(endDate.getUTCDate() - 1)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - 31)
  const start = isoDay(startDate) < '2002-01-01' ? '2002-01-01' : isoDay(startDate)
  const end = isoDay(endDate)
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      void reader?.cancel().catch(() => {})
      reject(new NbpRateError('NBP_UNAVAILABLE', 503))
    }, 8000)
  })
  try {
    return await Promise.race([timeout, (async () => {
      const response = await (dependencies.fetch ?? fetch)(`https://api.nbp.pl/api/exchangerates/rates/a/eur/${start}/${end}/?format=json`, {
        signal: controller.signal, redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' },
      })
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new NbpRateError('NBP_UNAVAILABLE', 503) }
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new NbpRateError('NBP_UNAVAILABLE', 503) }
      reader = response.body?.getReader()
      if (!reader) throw new NbpRateError('NBP_INVALID_RESPONSE', 502)
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_BYTES) throw new NbpRateError('NBP_INVALID_RESPONSE', 502)
        chunks.push(value)
      }
      if (controller.signal.aborted) throw new NbpRateError('NBP_UNAVAILABLE', 503)
      try {
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        const result = responseSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
        const dates = new Set<string>()
        const tables = new Set<string>()
        for (const row of result.rates) {
          if (row.effectiveDate < start || row.effectiveDate > end || dates.has(row.effectiveDate)
            || tables.has(row.no) || !row.no.endsWith(row.effectiveDate.slice(0, 4))) throw new Error('Invalid table')
          parseCanonicalRate(row.mid)
          dates.add(row.effectiveDate); tables.add(row.no)
        }
        const latest = result.rates.reduce((a, b) => a.effectiveDate > b.effectiveDate ? a : b)
        return nbpEurQuoteSchema.parse({ currency: 'EUR', paymentDate, rate: parseCanonicalRate(latest.mid), rateDate: latest.effectiveDate, tableNumber: latest.no })
      } catch { throw new NbpRateError('NBP_INVALID_RESPONSE', 502) }
    })()])
  } catch (error) {
    if (error instanceof NbpRateError) throw error
    throw new NbpRateError('NBP_UNAVAILABLE', 503)
  } finally {
    clearTimeout(timer)
    void reader?.cancel().catch(() => {})
  }
}
