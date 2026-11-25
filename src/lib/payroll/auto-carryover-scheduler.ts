import type { PrismaClient } from '@/generated/prisma'
import {
  carryoverFailureNotification,
  notifyPayrollAdmins,
  notifyPayrollAutoCarryover,
  payrollSheetLink,
  pluralPl,
  PAYROLL_AUTO_NOTIFICATION_TYPE,
  PAYROLL_CHANGE_NOTIFICATION_TYPE,
  runPayrollAutoCarryover,
  type PayrollAutoCarryoverSummary,
} from './auto-carryover'
import { isPayrollSchedulerEnabledByEnv } from './automation-env'
import { monthNominative } from './month-names'
import { duePayReminderMonth, sendPayrollPayReminder } from './pay-reminder'
import { parsePayrollMonth, type PayrollPeriod } from './period'
import { getPayrollSheet } from './service'

// In-process schedule of the payroll automat (pattern: src/lib/finance/ksef-auto-sync.ts).
//  • 1st of the month from 06:00 Europe/Warsaw: the carry-over run for the current month, once per
//    month (slot `last_month` claimed before the run; a server that was down runs it at its first
//    check later in the month).
//  • Daily from 07:00: one notification per month (the current and the previous one) about approved
//    rows whose pay-relevant inputs changed and nobody confirmed the amount yet; each change is
//    notified once.
// Both are OFF until an ADMIN enables the automat (D10).
//  • Pay reminder (D18, stage 3): two working days before the last working day of the month, from
//    07:00, one notification about people without an approved settlement — once per month (slot
//    `payroll_pay_reminder_last_month`). It does NOT depend on the automat switch: hourly people are
//    approved by hand whether the automat is on or off, and D18 sets no condition. Only the env switch
//    (PAYROLL_AUTO_CARRYOVER=off, or not =on outside production) stops it, with the whole schedule.
// `now` is a parameter so the due-date rules are unit-testable.

export const PAYROLL_AUTOMATION_TIME_ZONE = 'Europe/Warsaw'
export const PAYROLL_CARRYOVER_HOUR = 6
export const PAYROLL_CHANGE_NOTICE_HOUR = 7
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 60 * 1000

export const PAYROLL_AUTOMATION_KEYS = {
  enabled: 'payroll_auto_carryover_enabled',
  lastMonth: 'payroll_auto_carryover_last_month',
  lastResult: 'payroll_auto_carryover_last_result',
  changeNoticeLastDay: 'payroll_change_notice_last_day',
  changeNoticeSignatures: 'payroll_change_notice_signatures',
  payReminderLastMonth: 'payroll_pay_reminder_last_month',
} as const


// ─── Clock and due rules (pure) ──────────────────────────────────────────────

export type WarsawClock = { date: string; month: string; day: number; hour: number }

export function warsawClock(now: Date): WarsawClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PAYROLL_AUTOMATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  const date = `${get('year')}-${get('month')}-${get('day')}`
  return { date, month: date.slice(0, 7), day: Number(get('day')), hour: Number(get('hour')) }
}

export function shiftMonthKey(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export type PayrollAutomationSettings = {
  enabled: boolean
  /** Latest month the automat ran for, or was enabled in ("YYYY-MM"). */
  lastMonth: string | null
}

/** The month whose carry-over run is due at `now`, or null. */
export function dueCarryoverMonth(now: Date, settings: PayrollAutomationSettings): string | null {
  if (!settings.enabled || settings.lastMonth === null) return null
  const clock = warsawClock(now)
  if (settings.lastMonth >= clock.month) return null
  if (clock.day === 1 && clock.hour < PAYROLL_CARRYOVER_HOUR) return null
  return clock.month
}

/** The next carry-over run: today (when due and not yet run) or the 1st of the next month; null when off. */
export function nextCarryoverRun(now: Date, settings: PayrollAutomationSettings): { month: string; date: string } | null {
  if (!settings.enabled) return null
  const clock = warsawClock(now)
  const month = settings.lastMonth !== null && settings.lastMonth >= clock.month ? shiftMonthKey(clock.month, 1) : clock.month
  return { month, date: `${month}-01` }
}

/** D10: enabling never runs the current month — the first run is the 1st of the next month. */
export function lastMonthAfterEnabling(now: Date, previous: string | null) {
  const current = warsawClock(now).month
  return previous !== null && previous > current ? previous : current
}

export function isChangeNoticeDue(now: Date, settings: { enabled: boolean; lastDay: string | null }) {
  if (!settings.enabled) return false
  const clock = warsawClock(now)
  return clock.hour >= PAYROLL_CHANGE_NOTICE_HOUR && (settings.lastDay === null || settings.lastDay < clock.date)
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type PayrollAutoCarryoverLastResult = {
  month: string
  ranAt: string
  approved: number
  attention: number
  errors: number
}

async function readSettings(db: PrismaClient) {
  const rows = await db.appSetting.findMany({ where: { key: { in: Object.values(PAYROLL_AUTOMATION_KEYS) } } })
  return new Map(rows.map((row) => [row.key, row.value]))
}

function parseLastResult(value: string | undefined): PayrollAutoCarryoverLastResult | null {
  if (!value) return null
  try {
    return JSON.parse(value) as PayrollAutoCarryoverLastResult
  } catch {
    return null
  }
}

async function writeSettings(db: PrismaClient, values: Record<string, string>) {
  await db.$transaction(Object.entries(values).map(([key, value]) =>
    db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })))
}

/** Compare-and-set of one setting; false when another process changed it first. */
async function claimSetting(db: PrismaClient, key: string, expected: string | null, value: string): Promise<boolean> {
  if (expected === null) {
    try {
      await db.appSetting.create({ data: { key, value } })
      return true
    } catch {
      return false
    }
  }
  const result = await db.appSetting.updateMany({ where: { key, value: expected }, data: { value } })
  return result.count === 1
}

/** Undoes `claimSetting` (only if nobody changed the value since), so the next check can try again. */
async function releaseSetting(db: PrismaClient, key: string, claimed: string, previous: string | null) {
  if (previous === null) await db.appSetting.deleteMany({ where: { key, value: claimed } })
  else await db.appSetting.updateMany({ where: { key, value: claimed }, data: { value: previous } })
}

export type PayrollAutomationStatus = {
  enabled: boolean
  lastMonth: string | null
  nextRun: { month: string; date: string } | null
  /** Where the first run would fall if the automat were switched on now (always next month, D10). */
  firstRunIfEnabled: { month: string; date: string }
  lastResult: PayrollAutoCarryoverLastResult | null
  /** False when the schedule does not run in this process (env switch). */
  schedulerActive: boolean
}

export async function getPayrollAutomationStatus(db: PrismaClient, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<PayrollAutomationStatus> {
  const map = await readSettings(db)
  const settings = { enabled: map.get(PAYROLL_AUTOMATION_KEYS.enabled) === 'true', lastMonth: map.get(PAYROLL_AUTOMATION_KEYS.lastMonth) ?? null }
  return {
    ...settings,
    nextRun: nextCarryoverRun(now, settings),
    firstRunIfEnabled: (() => {
      const month = shiftMonthKey(warsawClock(now).month, 1)
      return { month, date: `${month}-01` }
    })(),
    lastResult: parseLastResult(map.get(PAYROLL_AUTOMATION_KEYS.lastResult)),
    schedulerActive: isPayrollSchedulerEnabledByEnv(env),
  }
}

/** The ADMIN switch. Enabling moves `last_month` to the current month, so nothing runs for it (D10). */
export async function setPayrollAutomationEnabled(db: PrismaClient, enabled: boolean, now = new Date()) {
  const map = await readSettings(db)
  if (enabled) {
    await writeSettings(db, {
      [PAYROLL_AUTOMATION_KEYS.enabled]: 'true',
      [PAYROLL_AUTOMATION_KEYS.lastMonth]: lastMonthAfterEnabling(now, map.get(PAYROLL_AUTOMATION_KEYS.lastMonth) ?? null),
      // The first daily change notice comes the next morning at the earliest, never on the click itself.
      [PAYROLL_AUTOMATION_KEYS.changeNoticeLastDay]: warsawClock(now).date,
    })
  } else {
    await writeSettings(db, { [PAYROLL_AUTOMATION_KEYS.enabled]: 'false' })
  }
  return getPayrollAutomationStatus(db, now)
}

// ─── Runs ────────────────────────────────────────────────────────────────────

/** One month's carry-over as the schedule does it: run, remember the result, notify the ADMINs. */
export async function executePayrollAutoCarryover(db: PrismaClient, period: PayrollPeriod, now = new Date()) {
  const summary = await runPayrollAutoCarryover(db, period)
  const result: PayrollAutoCarryoverLastResult = {
    month: summary.month,
    ranAt: now.toISOString(),
    approved: summary.approved.length,
    attention: summary.attention.length,
    errors: summary.errors.length,
  }
  await writeSettings(db, { [PAYROLL_AUTOMATION_KEYS.lastResult]: JSON.stringify(result) })
  const notified = await notifyPayrollAutoCarryover(db, summary)
  return { summary, notified }
}

/** Changes already notified, per month: { "YYYY-MM": { employeeId: signature } }. */
type NotifiedSignatures = Record<string, Record<string, string>>

function parseSignatures(value: string | undefined): NotifiedSignatures {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as { months?: unknown }
    return typeof parsed.months === 'object' && parsed.months !== null ? parsed.months as NotifiedSignatures : {}
  } catch {
    return {}
  }
}

/**
 * The months the daily notice looks at: the previous and the current one. The previous month is
 * there for what arrives after the month has ended — a change made on its last day (the notice only
 * comes the next morning, already in the new month) or a sick note brought in later.
 */
export function changeNoticeMonths(now: Date): string[] {
  const current = warsawClock(now).month
  return [shiftMonthKey(current, -1), current]
}

/**
 * Notifies the ADMINs once about every new unconfirmed change after approval, one notification per
 * month. A change is identified by its signature; the same, unchanged situation is never notified twice.
 */
export async function sendPayrollChangeNotices(db: PrismaClient, periods: PayrollPeriod[], storedValue: string | undefined) {
  const known = parseSignatures(storedValue)
  const months: NotifiedSignatures = {}
  const total = { pending: 0, fresh: 0, notified: 0 }

  for (const period of periods) {
    const sheet = await getPayrollSheet(db, period)
    const pending = sheet.rows.filter((row) => row.changeAfterApproval !== null)
    const fresh = pending.filter((row) => known[sheet.month]?.[row.employee.id] !== row.changeAfterApproval?.signature)
    if (fresh.length > 0) {
      const people = fresh.map((row) => `${row.employee.lastName} ${row.employee.firstName} (${
        (row.changeAfterApproval?.changes ?? []).map((change) => change.message).join(', ')})`)
      total.notified += await notifyPayrollAdmins(db, {
        type: PAYROLL_CHANGE_NOTIFICATION_TYPE,
        title: `Wynagrodzenia za ${monthNominative(sheet.month)}: zmiana po zatwierdzeniu u ${fresh.length} ${pluralPl(fresh.length, 'osoby', 'osób', 'osób')} — sprawdź kwotę`,
        message: `Zmieniło się: ${people.join('; ')}.`.slice(0, 480),
        link: payrollSheetLink(sheet.month),
      })
    }
    months[sheet.month] = Object.fromEntries(pending.map((row) => [row.employee.id, row.changeAfterApproval?.signature ?? '']))
    total.pending += pending.length
    total.fresh += fresh.length
  }
  await writeSettings(db, { [PAYROLL_AUTOMATION_KEYS.changeNoticeSignatures]: JSON.stringify({ months }) })
  return total
}

export type PayrollAutomationTick = {
  carryover:
    | { ran: false; reason: 'DISABLED' | 'NOT_DUE' | 'CLAIMED_ELSEWHERE' }
    /** The run broke off; the month stays claimed and the ADMINs were told to finish it on the sheet. */
    | { ran: false; reason: 'FAILED'; month: string; message: string }
    | { ran: true; month: string; summary: PayrollAutoCarryoverSummary }
  changeNotice: { ran: false } | { ran: true; pending: number; fresh: number; notified: number }
  payReminder:
    | { ran: false }
    /** Sending failed before anything was sent; the slot was released and the next check tries again. */
    | { ran: false; reason: 'FAILED'; month: string; message: string }
    | { ran: true; month: string; unapproved: number; notified: number }
}

/** One scheduler check; safe to call repeatedly. */
export async function runDuePayrollAutomation(db: PrismaClient, now = new Date()): Promise<PayrollAutomationTick> {
  const map = await readSettings(db)
  const enabled = map.get(PAYROLL_AUTOMATION_KEYS.enabled) === 'true'
  const storedLastMonth = map.get(PAYROLL_AUTOMATION_KEYS.lastMonth) ?? null
  const tick: PayrollAutomationTick = {
    carryover: { ran: false, reason: enabled ? 'NOT_DUE' : 'DISABLED' },
    changeNotice: { ran: false },
    payReminder: { ran: false },
  }

  if (enabled && storedLastMonth === null) {
    // Switched on without a month (not via the API): treat it as enabled now, never run the current month.
    await claimSetting(db, PAYROLL_AUTOMATION_KEYS.lastMonth, null, warsawClock(now).month)
  }

  const month = dueCarryoverMonth(now, { enabled, lastMonth: storedLastMonth })
  const period = month ? parsePayrollMonth(month) : null
  if (month && period) {
    // Claim the month before the run so a crash mid-run never approves twice or loops.
    if (await claimSetting(db, PAYROLL_AUTOMATION_KEYS.lastMonth, storedLastMonth, month)) {
      try {
        const { summary } = await executePayrollAutoCarryover(db, period, now)
        tick.carryover = { ran: true, month, summary }
      } catch (error) {
        // The month stays claimed, so a failing run can neither loop nor approve anyone twice; whoever
        // was approved before the failure stays approved. A silent skip would leave the month
        // unapproved without anyone knowing, so the ADMINs are told to finish it on the sheet.
        await notifyPayrollAdmins(db, { type: PAYROLL_AUTO_NOTIFICATION_TYPE, ...carryoverFailureNotification(month) }).catch(() => 0)
        tick.carryover = { ran: false, reason: 'FAILED', month, message: error instanceof Error ? error.message : 'unknown' }
      }
    } else {
      tick.carryover = { ran: false, reason: 'CLAIMED_ELSEWHERE' }
    }
  }

  const lastDay = map.get(PAYROLL_AUTOMATION_KEYS.changeNoticeLastDay) ?? null
  if (isChangeNoticeDue(now, { enabled, lastDay })) {
    const periods = changeNoticeMonths(now).map(parsePayrollMonth).filter((value): value is PayrollPeriod => value !== null)
    if (periods.length > 0 && await claimSetting(db, PAYROLL_AUTOMATION_KEYS.changeNoticeLastDay, lastDay, warsawClock(now).date)) {
      const result = await sendPayrollChangeNotices(db, periods, map.get(PAYROLL_AUTOMATION_KEYS.changeNoticeSignatures))
      tick.changeNotice = { ran: true, ...result }
    }
  }

  // Independent of `enabled` — see the header comment.
  const reminderLastMonth = map.get(PAYROLL_AUTOMATION_KEYS.payReminderLastMonth) ?? null
  const reminderMonth = duePayReminderMonth(warsawClock(now), reminderLastMonth)
  const reminderPeriod = reminderMonth ? parsePayrollMonth(reminderMonth) : null
  if (reminderMonth && reminderPeriod
    && await claimSetting(db, PAYROLL_AUTOMATION_KEYS.payReminderLastMonth, reminderLastMonth, reminderMonth)) {
    try {
      const result = await sendPayrollPayReminder(db, reminderPeriod)
      tick.payReminder = { ran: true, ...result }
    } catch (error) {
      // The notification insert is the last step, so nothing was sent: release the month and let the
      // next check (5 minutes later, until the month ends) try again instead of silently skipping it.
      await releaseSetting(db, PAYROLL_AUTOMATION_KEYS.payReminderLastMonth, reminderMonth, reminderLastMonth).catch(() => undefined)
      tick.payReminder = { ran: false, reason: 'FAILED', month: reminderMonth, message: error instanceof Error ? error.message : 'unknown' }
    }
  }
  return tick
}

const SCHEDULER_STARTED = Symbol.for('walldecor.payrollAutomationStarted')

/** Starts the in-process scheduler once per server process. */
export function startPayrollAutomationScheduler(db: PrismaClient) {
  const holder = globalThis as { [SCHEDULER_STARTED]?: boolean }
  if (holder[SCHEDULER_STARTED]) return
  holder[SCHEDULER_STARTED] = true

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const outcome = await runDuePayrollAutomation(db)
      if (outcome.carryover.ran) {
        const { summary } = outcome.carryover
        console.info(JSON.stringify({
          event: 'PAYROLL_AUTO_CARRYOVER',
          month: summary.month,
          approved: summary.approved.length,
          attention: summary.attention.length,
          errors: summary.errors.length,
        }))
      } else if (outcome.carryover.reason === 'FAILED') {
        console.error(JSON.stringify({ event: 'PAYROLL_AUTO_CARRYOVER_FAILED', month: outcome.carryover.month, message: outcome.carryover.message }))
      }
      if (outcome.changeNotice.ran) console.info(JSON.stringify({ event: 'PAYROLL_CHANGE_NOTICE', ...outcome.changeNotice }))
      if (outcome.payReminder.ran) console.info(JSON.stringify({ event: 'PAYROLL_PAY_REMINDER', ...outcome.payReminder }))
      else if ('reason' in outcome.payReminder) {
        console.error(JSON.stringify({ event: 'PAYROLL_PAY_REMINDER_FAILED', month: outcome.payReminder.month, message: outcome.payReminder.message }))
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'PAYROLL_AUTOMATION_FAILED', message: error instanceof Error ? error.message : 'unknown' }))
    } finally {
      running = false
    }
  }

  setTimeout(() => { void tick() }, FIRST_CHECK_DELAY_MS).unref()
  setInterval(() => { void tick() }, CHECK_INTERVAL_MS).unref()
}
