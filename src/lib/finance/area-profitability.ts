import { FINANCE_COST_CENTERS, type FinanceCostCenterId } from '@/lib/finance/company-health'
import { isCostEventInRealizedCostScope } from '@/lib/finance/realized-costs'
import { roundMoney } from '@/lib/finance/ksef-inbox'

export interface AreaTagInput {
  id: string
  slug: string
  name: string
}

export interface AreaRevenueInput {
  year: number
  month: number
  costCenterId: string
  areaTagId: string
  amount: number
}

export interface AreaCostEventInput {
  eventDate: Date
  status: string
  parts: Array<{
    grossAmount: number
    tags: Array<{
      tag: {
        id: string
        slug: string
        name: string
        group?: { slug: string } | null
      }
    }>
    allocations: Array<{ costCenterId: string; percent: number }>
  }>
}

export interface AreaCostCenterAmounts {
  revenue: number
  costs: number
}

export interface AreaProfitabilityRow {
  areaTagId: string
  slug: string
  name: string
  revenue: number
  costs: number
  margin: number
  marginRate: number | null
  byCostCenter: Record<FinanceCostCenterId, AreaCostCenterAmounts>
}

export interface AreaProfitabilityReport {
  year: number
  costCenterId: FinanceCostCenterId | 'COMPANY'
  rows: AreaProfitabilityRow[]
  totals: {
    revenue: number
    costs: number
    margin: number
    marginRate: number | null
  }
  unassignedCosts: number
}

function emptyCostCenterAmounts() {
  return Object.fromEntries(
    FINANCE_COST_CENTERS.map((center) => [center, { revenue: 0, costs: 0 }])
  ) as Record<FinanceCostCenterId, AreaCostCenterAmounts>
}

function isFinanceCostCenterId(value: string): value is FinanceCostCenterId {
  return FINANCE_COST_CENTERS.includes(value as FinanceCostCenterId)
}

function shouldIncludeCostCenter(
  costCenterId: FinanceCostCenterId,
  selected: FinanceCostCenterId | 'COMPANY'
) {
  return selected === 'COMPANY' || selected === costCenterId
}

function marginRate(revenue: number, margin: number) {
  return revenue > 0 ? Math.round((margin / revenue) * 10000) / 10000 : null
}

export function buildAreaProfitabilityReport(input: {
  year: number
  costCenterId?: FinanceCostCenterId | 'COMPANY'
  areaTags: AreaTagInput[]
  revenues: AreaRevenueInput[]
  costEvents: AreaCostEventInput[]
}): AreaProfitabilityReport {
  const selectedCostCenterId = input.costCenterId ?? 'COMPANY'
  const areaTagIds = new Set(input.areaTags.map((tag) => tag.id))
  const rows = new Map<string, AreaProfitabilityRow>()

  for (const tag of input.areaTags) {
    rows.set(tag.id, {
      areaTagId: tag.id,
      slug: tag.slug,
      name: tag.name,
      revenue: 0,
      costs: 0,
      margin: 0,
      marginRate: null,
      byCostCenter: emptyCostCenterAmounts(),
    })
  }

  let unassignedCosts = 0

  for (const revenue of input.revenues) {
    if (revenue.year !== input.year) continue
    if (!isFinanceCostCenterId(revenue.costCenterId)) continue
    if (!shouldIncludeCostCenter(revenue.costCenterId, selectedCostCenterId)) continue

    const row = rows.get(revenue.areaTagId)
    if (!row) continue

    row.revenue = roundMoney(row.revenue + revenue.amount)
    row.byCostCenter[revenue.costCenterId].revenue = roundMoney(
      row.byCostCenter[revenue.costCenterId].revenue + revenue.amount
    )
  }

  for (const event of input.costEvents) {
    if (event.status !== 'APPROVED') continue
    if (event.eventDate.getUTCFullYear() !== input.year) continue
    if (!isCostEventInRealizedCostScope(event.eventDate)) continue

    for (const part of event.parts) {
      const matchingAreaTags = part.tags
        .map((item) => item.tag)
        .filter((tag) => tag.group?.slug === 'area' && areaTagIds.has(tag.id))

      for (const allocation of part.allocations) {
        if (!isFinanceCostCenterId(allocation.costCenterId)) continue
        if (!shouldIncludeCostCenter(allocation.costCenterId, selectedCostCenterId)) continue

        const allocatedAmount = roundMoney(part.grossAmount * (allocation.percent / 100))
        if (matchingAreaTags.length === 0) {
          unassignedCosts = roundMoney(unassignedCosts + allocatedAmount)
          continue
        }

        const areaAmount = roundMoney(allocatedAmount / matchingAreaTags.length)
        for (const tag of matchingAreaTags) {
          const row = rows.get(tag.id)
          if (!row) continue

          row.costs = roundMoney(row.costs + areaAmount)
          row.byCostCenter[allocation.costCenterId].costs = roundMoney(
            row.byCostCenter[allocation.costCenterId].costs + areaAmount
          )
        }
      }
    }
  }

  const finalizedRows = input.areaTags.map((tag) => {
    const row = rows.get(tag.id)
    if (!row) throw new Error(`Missing area row for ${tag.id}`)
    row.margin = roundMoney(row.revenue - row.costs)
    row.marginRate = marginRate(row.revenue, row.margin)
    return row
  })

  const totals = finalizedRows.reduce(
    (sum, row) => ({
      revenue: roundMoney(sum.revenue + row.revenue),
      costs: roundMoney(sum.costs + row.costs),
      margin: roundMoney(sum.margin + row.margin),
      marginRate: null,
    }),
    { revenue: 0, costs: 0, margin: 0, marginRate: null as number | null }
  )
  totals.marginRate = marginRate(totals.revenue, totals.margin)

  return {
    year: input.year,
    costCenterId: selectedCostCenterId,
    rows: finalizedRows,
    totals,
    unassignedCosts,
  }
}
