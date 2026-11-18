import type { PrismaClient } from '@/generated/prisma'
import { SUBIEKT_BRIDGE_KEYS, refreshSubiektRevenue } from '@/lib/finance/subiekt-revenue'
import { SUBIEKT_PURCHASE_KEYS, importSubiektForeignPurchases } from '@/lib/finance/subiekt-purchases'

/**
 * Daily read of Subiekt sales at 07:30 Europe/Warsaw, in the server process
 * (same pattern as ksef-auto-sync.ts): one run per daily slot, a missed slot is
 * caught up after a restart, the slot is claimed before the network call.
 * Enabled only with SUBIEKT_BRIDGE_AUTO_SYNC=on (master switch of the scheduler).
 *
 * The same slot also imports foreign (EU) purchase invoices from Subiekt, but only when
 * SUBIEKT_PURCHASES_AUTO_IMPORT=on and SUBIEKT_PURCHASES_IMPORT_FROM is set (the import itself
 * reports "not configured" without it). The import is independent of the sales read: its outcome
 * never changes the sales status and it runs even when the sales read failed.
 */
export const SUBIEKT_AUTO_SYNC_TIME = { hour: 7, minute: 30 } as const
export const SUBIEKT_AUTO_SYNC_TIME_ZONE = 'Europe/Warsaw'
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 60 * 1000

export type SubiektAutoSyncOutcome =
  | { ran: false; reason: 'NOT_DUE' }
  | { ran: true; slot: string; status: 'OK' | 'ERROR'; message: string }

function localParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SUBIEKT_AUTO_SYNC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

/** Date (Warsaw) of the most recent 07:30 slot at or before `now`; before 07:30 it is yesterday's slot. */
export function latestDueSubiektSlot(now: Date, time: { hour: number; minute: number } = SUBIEKT_AUTO_SYNC_TIME): string {
  const local = localParts(now)
  if (local.minutes >= time.hour * 60 + time.minute) return local.date
  const previous = new Date(`${local.date}T00:00:00.000Z`)
  previous.setUTCDate(previous.getUTCDate() - 1)
  return previous.toISOString().slice(0, 10)
}

export const isSubiektSlotPending = (slot: string, lastSlot: string | null | undefined) => !lastSlot || slot > lastSlot

type AutoSyncDb = Pick<PrismaClient, 'subiektRevenueSnapshot' | 'appSetting' | 'revenue' | 'user' | '$transaction'>

async function writeSettings(db: AutoSyncDb, values: Record<string, string>) {
  await db.$transaction(Object.entries(values).map(([key, value]) =>
    db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })))
}

const THROWN_MESSAGE = 'Automatyczny odczyt z Subiekta przerwany błędem aplikacji; kolejna próba przy następnym sprawdzeniu.'

export interface SubiektAutoSyncDeps {
  importPurchases?: typeof importSubiektForeignPurchases
  log?: Pick<Console, 'info' | 'error'>
}

const NO_ADMIN_MESSAGE = 'Błąd: Brak aktywnego administratora do automatycznego importu faktur UE.'
const IMPORT_THROWN_MESSAGE = 'Błąd: Automatyczny import faktur UE przerwany błędem aplikacji.'

/** Daily EU purchases import; never throws and never touches the sales status. */
async function runScheduledPurchasesImport(db: AutoSyncDb, now: Date, deps: SubiektAutoSyncDeps) {
  if (process.env.SUBIEKT_PURCHASES_AUTO_IMPORT !== 'on') return
  const log = deps.log ?? console
  const importPurchases = deps.importPurchases ?? importSubiektForeignPurchases
  const writeImportMessage = (message: string) => writeSettings(db, {
    [SUBIEKT_PURCHASE_KEYS.lastImportAt]: now.toISOString(), [SUBIEKT_PURCHASE_KEYS.lastImportMessage]: message,
  })
  try {
    const admin = await db.user.findFirst({
      where: { role: 'ADMIN', isActive: true, mustChangePassword: false }, select: { id: true }, orderBy: { createdAt: 'asc' },
    })
    if (!admin) {
      await writeImportMessage(NO_ADMIN_MESSAGE)
      log.info(JSON.stringify({ event: 'SUBIEKT_PURCHASES_AUTO_IMPORT', ok: false, kind: 'no_admin' }))
      return
    }
    const result = await importPurchases(db as PrismaClient, { actorId: admin.id, now })
    log.info(JSON.stringify({ event: 'SUBIEKT_PURCHASES_AUTO_IMPORT', ok: result.ok, ...(result.ok ? { created: result.created } : { kind: result.kind }) }))
  } catch {
    log.error(JSON.stringify({ event: 'SUBIEKT_PURCHASES_AUTO_IMPORT', ok: false, kind: 'thrown' }))
    try { await writeImportMessage(IMPORT_THROWN_MESSAGE) } catch { /* database unavailable; the log line above remains */ }
  }
}

export async function runScheduledSubiektSync(db: AutoSyncDb, now: Date = new Date(), deps: SubiektAutoSyncDeps = {}): Promise<SubiektAutoSyncOutcome> {
  const last = await db.appSetting.findMany({ where: { key: { in: [SUBIEKT_BRIDGE_KEYS.autoSyncSlot] } } })
  const previousSlot = last[0]?.value ?? ''
  const slot = latestDueSubiektSlot(now)
  if (!isSubiektSlotPending(slot, previousSlot)) return { ran: false, reason: 'NOT_DUE' }
  // Claim the slot before the network call so a long run is not started twice; a bridge
  // failure is a normal ERROR outcome for the slot. A thrown error (database busy, transaction
  // timeout) releases the slot so the next tick retries instead of losing the day.
  await writeSettings(db, { [SUBIEKT_BRIDGE_KEYS.autoSyncSlot]: slot })
  let status: 'OK' | 'ERROR'
  let message: string
  try {
    const result = await refreshSubiektRevenue(db, { now })
    status = result.ok ? 'OK' : 'ERROR'
    message = result.ok
      ? `Odczytano ${result.rows} wierszy z Subiekta${result.unmappedWarehouses.length ? `; nieprzypisane magazyny: ${result.unmappedWarehouses.join(', ')}` : ''}.`
      : result.error
  } catch {
    status = 'ERROR'
    message = THROWN_MESSAGE
    await writeSettings(db, { [SUBIEKT_BRIDGE_KEYS.autoSyncSlot]: previousSlot, [SUBIEKT_BRIDGE_KEYS.autoSyncStatus]: status, [SUBIEKT_BRIDGE_KEYS.autoSyncMessage]: message })
    await runScheduledPurchasesImport(db, now, deps)
    return { ran: true, slot, status, message }
  }
  await writeSettings(db, { [SUBIEKT_BRIDGE_KEYS.autoSyncStatus]: status, [SUBIEKT_BRIDGE_KEYS.autoSyncMessage]: message })
  await runScheduledPurchasesImport(db, now, deps)
  return { ran: true, slot, status, message }
}

/** One scheduler check: runs the due slot (if any) and logs the outcome as a single JSON line. */
export async function runSubiektAutoSyncTick(db: AutoSyncDb, now: Date = new Date(), log: Pick<Console, 'info' | 'error'> = console, deps: SubiektAutoSyncDeps = {}) {
  try {
    const outcome = await runScheduledSubiektSync(db, now, { ...deps, log })
    if (outcome.ran) log.info(JSON.stringify({ event: 'SUBIEKT_AUTO_SYNC', ...outcome }))
    return outcome
  } catch {
    log.error(JSON.stringify({ event: 'SUBIEKT_AUTO_SYNC_FAILED' }))
    return null
  }
}

const SCHEDULER_STARTED = Symbol.for('walldecor.subiektAutoSyncStarted')

/** Starts the in-process scheduler once per server process. */
export function startSubiektAutoSyncScheduler(db: AutoSyncDb) {
  const holder = globalThis as { [SCHEDULER_STARTED]?: boolean }
  if (holder[SCHEDULER_STARTED]) return
  holder[SCHEDULER_STARTED] = true
  const tick = () => runSubiektAutoSyncTick(db)
  setTimeout(() => { void tick() }, FIRST_CHECK_DELAY_MS).unref()
  setInterval(() => { void tick() }, CHECK_INTERVAL_MS).unref()
}
