import { resolveRevenueNet } from '@/lib/finance/break-even-engine'
import { FINANCE_COST_CENTERS, type FinanceCostCenterId } from '@/lib/finance/company-health'
import { roundMoney } from '@/lib/finance/ksef-inbox'
import type { RealizedCostEventInput } from '@/lib/finance/realized-costs'

export interface DashboardRevenueBasis {
  year: number
  month: number
  costCenterId: string
  netAmount: number
  grossAmountSnapshot: number
}

export interface DashboardCostEvent extends RealizedCostEventInput {
  currency?: string
  grossAmount?: number
  netAmount?: number | null
  vatAmount?: number | null
}

export type RevenueNetStatus = 'none' | 'confirmed' | 'missing' | 'stale' | 'unsupported'
export type CostNetStatus = 'none' | 'confirmed' | 'uncertain'

export interface RevenueNetGap {
  costCenterId: string
  status: 'missing' | 'stale' | 'unsupported'
  gross: number
}

export interface CenterNet {
  costCenterId: FinanceCostCenterId
  revenueNet: number | null
  revenueGross: number | null
  revenueStatus: RevenueNetStatus
  costsNet: number | null
  costsStatus: CostNetStatus
  resultNet: number | null
}

export interface MonthNet {
  revenueNet: number | null
  costsNet: number | null
  resultNet: number | null
  revenueNetComplete: boolean
  costsNetComplete: boolean
  knownDocumentNet: number | null
  missingNetDocumentCount: number
  foreignDocumentCount: number
  legacyCostUncertain: boolean
  payrollDocumentsIncluded: boolean
  gaps: RevenueNetGap[]
  centers: CenterNet[]
  /** Drawn bar. Future months stay empty even when a figure could be computed. */
  chartValue: number | null
}

interface RevenueRow {
  costCenterId: string
  amount: number
}

function tagSlug(tag: { slug?: string | null; tag?: { slug?: string | null } }) {
  return (tag.tag?.slug ?? tag.slug ?? '').toLowerCase()
}

function validMoneyPair(gross: number, net: number) {
  if (!Number.isFinite(gross) || !Number.isFinite(net)) return false
  if (Math.abs(net) > Math.abs(gross) + 0.011) return false
  if (net === 0) return gross === 0
  return Math.sign(net) === Math.sign(gross)
}

/** Stored invoice net, or gross minus a stored VAT amount. Never gross / 1.23. */
export function confirmedDocumentNet(event: Pick<DashboardCostEvent, 'currency' | 'grossAmount' | 'netAmount' | 'vatAmount'>) {
  const currency = (event.currency ?? 'PLN').trim().toUpperCase()
  if (currency !== 'PLN') return { status: 'foreign' as const, net: null }
  if (event.grossAmount == null || !Number.isFinite(event.grossAmount)) return { status: 'missing' as const, net: null }
  const gross = event.grossAmount
  if (event.netAmount != null) {
    return validMoneyPair(gross, event.netAmount)
      ? { status: 'confirmed' as const, net: roundMoney(event.netAmount) }
      : { status: 'missing' as const, net: null }
  }
  if (event.vatAmount != null && Number.isFinite(event.vatAmount)) {
    const derived = roundMoney(gross - event.vatAmount)
    if (validMoneyPair(gross, derived)) return { status: 'confirmed' as const, net: derived }
  }
  return { status: 'missing' as const, net: null }
}

function classifyRevenue(gross: number, basis: DashboardRevenueBasis | null): { status: RevenueNetStatus; net: number | null } {
  if (gross < 0) return { status: 'unsupported', net: null }
  if (!basis) return { status: 'missing', net: null }
  const net = resolveRevenueNet(gross, {
    id: '',
    year: basis.year,
    month: basis.month,
    costCenterId: basis.costCenterId,
    netAmount: basis.netAmount,
    grossAmountSnapshot: basis.grossAmountSnapshot,
  })
  return net === null ? { status: 'stale', net: null } : { status: 'confirmed', net }
}

function emptyCenter(costCenterId: FinanceCostCenterId): CenterNet {
  return {
    costCenterId,
    revenueNet: null,
    revenueGross: null,
    revenueStatus: 'none',
    costsNet: null,
    costsStatus: 'none',
    resultNet: null,
  }
}

export function buildMonthNet(input: {
  year: number
  month: number
  revenueRows: RevenueRow[]
  bases: DashboardRevenueBasis[]
  costEvents: DashboardCostEvent[]
  legacyEntryCount: number
  costsConfirmed: boolean
  futureMonth: boolean
}): MonthNet {
  const gaps: RevenueNetGap[] = []
  const revenueByCenter = new Map<string, number>()
  for (const row of input.revenueRows) {
    revenueByCenter.set(row.costCenterId, roundMoney((revenueByCenter.get(row.costCenterId) ?? 0) + row.amount))
  }

  const centers = FINANCE_COST_CENTERS.map(emptyCenter)
  const centerById = new Map(centers.map((center) => [center.costCenterId, center]))
  let revenueNetComplete = input.revenueRows.length > 0
  let revenueNetSum = 0
  for (const [costCenterId, gross] of revenueByCenter) {
    const basis = input.bases.find((item) => item.year === input.year && item.month === input.month && item.costCenterId === costCenterId) ?? null
    const classified = classifyRevenue(gross, basis)
    const center = centerById.get(costCenterId as FinanceCostCenterId)
    if (center) {
      center.revenueGross = gross
      center.revenueStatus = classified.status
      center.revenueNet = classified.net
    }
    if (classified.status === 'confirmed' && classified.net !== null) revenueNetSum = roundMoney(revenueNetSum + classified.net)
    else {
      revenueNetComplete = false
      if (classified.status === 'missing' || classified.status === 'stale' || classified.status === 'unsupported') {
        gaps.push({ costCenterId, status: classified.status, gross })
      }
    }
  }
  if (!input.revenueRows.length) revenueNetComplete = false

  let known = 0
  let knownCount = 0
  let missingNetDocumentCount = 0
  let foreignDocumentCount = 0
  let payrollDocumentsIncluded = false
  let blockCenters = input.legacyEntryCount > 0
  const allocated = Object.fromEntries(FINANCE_COST_CENTERS.map((center) => [center, 0])) as Record<FinanceCostCenterId, number>
  const touched = Object.fromEntries(FINANCE_COST_CENTERS.map((center) => [center, false])) as Record<FinanceCostCenterId, boolean>

  for (const event of input.costEvents) {
    const document = confirmedDocumentNet(event)
    if (document.status === 'foreign') foreignDocumentCount += 1
    else if (document.status === 'missing' || document.net === null) missingNetDocumentCount += 1
    else {
      known = roundMoney(known + document.net)
      knownCount += 1
    }
    const onlyPart = event.parts.length === 1 ? event.parts[0] : undefined
    const allocationTotal = onlyPart ? onlyPart.allocations.reduce((sum, row) => sum + row.percent, 0) : 0
    const allocationsOk = onlyPart !== undefined
      && Math.abs(allocationTotal - 100) <= 0.01
      && onlyPart.allocations.length > 0
      && onlyPart.allocations.every((row) => Number.isFinite(row.percent) && row.percent > 0 && FINANCE_COST_CENTERS.includes(row.costCenterId as FinanceCostCenterId))
    if (document.status === 'confirmed' && document.net !== null && onlyPart && allocationsOk) {
      for (const allocation of onlyPart.allocations) {
        const costCenterId = allocation.costCenterId as FinanceCostCenterId
        allocated[costCenterId] = roundMoney(allocated[costCenterId] + document.net * allocation.percent / 100)
        touched[costCenterId] = true
      }
    } else blockCenters = true
    if (event.parts.some((item) => item.tags.some((tag) => tagSlug(tag) === 'payroll'))) payrollDocumentsIncluded = true
  }

  const documentsIncomplete = missingNetDocumentCount > 0 || foreignDocumentCount > 0 || input.legacyEntryCount > 0
  const noDocuments = input.costEvents.length === 0 && input.legacyEntryCount === 0
  const costsNetComplete = !documentsIncomplete && (input.costEvents.length > 0 || input.costsConfirmed)
  const costsNet = costsNetComplete ? (input.costEvents.length > 0 ? known : 0) : null

  for (const center of centers) {
    if (blockCenters && (input.costEvents.length > 0 || input.legacyEntryCount > 0)) {
      center.costsStatus = 'uncertain'
      center.costsNet = null
    } else if (costsNetComplete) {
      center.costsStatus = 'confirmed'
      center.costsNet = touched[center.costCenterId] ? allocated[center.costCenterId] : 0
    }
    const revenueForResult = center.revenueStatus === 'confirmed'
      ? center.revenueNet
      : center.revenueStatus === 'none' && center.costCenterId === 'GLOBAL' ? 0 : null
    center.resultNet = revenueForResult !== null && center.costsStatus === 'confirmed' && center.costsNet !== null
      ? roundMoney(revenueForResult - center.costsNet)
      : null
  }

  const revenueNet = revenueNetComplete ? revenueNetSum : null
  const resultNet = revenueNet !== null && costsNet !== null ? roundMoney(revenueNet - costsNet) : null
  return {
    revenueNet,
    costsNet,
    resultNet,
    revenueNetComplete,
    costsNetComplete,
    knownDocumentNet: knownCount > 0 ? known : null,
    missingNetDocumentCount,
    foreignDocumentCount,
    legacyCostUncertain: input.legacyEntryCount > 0,
    payrollDocumentsIncluded,
    gaps,
    centers,
    chartValue: input.futureMonth ? null : resultNet,
  }
}
