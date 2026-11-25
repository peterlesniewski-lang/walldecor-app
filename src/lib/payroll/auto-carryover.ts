import type { Prisma, PrismaClient } from '@/generated/prisma'
import { monthNominative } from './month-names'
import { payrollMonthKey, type PayrollPeriod } from './period'
import { getPayrollSheet, settleEmployeeMonth, sheetRowResultFromError, type PayrollSheetRow } from './service'
import { PAYROLL_SYSTEM_ACTOR_ID } from './system-actor'

// Automat 1. dnia miesiąca (D1, D8, D11): approves, for one month, every person on the month sheet who
// has no settlement of any kind yet and whose row is `autoEligible` (stage 1 encodes every D8 rule
// there). Amounts are the row's suggestion; the approval goes through settleEmployeeMonth, i.e. the
// same create → confirm → approve steps and audit events as the sheet, in one transaction per person.
// It never opens a correction (D9) and never touches a person who already has a settlement.

type Db = PrismaClient | Prisma.TransactionClient

export type CarryoverPerson = { employeeId: string; name: string }

export type PayrollAutoCarryoverSummary = {
  month: string
  /** Approved now by the automat. */
  approved: Array<CarryoverPerson & { settlementId: string; versionNumber: number }>
  /** Left for the ADMIN, with the reasons shown on the sheet (flags, blockers, a draft in progress). */
  attention: Array<CarryoverPerson & { reasons: string[] }>
  /** Already had an approved settlement (e.g. approved by hand, or by an earlier run). Untouched. */
  alreadySettled: CarryoverPerson[]
  /** Unexpected failures; also left for the ADMIN. */
  errors: Array<CarryoverPerson & { message: string }>
}

export function carryoverApprovalNote(sourceMonth: string) {
  return `Automatyczne przeniesienie z ${sourceMonth}`
}

function personOf(row: PayrollSheetRow): CarryoverPerson {
  return { employeeId: row.employee.id, name: `${row.employee.lastName} ${row.employee.firstName}` }
}

function attentionReasons(row: PayrollSheetRow): string[] {
  const reasons = [...row.flags.map((flag) => flag.message), ...row.blockers.map((blocker) => blocker.message)]
  return reasons.length > 0 ? reasons : ['wymaga ręcznego zatwierdzenia']
}

export async function runPayrollAutoCarryover(db: PrismaClient, period: PayrollPeriod): Promise<PayrollAutoCarryoverSummary> {
  const sheet = await getPayrollSheet(db, period)
  const summary: PayrollAutoCarryoverSummary = { month: payrollMonthKey(period), approved: [], attention: [], alreadySettled: [], errors: [] }

  for (const row of sheet.rows) {
    const person = personOf(row)
    if (row.settlement) {
      if (row.settlement.status === 'APPROVED') summary.alreadySettled.push(person)
      else summary.attention.push({ ...person, reasons: ['rozliczenie robocze czeka na dokończenie'] })
      continue
    }
    if (!row.autoEligible || !row.suggestion) {
      summary.attention.push({ ...person, reasons: attentionReasons(row) })
      continue
    }

    const suggestion = row.suggestion
    try {
      const result = await settleEmployeeMonth(db, PAYROLL_SYSTEM_ACTOR_ID, {
        employeeId: person.employeeId,
        period,
        finalGross: suggestion.finalGrossGrosze,
        finalNet: suggestion.finalNetGrosze,
        // D11: a manually entered source cost is copied; a calculated one is recalculated by the server.
        employerCost: suggestion.employerCostSource === 'OVERRIDDEN' ? suggestion.employerCostGrosze : null,
        origin: 'AUTO_CARRYOVER',
        approvalNote: carryoverApprovalNote(suggestion.sourceMonth),
      })
      summary.approved.push({ ...person, settlementId: result.settlementId, versionNumber: result.versionNumber })
    } catch (error) {
      const outcome = sheetRowResultFromError(person.employeeId, error)
      if (outcome.status === 'BLOCKED') {
        summary.attention.push({ ...person, reasons: outcome.blockers.map((blocker) => blocker.message) })
      } else if (outcome.status === 'CONFLICT') {
        // A settlement appeared between reading the sheet and approving: it belongs to the ADMIN.
        summary.attention.push({ ...person, reasons: ['rozliczenie powstało w trakcie przebiegu — sprawdź je ręcznie'] })
      } else if (outcome.status === 'INVALID') {
        summary.errors.push({ ...person, message: outcome.message })
      }
    }
  }
  return summary
}

// ─── Notifications ───────────────────────────────────────────────────────────

/** Polish noun/adjective form for a count: 1 → one, 2–4 (not 12–14) → few, otherwise → many. */
export function pluralPl(count: number, one: string, few: string, many: string) {
  if (count === 1) return one
  const lastDigit = count % 10
  const lastTwo = count % 100
  return lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many
}

export function payrollSheetLink(month: string) {
  return `/hr/payroll?month=${month}`
}

export const PAYROLL_AUTO_NOTIFICATION_TYPE = 'payroll_auto'
export const PAYROLL_CHANGE_NOTIFICATION_TYPE = 'payroll_change'

const MESSAGE_LIMIT = 480

function clip(text: string) {
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text
}

/** "Wynagrodzenia za grudzień: 3 zatwierdzone automatycznie, 2 wymagają uwagi" */
export function carryoverNotification(summary: PayrollAutoCarryoverSummary) {
  const approved = summary.approved.length
  const attention = summary.attention.length + summary.errors.length
  const title = `Wynagrodzenia za ${monthNominative(summary.month)}: `
    + `${approved} ${pluralPl(approved, 'zatwierdzone', 'zatwierdzone', 'zatwierdzonych')} automatycznie, `
    + `${attention} ${pluralPl(attention, 'wymaga', 'wymagają', 'wymaga')} uwagi`
  const people = [
    ...summary.attention.map((person) => `${person.name} — ${person.reasons[0]}`),
    ...summary.errors.map((person) => `${person.name} — ${person.message}`),
  ]
  const message = people.length > 0
    ? `Wymagają uwagi: ${people.join('; ')}.`
    : 'Wszystkie osoby ze stałą pensją zostały zatwierdzone.'
  return { title, message: clip(message), link: payrollSheetLink(summary.month) }
}

/**
 * The run broke off before it finished (e.g. the database did not answer). It is not repeated for
 * that month, so the ADMIN has to approve whoever is left on the sheet.
 */
export function carryoverFailureNotification(month: string) {
  return {
    title: `Wynagrodzenia za ${monthNominative(month)}: automat nie dokończył przebiegu`,
    message: 'Część osób mogła zostać bez zatwierdzenia. Otwórz arkusz miesiąca i zatwierdź brakujące osoby — automat nie powtórzy przebiegu za ten miesiąc.',
    link: payrollSheetLink(month),
  }
}

/** Creates one notification per active ADMIN; MANAGER, EMPLOYEE and INSTALLER never receive payroll data. */
export async function notifyPayrollAdmins(db: Db, notification: { type: string; title: string; message: string; link: string }) {
  const admins = await db.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } })
  if (admins.length === 0) return 0
  await db.notification.createMany({
    data: admins.map((admin) => ({ userId: admin.id, ...notification, isRead: false })),
  })
  return admins.length
}

/** A run that approved nothing and has nobody needing attention sends nothing (task 6). */
export async function notifyPayrollAutoCarryover(db: Db, summary: PayrollAutoCarryoverSummary) {
  if (summary.approved.length === 0 && summary.attention.length === 0 && summary.errors.length === 0) return 0
  return notifyPayrollAdmins(db, { type: PAYROLL_AUTO_NOTIFICATION_TYPE, ...carryoverNotification(summary) })
}
