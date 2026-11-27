import type { PrismaClient } from '@/generated/prisma'
import { payrollMonthKey } from '@/lib/payroll/period'
import { getPayrollSheet, getSettlementDetail } from '@/lib/payroll/service'

/**
 * What the settlement detail page loads: the settlement itself plus the month-sheet view of the same
 * person (suggestion, hours calculation, notes) and the month's payroll list number. The sheet row is
 * produced by the same function the month sheet uses, so the page can never suggest other figures
 * than the sheet does; nothing here is stored.
 */
export async function getSettlementPageData(db: PrismaClient, id: string) {
  const detail = await getSettlementDetail(db, id)
  const period = { year: detail.year, month: detail.month }
  const sheet = await getPayrollSheet(db, period)
  const row = sheet.rows.find((candidate) => candidate.employee.id === detail.employeeId) ?? null
  return {
    ...detail,
    monthKey: payrollMonthKey(period),
    listReference: sheet.listReference,
    sheetRow: row
      ? {
        suggestion: row.suggestion,
        hours: row.hours,
        flags: row.flags,
      }
      : null,
  }
}

export type SettlementPageData = Awaited<ReturnType<typeof getSettlementPageData>>
