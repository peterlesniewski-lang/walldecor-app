import type { PrismaClient } from '@/generated/prisma'
import { KsefApiError, describeKsefApiError } from '@/lib/finance/ksef-client'
import {
  KsefSyncConfigError,
  KsefSyncInProgressError,
  runKsefSync,
  withKsefSyncLock,
} from '@/lib/finance/ksef-sync-service'

/** Local (Europe/Warsaw) hours at which KSeF is synchronized automatically. */
export const KSEF_AUTO_SYNC_HOURS = [7, 15] as const
export const KSEF_AUTO_SYNC_TIME_ZONE = 'Europe/Warsaw'
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 60 * 1000

export const KSEF_AUTO_SYNC_KEYS = {
  enabled: 'ksef_auto_sync_enabled',
  lastSlot: 'ksef_auto_sync_last_slot',
  lastRunAt: 'ksef_auto_sync_last_run_at',
  lastStatus: 'ksef_auto_sync_last_status',
  lastMessage: 'ksef_auto_sync_last_message',
} as const

export type KsefAutoSyncStatus = 'OK' | 'ERROR' | 'SKIPPED'

export type KsefAutoSyncOutcome =
  | { ran: false; reason: 'DISABLED' | 'NOT_DUE' }
  | { ran: true; slot: string; status: KsefAutoSyncStatus; message: string }

function localParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KSEF_AUTO_SYNC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

function slotKey(date: string, hour: number) {
  return `${date}T${String(hour).padStart(2, '0')}`
}

/**
 * The most recent scheduled slot at or before `now`, as a sortable
 * `YYYY-MM-DDTHH` key in Warsaw time. Before the first hour of the day it is
 * the last slot of the previous day, so a slot missed overnight is caught up.
 */
export function latestDueSlot(now: Date, hours: readonly number[] = KSEF_AUTO_SYNC_HOURS): string {
  const sorted = [...hours].sort((a, b) => a - b)
  const today = localParts(now)
  const dueToday = sorted.filter((hour) => hour <= today.hour).at(-1)
  if (dueToday !== undefined) return slotKey(today.date, dueToday)
  const previousDay = new Date(`${today.date}T00:00:00.000Z`)
  previousDay.setUTCDate(previousDay.getUTCDate() - 1)
  return slotKey(previousDay.toISOString().slice(0, 10), sorted[sorted.length - 1])
}

export function isSlotPending(slot: string, lastSlot: string | null | undefined) {
  return !lastSlot || slot > lastSlot
}

async function writeSettings(db: PrismaClient, values: Record<string, string>) {
  await db.$transaction(
    Object.entries(values).map(([key, value]) =>
      db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  )
}

async function findSyncActor(db: PrismaClient) {
  return db.user.findFirst({
    where: { role: 'ADMIN', isActive: true, mustChangePassword: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
}

function describeFailure(error: unknown) {
  if (error instanceof KsefSyncConfigError || error instanceof KsefSyncInProgressError) return error.message
  if (error instanceof KsefApiError) return describeKsefApiError(error)
  return 'Nie udało się przeprowadzić synchronizacji KSeF.'
}

/** Runs the KSeF sync once per scheduled slot; safe to call repeatedly. */
export async function runScheduledKsefSync(db: PrismaClient, now: Date = new Date()): Promise<KsefAutoSyncOutcome> {
  const settings = await db.appSetting.findMany({
    where: { key: { in: ['ksef_enabled', KSEF_AUTO_SYNC_KEYS.enabled, KSEF_AUTO_SYNC_KEYS.lastSlot] } },
  })
  const map = new Map(settings.map((setting) => [setting.key, setting.value]))
  if (map.get('ksef_enabled') !== 'true' || map.get(KSEF_AUTO_SYNC_KEYS.enabled) === 'false') {
    return { ran: false, reason: 'DISABLED' }
  }

  const slot = latestDueSlot(now)
  if (!isSlotPending(slot, map.get(KSEF_AUTO_SYNC_KEYS.lastSlot))) return { ran: false, reason: 'NOT_DUE' }

  // Claim the slot before the long network run so a crash or restart mid-sync
  // does not retry the same slot in a loop.
  await writeSettings(db, { [KSEF_AUTO_SYNC_KEYS.lastSlot]: slot })

  let status: KsefAutoSyncStatus
  let message: string
  try {
    const actor = await findSyncActor(db)
    if (!actor) throw new KsefSyncConfigError('Brak aktywnego administratora, w imieniu którego można synchronizować KSeF.')
    const result = await withKsefSyncLock(() => runKsefSync(db, actor.id))
    status = 'OK'
    message = `Pobrano ${result.fetched}, nowe ${result.imported}, zaktualizowane ${result.updated}, powiązane ${result.linked}.`
  } catch (error) {
    status = error instanceof KsefSyncInProgressError ? 'SKIPPED' : 'ERROR'
    message = describeFailure(error)
  }

  await writeSettings(db, {
    [KSEF_AUTO_SYNC_KEYS.lastRunAt]: new Date().toISOString(),
    [KSEF_AUTO_SYNC_KEYS.lastStatus]: status,
    [KSEF_AUTO_SYNC_KEYS.lastMessage]: message,
  })
  return { ran: true, slot, status, message }
}

const SCHEDULER_STARTED = Symbol.for('walldecor.ksefAutoSyncStarted')

/** Starts the in-process scheduler once per server process. */
export function startKsefAutoSyncScheduler(db: PrismaClient) {
  const holder = globalThis as { [SCHEDULER_STARTED]?: boolean }
  if (holder[SCHEDULER_STARTED]) return
  holder[SCHEDULER_STARTED] = true

  const tick = async () => {
    try {
      const outcome = await runScheduledKsefSync(db)
      if (outcome.ran) console.info(JSON.stringify({ event: 'KSEF_AUTO_SYNC', ...outcome }))
    } catch {
      console.error(JSON.stringify({ event: 'KSEF_AUTO_SYNC_FAILED' }))
    }
  }

  setTimeout(() => { void tick() }, FIRST_CHECK_DELAY_MS).unref()
  setInterval(() => { void tick() }, CHECK_INTERVAL_MS).unref()
}
