import type { Prisma, PrismaClient } from '@/generated/prisma'
import { getWarsawBusinessDate } from '@/lib/hr/business-date'
import { getMonthlyEmployerCosts } from '@/lib/payroll/contracts'
import { KSEF_COST_EVENT_START_MONTH, KSEF_COST_EVENT_START_YEAR, type RealizedEmployerCostInput } from './realized-costs'

type Db = PrismaClient | Prisma.TransactionClient

/** One person's employer cost in one salon and month (PLN). Server-side only: carries employeeId. */
export type EmployerCostRow = RealizedEmployerCostInput & { employeeId: string }

export type EmployerCostYear = {
  rows: EmployerCostRow[]
  /** People in payroll whose cost could not be estimated (no base salary, hourly base, no split). */
  missingByMonth: number[]
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
  for (const records of perMonth) {
    for (const record of records) {
      if (record.status === 'MISSING') {
        missingByMonth[record.month - 1] += 1
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
  return { rows, missingByMonth }
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
