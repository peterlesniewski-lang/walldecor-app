import { createHash } from 'node:crypto'
import type { PrismaClient, SubiektRevenueSnapshot } from '@/generated/prisma'
import { upsertRevenueEntry } from '@/lib/finance/revenue-store'
import {
  COST_CENTER_CHANNELS, REVENUE_CHANNELS, RevenueEntrySchema, revenueWarsawToday, type RevenueChannel,
} from '@/lib/validations/revenue'
import {
  SubiektBridgeError, describeSubiektBridgeError, fetchSalesSummary, readSubiektBridgeConfig,
  type FetchLike, type SalesSummaryRow, type SubiektBridgeConfig,
} from '@/lib/finance/subiekt-bridge-client'

/**
 * Monthly gross sales read from the Subiekt GT bridge, stored per warehouse ×
 * kind and shown next to manually entered Revenue. Revenue changes only when an
 * ADMIN applies a snapshot cell. Date basis is the document issue date (plan
 * decision 6c); the bridge already applies FS + KFS + PA − ZW (decision 7).
 */

export const SUBIEKT_WAREHOUSE_MAP_DEFAULT = 'PUŁ:PUL,MAG:JAG,INT:PUL:ECOMMERCE'
/** Months fetched on every refresh (current month + 12 previous). */
export const SUBIEKT_REFRESH_MONTHS = 13

export const SUBIEKT_BRIDGE_KEYS = {
  lastFetchAt: 'subiekt_bridge.last_fetch_at',
  lastError: 'subiekt_bridge.last_error',
  lastErrorAt: 'subiekt_bridge.last_error_at',
  autoSyncSlot: 'subiekt_bridge.auto_sync_slot',
  autoSyncStatus: 'subiekt_bridge.auto_sync_status',
  autoSyncMessage: 'subiekt_bridge.auto_sync_message',
} as const

export type SubiektKind = 'TOWAR' | 'USLUGA' | 'INNE'
export type SubiektCostCenterId = 'JAG' | 'PUL'

export interface WarehouseMapping {
  costCenterId: SubiektCostCenterId
  /** Channel forced for both kinds (e.g. INT → ECOMMERCE); null = derive from kind. */
  channel: RevenueChannel | null
}

export type WarehouseMap = ReadonlyMap<string, WarehouseMapping>

/** `INNE` has no channel: it is reported like an unmapped warehouse and never applied. */
export const KIND_CHANNEL: Partial<Record<SubiektKind, RevenueChannel>> = { TOWAR: 'SALON', USLUGA: 'MONTAZ' }

const normalizeSymbol = (symbol: string) => symbol.trim().toLocaleUpperCase('pl-PL')

/** `SYMBOL:COSTCENTER[:CHANNEL],…` → map; malformed entries are reported, never silently dropped into a guess. */
export function parseWarehouseMap(raw: string | undefined = SUBIEKT_WAREHOUSE_MAP_DEFAULT): { map: WarehouseMap; problems: string[] } {
  const map = new Map<string, WarehouseMapping>()
  const problems: string[] = []
  const source = raw === undefined || raw.trim() === '' ? SUBIEKT_WAREHOUSE_MAP_DEFAULT : raw
  for (const entry of source.split(',').map((part) => part.trim()).filter(Boolean)) {
    const [symbolRaw, centerRaw, channelRaw, ...rest] = entry.split(':').map((part) => part.trim())
    const symbol = symbolRaw ? normalizeSymbol(symbolRaw) : ''
    if (!symbol || !centerRaw || rest.length > 0) { problems.push(`Nieprawidłowy wpis mapy magazynów: „${entry}”`); continue }
    const costCenterId = centerRaw.toUpperCase()
    if (costCenterId !== 'JAG' && costCenterId !== 'PUL') { problems.push(`Nieznane centrum kosztów „${centerRaw}” we wpisie „${entry}”`); continue }
    let channel: RevenueChannel | null = null
    if (channelRaw !== undefined && channelRaw !== '') {
      const upper = channelRaw.toUpperCase() as RevenueChannel
      if (!REVENUE_CHANNELS.includes(upper)) { problems.push(`Nieznany kanał „${channelRaw}” we wpisie „${entry}”`); continue }
      if (!COST_CENTER_CHANNELS[costCenterId]?.includes(upper)) { problems.push(`Kanał ${upper} nie jest dostępny dla ${costCenterId} (wpis „${entry}”)`); continue }
      channel = upper
    }
    if (map.has(symbol)) problems.push(`Magazyn „${symbol}” występuje w mapie więcej niż raz; obowiązuje ostatni wpis`)
    map.set(symbol, { costCenterId, channel })
  }
  return { map, problems }
}

export interface MappedRow {
  costCenterId: SubiektCostCenterId | null
  channel: RevenueChannel | null
}

/** Pure: warehouse + kind → cost center + channel, or nulls when the warehouse is not in the map. */
export function mapRow(row: Pick<SalesSummaryRow, 'warehouse_symbol' | 'kind'>, map: WarehouseMap): MappedRow {
  const mapping = map.get(normalizeSymbol(row.warehouse_symbol))
  if (!mapping) return { costCenterId: null, channel: null }
  const channel = row.kind === 'INNE' ? null : (mapping.channel ?? KIND_CHANNEL[row.kind] ?? null)
  if (!channel || !COST_CENTER_CHANNELS[mapping.costCenterId]?.includes(channel)) return { costCenterId: null, channel: null }
  return { costCenterId: mapping.costCenterId, channel }
}

export function snapshotSourceHash(row: SalesSummaryRow): string {
  const payload = [row.year, row.month, normalizeSymbol(row.warehouse_symbol), row.kind, row.documents, row.net_total.toFixed(2), row.gross_total.toFixed(2)].join('|')
  return createHash('sha256').update(payload).digest('hex')
}

const monthIndex = (year: number, month: number) => year * 12 + (month - 1)
const pad = (n: number) => String(n).padStart(2, '0')

/** `[from, to]` covering the current Warsaw month and the previous `months - 1` months. */
export function refreshWindow(now = new Date(), months = SUBIEKT_REFRESH_MONTHS) {
  const today = revenueWarsawToday(now)
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const start = monthIndex(year, month) - (months - 1)
  const fromYear = Math.floor(start / 12)
  const fromMonth = (start % 12) + 1
  return { from: `${fromYear}-${pad(fromMonth)}-01`, to: today, fromIndex: start, toIndex: monthIndex(year, month) }
}

type SnapshotDb = Pick<PrismaClient, 'subiektRevenueSnapshot' | 'appSetting' | 'revenue' | '$transaction'>
/** Enough for applying a snapshot; satisfied by the client and by an interactive-transaction client. */
type ApplyDb = Pick<PrismaClient, 'subiektRevenueSnapshot' | 'revenue'>

async function writeSettings(db: SnapshotDb, values: Record<string, string>) {
  await db.$transaction(Object.entries(values).map(([key, value]) =>
    db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })))
}

export interface RefreshOptions {
  config?: SubiektBridgeConfig | null
  env?: Record<string, string | undefined>
  now?: Date
  fetchImpl?: FetchLike
}

export type RefreshResult =
  | { ok: true; fetchedAt: string; rows: number; unmappedWarehouses: string[]; mapProblems: string[] }
  | { ok: false; kind: SubiektBridgeError['kind'] | 'unknown'; error: string }

/**
 * Reads the last 13 months from the bridge and replaces the stored snapshot
 * rows for that window in one transaction. Rows the bridge no longer returns
 * (e.g. a month that lost its only document) are deleted, so a cell without
 * documents shows no Subiekt amount instead of a stale one.
 */
export async function refreshSubiektRevenue(db: SnapshotDb, options: RefreshOptions = {}): Promise<RefreshResult> {
  const env = options.env ?? process.env
  const config = options.config === undefined ? readSubiektBridgeConfig(env) : options.config
  const now = options.now ?? new Date()
  const window = refreshWindow(now)
  const { map, problems } = parseWarehouseMap(env.SUBIEKT_BRIDGE_WAREHOUSE_MAP)

  let summary
  try {
    summary = await fetchSalesSummary(config, { from: window.from, to: window.to }, options.fetchImpl)
  } catch (error) {
    const message = describeSubiektBridgeError(error)
    await writeSettings(db, { [SUBIEKT_BRIDGE_KEYS.lastError]: message, [SUBIEKT_BRIDGE_KEYS.lastErrorAt]: now.toISOString() })
    return { ok: false, kind: error instanceof SubiektBridgeError ? error.kind : 'unknown', error: message }
  }

  const unmapped = new Set<string>()
  const incoming = summary.rows
    .filter((row) => { const index = monthIndex(row.year, row.month); return index >= window.fromIndex && index <= window.toIndex })
    .map((row) => {
      const mapped = mapRow(row, map)
      const symbol = normalizeSymbol(row.warehouse_symbol)
      if (!mapped.costCenterId) unmapped.add(row.kind === 'INNE' ? `${symbol} (rodzaj INNE)` : symbol)
      return {
        year: row.year, month: row.month, warehouseSymbol: symbol, kind: row.kind,
        costCenterId: mapped.costCenterId, channel: mapped.channel,
        grossAmount: Math.round(row.gross_total * 100) / 100, netAmount: Math.round(row.net_total * 100) / 100,
        documentCount: row.documents, fetchedAt: now, sourceHash: snapshotSourceHash(row),
      }
    })

  await db.$transaction(async (tx) => {
    const existing = await tx.subiektRevenueSnapshot.findMany({ select: { id: true, year: true, month: true, warehouseSymbol: true, kind: true } })
    const incomingKeys = new Set(incoming.map((row) => `${row.year}-${row.month}-${row.warehouseSymbol}-${row.kind}`))
    const stale = existing
      .filter((row) => { const index = monthIndex(row.year, row.month); return index >= window.fromIndex && index <= window.toIndex })
      .filter((row) => !incomingKeys.has(`${row.year}-${row.month}-${row.warehouseSymbol}-${row.kind}`))
      .map((row) => row.id)
    if (stale.length) await tx.subiektRevenueSnapshot.deleteMany({ where: { id: { in: stale } } })
    for (const row of incoming) {
      const { year, month, warehouseSymbol, kind, ...rest } = row
      await tx.subiektRevenueSnapshot.upsert({
        where: { year_month_warehouseSymbol_kind: { year, month, warehouseSymbol, kind } },
        update: rest,
        create: { year, month, warehouseSymbol, kind, ...rest },
      })
    }
    for (const [key, value] of Object.entries({ [SUBIEKT_BRIDGE_KEYS.lastFetchAt]: now.toISOString(), [SUBIEKT_BRIDGE_KEYS.lastError]: '', [SUBIEKT_BRIDGE_KEYS.lastErrorAt]: '' })) {
      await tx.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    }
  })

  return { ok: true, fetchedAt: now.toISOString(), rows: incoming.length, unmappedWarehouses: [...unmapped].sort(), mapProblems: problems }
}

export interface SubiektRevenueCell {
  year: number
  month: number
  costCenterId: SubiektCostCenterId
  channel: RevenueChannel
  grossAmount: number
  netAmount: number
  documentCount: number
}

export interface SubiektUnmappedRow {
  year: number
  month: number
  warehouseSymbol: string
  kind: SubiektKind
  grossAmount: number
  documentCount: number
}

export interface SubiektRevenueView {
  configured: boolean
  fetchedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  mapProblems: string[]
  cells: SubiektRevenueCell[]
  unmapped: SubiektUnmappedRow[]
}

const round2 = (value: number) => Math.round(value * 100) / 100

/** Aggregates stored snapshot rows for a year (optionally one center) into month × center × channel cells. */
export function aggregateSnapshots(rows: Pick<SubiektRevenueSnapshot, 'year' | 'month' | 'warehouseSymbol' | 'kind' | 'costCenterId' | 'channel' | 'grossAmount' | 'netAmount' | 'documentCount'>[]) {
  const cells = new Map<string, SubiektRevenueCell>()
  const unmapped: SubiektUnmappedRow[] = []
  for (const row of rows) {
    if (!row.costCenterId || !row.channel || (row.costCenterId !== 'JAG' && row.costCenterId !== 'PUL')) {
      unmapped.push({ year: row.year, month: row.month, warehouseSymbol: row.warehouseSymbol, kind: row.kind as SubiektKind, grossAmount: round2(row.grossAmount), documentCount: row.documentCount })
      continue
    }
    const key = `${row.year}-${row.month}-${row.costCenterId}-${row.channel}`
    const cell = cells.get(key) ?? { year: row.year, month: row.month, costCenterId: row.costCenterId, channel: row.channel as RevenueChannel, grossAmount: 0, netAmount: 0, documentCount: 0 }
    cell.grossAmount = round2(cell.grossAmount + row.grossAmount)
    cell.netAmount = round2(cell.netAmount + row.netAmount)
    cell.documentCount += row.documentCount
    cells.set(key, cell)
  }
  const order = (a: { year: number; month: number }, b: { year: number; month: number }) => a.year - b.year || a.month - b.month
  const cellOrder = (a: SubiektRevenueCell, b: SubiektRevenueCell) => order(a, b) || a.costCenterId.localeCompare(b.costCenterId) || a.channel.localeCompare(b.channel)
  const unmappedOrder = (a: SubiektUnmappedRow, b: SubiektUnmappedRow) => order(a, b) || a.warehouseSymbol.localeCompare(b.warehouseSymbol) || a.kind.localeCompare(b.kind)
  return { cells: [...cells.values()].sort(cellOrder), unmapped: unmapped.sort(unmappedOrder) }
}

export async function getSubiektRevenueView(db: SnapshotDb, year: number, costCenterId: string, env: Record<string, string | undefined> = process.env): Promise<SubiektRevenueView> {
  const configured = readSubiektBridgeConfig(env) !== null
  const { problems } = parseWarehouseMap(env.SUBIEKT_BRIDGE_WAREHOUSE_MAP)
  const [rows, settings] = await Promise.all([
    db.subiektRevenueSnapshot.findMany({ where: { year } }),
    db.appSetting.findMany({ where: { key: { in: [SUBIEKT_BRIDGE_KEYS.lastFetchAt, SUBIEKT_BRIDGE_KEYS.lastError, SUBIEKT_BRIDGE_KEYS.lastErrorAt] } } }),
  ])
  const setting = (key: string) => settings.find((row) => row.key === key)?.value || null
  const aggregated = aggregateSnapshots(rows)
  const scoped = costCenterId === 'GLOBAL' ? aggregated.cells : aggregated.cells.filter((cell) => cell.costCenterId === costCenterId)
  return {
    configured,
    fetchedAt: setting(SUBIEKT_BRIDGE_KEYS.lastFetchAt),
    lastError: setting(SUBIEKT_BRIDGE_KEYS.lastError),
    lastErrorAt: setting(SUBIEKT_BRIDGE_KEYS.lastErrorAt),
    mapProblems: problems,
    cells: scoped,
    unmapped: aggregated.unmapped,
  }
}

export interface ApplyCellInput {
  year: number
  month: number
  costCenterId: string
  channel: string
}

export type ApplyResult =
  | { ok: true; entries: Array<{ year: number; month: number; costCenterId: string; channel: string; amount: number; asOfDate: string | null }> }
  | { ok: false; error: string }

/** Last day of the month for a closed month; today for the current month; never a future date. */
export function subiektAsOfDate(year: number, month: number, now = new Date()): string | null {
  const today = revenueWarsawToday(now)
  const monthKey = `${year}-${pad(month)}`
  if (today.startsWith(`${monthKey}-`)) return today
  if (monthKey > today.slice(0, 7)) return null
  return `${monthKey}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`
}

/** Copies the Subiekt gross amount of one cell into Revenue through the same validation and write path as the manual editor. */
export async function applySubiektRevenue(db: ApplyDb, input: ApplyCellInput, now = new Date()): Promise<ApplyResult> {
  const rows = await db.subiektRevenueSnapshot.findMany({ where: { year: input.year, month: input.month, costCenterId: input.costCenterId, channel: input.channel } })
  if (rows.length === 0) return { ok: false, error: 'Brak odczytu z Subiekta dla tej komórki. Najpierw użyj „Odczytaj teraz”.' }
  const amount = round2(rows.reduce((sum, row) => sum + row.grossAmount, 0))
  const asOfDate = subiektAsOfDate(input.year, input.month, now)
  if (!asOfDate) return { ok: false, error: 'Nie można zastosować przychodu dla przyszłego miesiąca.' }
  const parsed = RevenueEntrySchema.safeParse({ year: input.year, month: input.month, costCenterId: input.costCenterId, channel: input.channel, amount, asOfDate })
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join('. ') }
  const entry = await upsertRevenueEntry(db, parsed.data)
  return { ok: true, entries: [{ year: entry.year, month: entry.month, costCenterId: entry.costCenterId, channel: entry.channel, amount: entry.amount, asOfDate: entry.asOfDate }] }
}

class ApplyMonthAbort extends Error {
  constructor(readonly result: Extract<ApplyResult, { ok: false }>) { super(result.error) }
}

/** Applies every channel of a month that has a Subiekt snapshot for the center — all or nothing, in one transaction. */
export async function applySubiektRevenueMonth(db: SnapshotDb, input: Omit<ApplyCellInput, 'channel'>, now = new Date()): Promise<ApplyResult> {
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.subiektRevenueSnapshot.findMany({ where: { year: input.year, month: input.month, costCenterId: input.costCenterId, channel: { not: null } }, select: { channel: true } })
      const channels = [...new Set(rows.map((row) => row.channel).filter((channel): channel is string => channel !== null))].sort()
      if (channels.length === 0) throw new ApplyMonthAbort({ ok: false, error: 'Brak odczytu z Subiekta dla tego miesiąca. Najpierw użyj „Odczytaj teraz”.' })
      const entries: Extract<ApplyResult, { ok: true }>['entries'] = []
      for (const channel of channels) {
        const result = await applySubiektRevenue(tx, { ...input, channel }, now)
        if (!result.ok) throw new ApplyMonthAbort(result)
        entries.push(...result.entries)
      }
      return { ok: true, entries } satisfies ApplyResult
    })
  } catch (error) {
    if (error instanceof ApplyMonthAbort) return error.result
    throw error
  }
}

export interface SubiektAiMonth {
  year: number
  month: number
  costCenterId: SubiektCostCenterId
  channel: RevenueChannel
  subiektGross: number
  documentCount: number
  enteredAmount: number | null
  difference: number | null
}

export interface SubiektAiBlock {
  configured: boolean
  fetchedAt: string | null
  lastError: string | null
  months: SubiektAiMonth[]
  unmapped: SubiektUnmappedRow[]
}

/** Server-side projection for the finance chat context (no network: snapshots and Revenue from the database only). */
export async function loadSubiektAiBlock(db: SnapshotDb, year: number, env: Record<string, string | undefined> = process.env): Promise<SubiektAiBlock | null> {
  if (readSubiektBridgeConfig(env) === null) return null
  const view = await getSubiektRevenueView(db, year, 'GLOBAL', env)
  const revenue = await db.revenue.findMany({ where: { year }, select: { month: true, costCenterId: true, channel: true, amount: true } })
  const entered = new Map(revenue.map((row) => [`${row.month}-${row.costCenterId}-${row.channel}`, row.amount]))
  return {
    configured: true,
    fetchedAt: view.fetchedAt,
    lastError: view.lastError,
    months: view.cells.map((cell) => {
      const amount = entered.get(`${cell.month}-${cell.costCenterId}-${cell.channel}`) ?? null
      return {
        year: cell.year, month: cell.month, costCenterId: cell.costCenterId, channel: cell.channel,
        subiektGross: cell.grossAmount, documentCount: cell.documentCount, enteredAmount: amount,
        difference: amount === null ? null : round2(cell.grossAmount - amount),
      }
    }),
    unmapped: view.unmapped,
  }
}
