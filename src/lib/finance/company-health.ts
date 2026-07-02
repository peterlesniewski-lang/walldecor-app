export const FINANCE_COST_CENTERS = ['JAG', 'PUL', 'GLOBAL'] as const

export type FinanceCostCenterId = (typeof FINANCE_COST_CENTERS)[number]
export type HealthStatus = 'above' | 'even' | 'below'

export interface MonthlyFinanceAmount {
  costCenterId: FinanceCostCenterId
  month: number
  amount: number
}

export interface HealthPeriodResult {
  revenue: number
  expenses: number
  result: number
  breakEvenTarget: number
  breakEvenDelta: number
  status: HealthStatus
}

export interface CostCenterHealth {
  costCenterId: FinanceCostCenterId | 'COMPANY'
  currentMonth: HealthPeriodResult
  ytd: HealthPeriodResult
  monthly: HealthPeriodResult[]
}

export interface CompanyHealth {
  year: number
  currentMonth: number
  company: CostCenterHealth
  byCostCenter: Record<FinanceCostCenterId, CostCenterHealth>
}

export interface BuildCompanyHealthInput {
  year: number
  currentMonth: number
  revenue: MonthlyFinanceAmount[]
  expenses: MonthlyFinanceAmount[]
}

function emptyMonths() {
  return new Array(12).fill(0) as number[]
}

function statusFor(result: number): HealthStatus {
  if (result > 0) return 'above'
  if (result < 0) return 'below'
  return 'even'
}

function resultFor(revenue: number, expenses: number): HealthPeriodResult {
  const result = revenue - expenses
  return {
    revenue,
    expenses,
    result,
    breakEvenTarget: expenses,
    breakEvenDelta: result,
    status: statusFor(result),
  }
}

function sumRange(values: number[], endExclusive: number) {
  return values.slice(0, endExclusive).reduce((sum, value) => sum + value, 0)
}

function buildSeries(
  costCenterId: FinanceCostCenterId | 'COMPANY',
  currentMonth: number,
  revenueByMonth: number[],
  expensesByMonth: number[]
): CostCenterHealth {
  const monthly = revenueByMonth.map((revenue, index) =>
    resultFor(revenue, expensesByMonth[index] ?? 0)
  )

  return {
    costCenterId,
    currentMonth: monthly[currentMonth - 1] ?? resultFor(0, 0),
    ytd: resultFor(sumRange(revenueByMonth, currentMonth), sumRange(expensesByMonth, currentMonth)),
    monthly,
  }
}

export function buildCompanyHealth({
  year,
  currentMonth,
  revenue,
  expenses,
}: BuildCompanyHealthInput): CompanyHealth {
  const byRevenue = Object.fromEntries(
    FINANCE_COST_CENTERS.map((cc) => [cc, emptyMonths()])
  ) as Record<FinanceCostCenterId, number[]>
  const byExpenses = Object.fromEntries(
    FINANCE_COST_CENTERS.map((cc) => [cc, emptyMonths()])
  ) as Record<FinanceCostCenterId, number[]>

  for (const row of revenue) {
    if (row.month >= 1 && row.month <= 12) {
      byRevenue[row.costCenterId][row.month - 1] += row.amount
    }
  }

  for (const row of expenses) {
    if (row.month >= 1 && row.month <= 12) {
      byExpenses[row.costCenterId][row.month - 1] += row.amount
    }
  }

  const byCostCenter = Object.fromEntries(
    FINANCE_COST_CENTERS.map((cc) => [
      cc,
      buildSeries(cc, currentMonth, byRevenue[cc], byExpenses[cc]),
    ])
  ) as Record<FinanceCostCenterId, CostCenterHealth>

  const companyRevenue = emptyMonths()
  const companyExpenses = emptyMonths()
  for (const cc of FINANCE_COST_CENTERS) {
    for (let i = 0; i < 12; i++) {
      companyRevenue[i] += byRevenue[cc][i]
      companyExpenses[i] += byExpenses[cc][i]
    }
  }

  return {
    year,
    currentMonth,
    company: buildSeries('COMPANY', currentMonth, companyRevenue, companyExpenses),
    byCostCenter,
  }
}
