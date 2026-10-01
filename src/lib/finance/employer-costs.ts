import type { Prisma, PrismaClient } from '@/generated/prisma'
import { getWarsawBusinessDate } from '@/lib/hr/business-date'
import { getMonthlyEmployerCosts } from '@/lib/payroll/contracts'
import { EMPLOYER_COST_GAP_LABELS } from '@/lib/payroll/employer-cost'
import { KSEF_COST_EVENT_START_MONTH, KSEF_COST_EVENT_START_YEAR, type RealizedEmployerCostInput } from './realized-costs'

type Db = PrismaClient | Prisma.TransactionClient

/** One person's employer cost in one salon and month (PLN). Server-side only: carries employeeId. */
export type EmployerCostRow = RealizedEmployerCostInput & { employeeId: string }

export type EmployerCostYear = {
  rows: EmployerCostRow[]
  /** People in payroll whose cost could not be estimated (no base salary, hourly base, no split). */
  missingByMonth: number[]
  /** The same people, named with the reason ("Jan Kowalski — brak podstawy…"). ADMIN views only. */
  missing: Array<{ month: number; label: string }>
}

export function missingPeopleInMonth(year: EmployerCostYear, month: number): string[] {
  return year.missing.filter((row) => row.month === month).map((row) => row.label)
}

/**
 * Months whose results include employer cost: from the cost-event cutover (April 2026) up to the
 * current month. Future months are never estimated, so a future month shows no invented payroll.
 */
export function employerCostMonthsInScope(year: number, now = new Date()): number[] {
  const today = getWarsawBusinessDate(now)
  const lastMonth = year < today.year ? 12 : year === today.year ? today.month : 0
  const firstMonth = year < KSEF_COST_EVENT_START_YEAR ? 13 : year === KSEF_COST_EVENT_START_YEAR ? KSEF_COST_EVENT_START_MONTH : 1
  return Array.from({ length: 12 }, (_, index) => index + 1).filter((month) => month >= firstMonth && month <= lastMonth)
}

export async function loadEmployerCostsForYear(db: Db, year: number, throughMonth = 12, now = new Date()): Promise<EmployerCostYear> {
  return loadEmployerCostsForMonths(db, year, employerCostMonthsInScope(year, now).filter((month) => month <= throughMonth))
}

/** Callers pass only months in scope (see employerCostMonthsInScope). */
export async function loadEmployerCostsForMonths(db: Db, year: number, months: number[]): Promise<EmployerCostYear> {
  const perMonth = await Promise.all(months.map((month) => getMonthlyEmployerCosts(db, { year, month })))
  const missingByMonth = new Array<number>(12).fill(0)
  const rows: EmployerCostRow[] = []
  const gaps: Array<{ month: number; employeeId: string; gap: string }> = []
  for (const records of perMonth) {
    for (const record of records) {
      if (record.status === 'MISSING') {
        missingByMonth[record.month - 1] += 1
        gaps.push({ month: record.month, employeeId: record.employeeId, gap: record.gap ?? 'BASE_MISSING' })
        continue
      }
      for (const allocation of record.allocations) {
        rows.push({
          employeeId: record.employeeId,
          month: record.month,
          costCenterId: allocation.costCenterId,
          amount: allocation.amountGrosze / 100,
          status: record.status,
        })
      }
    }
  }
  const people = gaps.length
    ? await db.employee.findMany({ where: { id: { in: [...new Set(gaps.map((gap) => gap.employeeId))] } }, select: { id: true, firstName: true, lastName: true } })
    : []
  const nameById = new Map(people.map((person) => [person.id, `${person.firstName} ${person.lastName}`]))
  const missing = gaps.map((gap) => ({
    month: gap.month,
    label: `${nameById.get(gap.employeeId) ?? 'Nieznana osoba'} — ${EMPLOYER_COST_GAP_LABELS[gap.gap] ?? gap.gap}`,
  }))
  return { rows, missingByMonth, missing }
}

/**
 * ADMIN sees employer cost per salon. Other roles never see a single person's pay: when any salon's
 * cost in a month comes from one person, that whole month's employer cost is shown only as a
 * company-level amount (GLOBAL), so no salon figure can be subtracted to reveal it.
 */
export function maskEmployerCostsForRole(rows: EmployerCostRow[], role: string | undefined): EmployerCostRow[] {
  if (role === 'ADMIN') return rows
  const peopleBySalonMonth = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = `${row.month}:${row.costCenterId}`
    const people = peopleBySalonMonth.get(key) ?? new Set<string>()
    people.add(row.employeeId)
    peopleBySalonMonth.set(key, people)
  }
  const exposedMonths = new Set(
    [...peopleBySalonMonth].filter(([, people]) => people.size === 1).map(([key]) => Number(key.split(':')[0]))
  )
  return rows.map((row) => (exposedMonths.has(row.month) ? { ...row, costCenterId: 'GLOBAL' } : row))
}
