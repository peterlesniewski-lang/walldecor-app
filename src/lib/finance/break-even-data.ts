import { prisma } from '@/lib/prisma'
import { buildCostWarningSummary } from './cost-reporting'
import { isActiveInvoiceMoneyRow } from './invoice-money-scope'
import { roundMoney } from './ksef-inbox'
import { breakEvenPeriod, calculateBreakEven, calculateHistoricalSuggestion } from './break-even-engine'
import type { BreakEvenFixedCost, BreakEvenFixedCostMatch, BreakEvenResponse, BreakEvenSourcesResult, BreakEvenSource } from './break-even-types'

export function breakEvenMonthRange(year: number, month: number) {
  return { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) }
}
export interface BreakEvenEventInput {
  id: string; status: string; documentStatus: string; currency: string; grossAmount: number; netAmount: number | null; vatAmount: number | null;
  sourceInvoiceId: string | null; supplierName: string | null; supplierNip: string | null; reference: string | null;
  sourceInvoice: { status: string; documentStatus: string; invoiceImportDraft: { state: string } | null } | null;
  parts: Array<{ id: string; label: string; grossAmount: number; tags: Array<{ tag: { slug: string } }>; allocations: Array<{ costCenterId: string; percent: number }> }>;
}

export function buildBreakEvenSources(events: BreakEvenEventInput[], matches: BreakEvenFixedCostMatch[], year: number, month: number): BreakEvenSourcesResult {
  const sources: BreakEvenSource[] = []
  const warnings: string[] = []
  for (const event of events) {
    if (event.status !== 'APPROVED' || !['ACTIVE', 'CORRECTION'].includes(event.documentStatus)) continue
    if (event.sourceInvoice && (event.sourceInvoice.status !== 'APPROVED' || !['ACTIVE', 'CORRECTION'].includes(event.sourceInvoice.documentStatus) || !isActiveInvoiceMoneyRow(event.sourceInvoice))) continue
    if (event.currency.trim().toUpperCase() !== 'PLN') { warnings.push(`Dokument ${event.reference ?? event.id} nie ma przeliczenia na PLN.`); continue }
    if (event.parts.length === 0) { warnings.push(`Dokument ${event.reference ?? event.id} nie ma podziału i przypisania do salonu.`); continue }
    const totalParts = event.parts.reduce((sum, part) => sum + part.grossAmount, 0)
    if (!Number.isFinite(totalParts) || Math.abs(totalParts - event.grossAmount) > 0.02) { warnings.push(`Dokument ${event.reference ?? event.id} ma niespójny podział kwot.`); continue }
    const candidateNet = event.netAmount ?? (event.vatAmount !== null ? event.grossAmount - event.vatAmount : null)
    const eventNet = candidateNet !== null && Number.isFinite(candidateNet) && Math.abs(candidateNet) <= Math.abs(event.grossAmount) + 0.011 && (candidateNet === 0 || Math.sign(candidateNet) === Math.sign(event.grossAmount)) ? candidateNet : null
    for (const part of event.parts) {
      const totalAllocation = part.allocations.reduce((sum, row) => sum + row.percent, 0)
      if (Math.abs(totalAllocation - 100) > 0.01 || part.allocations.some((row) => !Number.isFinite(row.percent) || row.percent <= 0)) {
        warnings.push(`Część ${part.label} dokumentu ${event.reference ?? event.id} nie ma pełnej alokacji.`)
        continue
      }
      const partNet = eventNet !== null && Number.isFinite(eventNet)
        ? event.parts.length === 1 ? eventNet : event.grossAmount !== 0 ? eventNet * part.grossAmount / event.grossAmount : null
        : null
      for (const allocation of part.allocations) {
        const match = matches.find((row) => row.year === year && row.month === month && row.costEventPartId === part.id && row.costCenterId === allocation.costCenterId)
        sources.push({ partId: part.id, eventId: event.id, sourceInvoiceId: event.sourceInvoiceId,
          title: [event.supplierName, event.reference, part.label].filter(Boolean).join(' · '), supplierName: event.supplierName, supplierNip: event.supplierNip,
          costCenterId: allocation.costCenterId, grossAmount: roundMoney(part.grossAmount * allocation.percent / 100),
          netAmount: partNet !== null ? roundMoney(partNet * allocation.percent / 100) : null,
          netEstimated: event.parts.length > 1, tags: part.tags.map((tag) => tag.tag.slug.toLowerCase()), matchedFixedCostId: match?.fixedCostId ?? null })
      }
    }
  }
  return { year, month, sources, warnings: [...new Set(warnings)] }
}

export async function loadBreakEvenSources(year: number, month: number): Promise<BreakEvenSourcesResult> {
  const [events, matches] = await Promise.all([
    prisma.costEvent.findMany({ where: { status: 'APPROVED', eventDate: breakEvenMonthRange(year, month) },
      include: { sourceInvoice: { select: { status: true, documentStatus: true, invoiceImportDraft: { select: { state: true } } } },
        parts: { include: { tags: { include: { tag: true } }, allocations: true }, orderBy: { order: 'asc' } } },
      orderBy: [{ eventDate: 'desc' }, { id: 'asc' }] }),
    prisma.breakEvenFixedCostMatch.findMany({ where: { year, month } }),
  ])
  return buildBreakEvenSources(events, matches, year, month)
}

async function loadWarningInvoices(year: number, month: number) {
  return prisma.ksefInvoice.findMany({ where: { issueDate: breakEvenMonthRange(year, month) }, select: {
    status: true, documentStatus: true, currency: true, grossAmount: true, reportingGrossAmount: true,
    invoiceImportDraft: { select: { state: true } },
    costEvent: { select: { status: true, documentStatus: true, eventDate: true } },
  } }).then((rows) => rows.filter(isActiveInvoiceMoneyRow))
}

function missingInvoiceCostWarnings(invoices: Awaited<ReturnType<typeof loadWarningInvoices>>, year: number, month: number) {
  const range = breakEvenMonthRange(year, month)
  const missingCount = invoices.filter((invoice) => {
    if (invoice.status !== 'APPROVED') return false
    const event = invoice.costEvent
    return !event || event.status !== 'APPROVED' || !['ACTIVE', 'CORRECTION'].includes(event.documentStatus)
      || !(event.eventDate >= range.gte && event.eventDate < range.lt)
  }).length
  return missingCount ? [`Zatwierdzone faktury bez aktywnego kosztu w wybranym miesiącu: ${missingCount}. Sprawdź powiązanie i datę kosztu.`] : []
}

export async function loadBreakEvenReport(year: number, month: number): Promise<BreakEvenResponse> {
  const [marginRows, fixedRows, matches, revenue, revenueBases, sourceResult, warningInvoices] = await Promise.all([
    prisma.breakEvenMarginSetting.findMany({ orderBy: { effectiveFrom: 'desc' } }),
    prisma.breakEvenFixedCost.findMany({ orderBy: [{ costCenterId: 'asc' }, { name: 'asc' }] }),
    prisma.breakEvenFixedCostMatch.findMany({ where: { year, month } }),
    prisma.revenue.findMany({ where: { year, month, costCenterId: { in: ['JAG', 'PUL'] } } }),
    prisma.breakEvenRevenueBasis.findMany({ where: { year, month } }),
    loadBreakEvenSources(year, month), loadWarningInvoices(year, month),
  ])
  const margins = marginRows.map((row) => ({ id: row.id, margin: row.margin, effectiveFrom: row.effectiveFrom.toISOString().slice(0, 7), note: row.note }))
  const fixedCosts = fixedRows.map((row) => ({ ...row, costCenterId: row.costCenterId as BreakEvenFixedCost['costCenterId'] }))
  const now = new Date()
  // A future report must not call future or still-open calendar months historical.
  const selectedStart = new Date(Date.UTC(year, month - 1, 1))
  const currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const historyEnd = selectedStart < currentStart ? selectedStart : currentStart
  const historicalMonths = await Promise.all([3, 2, 1].map(async (offset) => {
    const date = new Date(Date.UTC(historyEnd.getUTCFullYear(), historyEnd.getUTCMonth() - offset, 1))
    const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1
    const [rows, bases, source, invoices] = await Promise.all([
      prisma.revenue.findMany({ where: { year: y, month: m, costCenterId: { in: ['JAG', 'PUL'] } } }),
      prisma.breakEvenRevenueBasis.findMany({ where: { year: y, month: m } }), loadBreakEvenSources(y, m), loadWarningInvoices(y, m),
    ])
    const warnings = [...source.warnings, ...missingInvoiceCostWarnings(invoices, y, m)]
    if (invoices.some((invoice) => invoice.status !== 'APPROVED')) warnings.push('Nie wszystkie aktywne faktury zostały zatwierdzone i sklasyfikowane.')
    if (invoices.some((invoice) => invoice.currency.trim().toUpperCase() !== 'PLN' && invoice.reportingGrossAmount == null)) warnings.push('Faktury walutowe bez przeliczenia na PLN.')
    return { period: breakEvenPeriod(y, m), revenue: rows, bases, sources: source.sources, warnings }
  }))
  const report = calculateBreakEven({ year, month, margins, fixedCosts, matches, revenue, revenueBases,
    sources: sourceResult.sources, sourceWarnings: [...sourceResult.warnings, ...missingInvoiceCostWarnings(warningInvoices, year, month)],
    historicalSuggestion: calculateHistoricalSuggestion(historicalMonths), warningSummary: buildCostWarningSummary(warningInvoices) })
  return { year, month, report, settings: { margins, fixedCosts } }
}
