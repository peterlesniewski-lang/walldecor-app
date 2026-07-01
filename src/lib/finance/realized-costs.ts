import {
  FINANCE_COST_CENTERS,
  type FinanceCostCenterId,
  type MonthlyFinanceAmount,
} from '@/lib/finance/company-health'
import { roundMoney } from '@/lib/finance/ksef-inbox'

export const KSEF_COST_EVENT_START_YEAR = 2026
export const KSEF_COST_EVENT_START_MONTH = 4

export interface RealizedActualEntryInput {
  year: number
  month: number
  costCenterId: string
  amount: number
  subCategory: { isFixed: boolean }
}

export interface RealizedCostEventTagInput {
  slug?: string | null
  tag?: { slug?: string | null }
}

export interface RealizedCostEventInput {
  eventDate: Date
  status: string
  parts: Array<{
    grossAmount: number
    tags: RealizedCostEventTagInput[]
    allocations: Array<{ costCenterId: string; percent: number }>
  }>
}

export interface BreakEvenCostRow {
  costCenterId: FinanceCostCenterId
  fixedCosts: number
  variableCosts: number
  cogs: number
}

export interface RealizedCostSummary {
  monthlyRows: MonthlyFinanceAmount[]
  totalCostsByMonth: number[]
  fixedCostsByMonth: number[]
  variableCostsByMonth: number[]
  cogsByMonth: number[]
  costCenterTotals: Record<FinanceCostCenterId, number>
  breakEvenCostRows: BreakEvenCostRow[]
}

type CostBucket = 'fixedCosts' | 'variableCosts' | 'cogs'

function emptyMonths() {
  return new Array(12).fill(0) as number[]
}

function emptyCostCenterTotals() {
  return Object.fromEntries(FINANCE_COST_CENTERS.map((center) => [center, 0])) as Record<
    FinanceCostCenterId,
    number
  >
}

function emptyBreakEvenRows() {
  return Object.fromEntries(
    FINANCE_COST_CENTERS.map((center) => [
      center,
      { costCenterId: center, fixedCosts: 0, variableCosts: 0, cogs: 0 },
    ])
  ) as Record<FinanceCostCenterId, BreakEvenCostRow>
}

function isFinanceCostCenterId(value: string): value is FinanceCostCenterId {
  return FINANCE_COST_CENTERS.includes(value as FinanceCostCenterId)
}

function dateYear(date: Date) {
  return date.getUTCFullYear()
}

function dateMonth(date: Date) {
  return date.getUTCMonth() + 1
}

export function isActualEntryInRealizedCostScope(year: number, month: number) {
  return (
    year < KSEF_COST_EVENT_START_YEAR ||
    (year === KSEF_COST_EVENT_START_YEAR && month < KSEF_COST_EVENT_START_MONTH)
  )
}

export function isCostEventInRealizedCostScope(date: Date) {
  const year = dateYear(date)
  const month = dateMonth(date)
  return (
    year > KSEF_COST_EVENT_START_YEAR ||
    (year === KSEF_COST_EVENT_START_YEAR && month >= KSEF_COST_EVENT_START_MONTH)
  )
}

export function costEventYearDateRange(year: number) {
  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  }
}

function costEventPartBucket(part: { tags: RealizedCostEventTagInput[] }): CostBucket {
  const tagSlugs = part.tags
    .map((item) => item.tag?.slug ?? item.slug)
    .filter((slug): slug is string => Boolean(slug))
    .map((slug) => slug.toLowerCase())

  if (tagSlugs.includes('cogs')) return 'cogs'
  if (tagSlugs.includes('variable')) return 'variableCosts'
  return 'fixedCosts'
}

function addMonthlyAmount(
  rowsByCenterMonth: Map<string, MonthlyFinanceAmount>,
  costCenterId: FinanceCostCenterId,
  month: number,
  amount: number
) {
  const key = `${costCenterId}:${month}`
  const current = rowsByCenterMonth.get(key)
  if (current) {
    current.amount = roundMoney(current.amount + amount)
  } else {
    rowsByCenterMonth.set(key, { costCenterId, month, amount: roundMoney(amount) })
  }
}

export function buildRealizedCostSummary(input: {
  year: number
  actualEntries: RealizedActualEntryInput[]
  costEvents: RealizedCostEventInput[]
}): RealizedCostSummary {
  const rowsByCenterMonth = new Map<string, MonthlyFinanceAmount>()
  const totalCostsByMonth = emptyMonths()
  const fixedCostsByMonth = emptyMonths()
  const variableCostsByMonth = emptyMonths()
  const cogsByMonth = emptyMonths()
  const costCenterTotals = emptyCostCenterTotals()
  const breakEvenByCenter = emptyBreakEvenRows()

  const addCost = (
    costCenterId: FinanceCostCenterId,
    month: number,
    amount: number,
    bucket: CostBucket
  ) => {
    if (month < 1 || month > 12) return

    const roundedAmount = roundMoney(amount)
    const monthIndex = month - 1
    addMonthlyAmount(rowsByCenterMonth, costCenterId, month, roundedAmount)
    costCenterTotals[costCenterId] = roundMoney(costCenterTotals[costCenterId] + roundedAmount)
    totalCostsByMonth[monthIndex] = roundMoney(totalCostsByMonth[monthIndex] + roundedAmount)

    if (bucket === 'fixedCosts') {
      fixedCostsByMonth[monthIndex] = roundMoney(fixedCostsByMonth[monthIndex] + roundedAmount)
      breakEvenByCenter[costCenterId].fixedCosts = roundMoney(
        breakEvenByCenter[costCenterId].fixedCosts + roundedAmount
      )
      return
    }

    if (bucket === 'cogs') {
      cogsByMonth[monthIndex] = roundMoney(cogsByMonth[monthIndex] + roundedAmount)
      variableCostsByMonth[monthIndex] = roundMoney(variableCostsByMonth[monthIndex] + roundedAmount)
      breakEvenByCenter[costCenterId].cogs = roundMoney(breakEvenByCenter[costCenterId].cogs + roundedAmount)
      return
    }

    variableCostsByMonth[monthIndex] = roundMoney(variableCostsByMonth[monthIndex] + roundedAmount)
    breakEvenByCenter[costCenterId].variableCosts = roundMoney(
      breakEvenByCenter[costCenterId].variableCosts + roundedAmount
    )
  }

  for (const entry of input.actualEntries) {
    if (entry.year !== input.year) continue
    if (!isActualEntryInRealizedCostScope(entry.year, entry.month)) continue
    if (!isFinanceCostCenterId(entry.costCenterId)) continue

    addCost(entry.costCenterId, entry.month, entry.amount, entry.subCategory.isFixed ? 'fixedCosts' : 'variableCosts')
  }

  for (const event of input.costEvents) {
    if (event.status !== 'APPROVED') continue
    if (dateYear(event.eventDate) !== input.year) continue
    if (!isCostEventInRealizedCostScope(event.eventDate)) continue

    const month = dateMonth(event.eventDate)
    for (const part of event.parts) {
      const bucket = costEventPartBucket(part)
      for (const allocation of part.allocations) {
        if (!isFinanceCostCenterId(allocation.costCenterId)) continue
        addCost(allocation.costCenterId, month, part.grossAmount * (allocation.percent / 100), bucket)
      }
    }
  }

  const monthlyRows = FINANCE_COST_CENTERS.flatMap((center) =>
    Array.from({ length: 12 }, (_, index) => rowsByCenterMonth.get(`${center}:${index + 1}`)).filter(
      (row): row is MonthlyFinanceAmount => Boolean(row)
    )
  )

  return {
    monthlyRows,
    totalCostsByMonth,
    fixedCostsByMonth,
    variableCostsByMonth,
    cogsByMonth,
    costCenterTotals,
    breakEvenCostRows: FINANCE_COST_CENTERS.map((center) => breakEvenByCenter[center]),
  }
}
