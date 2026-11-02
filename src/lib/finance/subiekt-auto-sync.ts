import type { PrismaClient } from '@/generated/prisma'
import { SUBIEKT_BRIDGE_KEYS, refreshSubiektRevenue } from '@/lib/finance/subiekt-revenue'

/**
 * Daily read of Subiekt sales at 07:30 Europe/Warsaw, in the server process
 * (same pattern as ksef-auto-sync.ts): one run per daily slot, a missed slot is
 * caught up after a restart, the slot is claimed before the network call.
 * Enabled only with SUBIEKT_BRIDGE_AUTO_SYNC=on.
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

type AutoSyncDb = Pick<PrismaClient, 'subiektRevenueSnapshot' | 'appSetting' | 'revenue' | '$transaction'>

async function writeSettings(db: AutoSyncDb, values: Record<string, string>) {
  await db.$transaction(Object.entries(values).map(([key, value]) =>
    db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })))
}

export async function runScheduledSubiektSync(db: AutoSyncDb, now: Date = new Date()): Promise<SubiektAutoSyncOutcome> {
  const last = await db.appSetting.findMany({ where: { key: { in: [SUBIEKT_BRIDGE_KEYS.autoSyncSlot] } } })
  const slot = latestDueSubiektSlot(now)
  if (!isSubiektSlotPending(slot, last[0]?.value)) return { ran: false, reason: 'NOT_DUE' }
  await writeSettings(db, { [SUBIEKT_BRIDGE_KEYS.autoSyncSlot]: slot })
  const result = await refreshSubiektRevenue(db, { now })
  const status = result.ok ? 'OK' : 'ERROR'
  const message = result.ok
    ? `Odczytano ${result.rows} wierszy z Subiekta${result.unmappedWarehouses.length ? `; nieprzypisane magazyny: ${result.unmappedWarehouses.join(', ')}` : ''}.`
    : result.error
  await writeSettings(db, { [SUBIEKT_BRIDGE_KEYS.autoSyncStatus]: status, [SUBIEKT_BRIDGE_KEYS.autoSyncMessage]: message })
  return { ran: true, slot, status, message }
}

const SCHEDULER_STARTED = Symbol.for('walldecor.subiektAutoSyncStarted')

/** Starts the in-process scheduler once per server process. */
export function startSubiektAutoSyncScheduler(db: AutoSyncDb) {
  const holder = globalThis as { [SCHEDULER_STARTED]?: boolean }
  if (holder[SCHEDULER_STARTED]) return
  holder[SCHEDULER_STARTED] = true
  const tick = async () => {
    try {
      const outcome = await runScheduledSubiektSync(db)
      if (outcome.ran) console.info(JSON.stringify({ event: 'SUBIEKT_AUTO_SYNC', ...outcome }))
    } catch {
      console.error(JSON.stringify({ event: 'SUBIEKT_AUTO_SYNC_FAILED' }))
    }
  }
  setTimeout(() => { void tick() }, FIRST_CHECK_DELAY_MS).unref()
  setInterval(() => { void tick() }, CHECK_INTERVAL_MS).unref()
}
