import { roundMoney } from '@/lib/finance/ksef-inbox'
import type {
  BreakEvenFixedCost, BreakEvenFixedCostMatch, BreakEvenHistoricalSuggestion, BreakEvenMarginSetting,
  BreakEvenReport, BreakEvenRevenueBasis, BreakEvenSalon, BreakEvenSalonReport, BreakEvenSource,
} from './break-even-types'

export const BREAK_EVEN_SALONS: BreakEvenSalon[] = ['JAG', 'PUL']
export function breakEvenPeriod(year: number, month: number) { return `${year}-${String(month).padStart(2, '0')}` }
export function isFixedCostActive(cost: BreakEvenFixedCost, period: string) {
  return cost.active && cost.effectiveFrom <= period && (!cost.effectiveTo || cost.effectiveTo >= period)
}
export function resolveBreakEvenMargin(settings: BreakEvenMarginSetting[], period: string) {
  return settings.filter((setting) => setting.effectiveFrom.slice(0, 7) <= period && Number.isFinite(setting.margin) && setting.margin > 0 && setting.margin <= 1)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
}
export function resolveRevenueNet(gross: number, basis: BreakEvenRevenueBasis | null) {
  if (!basis || !Number.isFinite(basis.netAmount) || basis.netAmount < 0 || Math.round(gross * 100) !== Math.round(basis.grossAmountSnapshot * 100)) return null
  if (gross < 0 || basis.netAmount > gross + 0.011 || (gross > 0 && basis.netAmount === 0)) return null
  return roundMoney(basis.netAmount)
}
const has = (source: BreakEvenSource, tags: string[]) => tags.some((tag) => source.tags.includes(tag))
export const isPurchaseSource = (source: BreakEvenSource) => has(source, ['goods', 'cogs'])
export const isVariableSource = (source: BreakEvenSource) => has(source, ['variable']) && !has(source, ['goods', 'cogs', 'one-off', 'payroll'])
export const isFixedSource = (source: BreakEvenSource) => has(source, ['fixed']) && !has(source, ['goods', 'cogs', 'one-off', 'payroll'])
export function canMatchFixedCostSource(tags: string[]) {
  return !tags.some((tag) => ['goods', 'cogs', 'one-off', 'payroll', 'variable'].includes(tag))
}
const sourceKey = (source: { partId: string; costCenterId: string }) => `${source.partId}:${source.costCenterId}`

export interface BreakEvenCalculationInput {
  year: number; month: number; margins: BreakEvenMarginSetting[]; fixedCosts: BreakEvenFixedCost[];
  matches: BreakEvenFixedCostMatch[]; revenue: Array<{ costCenterId: string; amount: number }>;
  revenueBases: BreakEvenRevenueBasis[]; sources: BreakEvenSource[]; sourceWarnings?: string[];
  historicalSuggestion: BreakEvenHistoricalSuggestion; warningSummary: BreakEvenReport['warningSummary'];
}

export function calculateBreakEven(input: BreakEvenCalculationInput): BreakEvenReport {
  const period = breakEvenPeriod(input.year, input.month)
  const margin = resolveBreakEvenMargin(input.margins, period)
  const sources = new Map(input.sources.map((source) => [sourceKey(source), source]))
  const matches = input.matches.filter((match) => match.year === input.year && match.month === input.month)
  const globalSources = input.sources.filter((source) => source.costCenterId === 'GLOBAL')
  const warnings = [...(input.sourceWarnings ?? [])]
  if (globalSources.length) warnings.push(`Koszty GLOBAL poza progami salonów: ${globalSources.length} pozycji. Wymagają przypisania do salonu.`)
  if (!margin) warnings.push('Brak wspólnej marży obowiązującej w wybranym miesiącu.')
  const byCostCenter = Object.fromEntries(BREAK_EVEN_SALONS.map((center): [BreakEvenSalon, BreakEvenSalonReport] => {
    const centerWarnings: string[] = []
    const revenueRows = input.revenue.filter((row) => row.costCenterId === center)
    const revenueGross = roundMoney(revenueRows.reduce((sum, row) => sum + row.amount, 0))
    const revenueBasis = input.revenueBases.find((basis) => basis.costCenterId === center && basis.year === input.year && basis.month === input.month) ?? null
    const revenueNet = revenueRows.length ? resolveRevenueNet(revenueGross, revenueBasis) : null
    if (revenueNet === null) centerWarnings.push(revenueBasis && Math.round(revenueBasis.grossAmountSnapshot * 100) !== Math.round(revenueGross * 100)
      ? 'Obrót brutto zmienił się po zapisaniu podstawy netto. Uzupełnij aktualny obrót netto.'
      : 'Brak potwierdzonego obrotu netto dla bieżącego obrotu brutto. Próg brutto i wynik są niedostępne.')
    const matchedKeys = new Set<string>()
    const fixedCosts = input.fixedCosts.filter((cost) => cost.costCenterId === center && isFixedCostActive(cost, period)).map((cost) => {
      const costMatches = matches.filter((match) => match.fixedCostId === cost.id && match.costCenterId === center)
      let actual = 0
      let invalid = false
      let netEstimated = false
      for (const match of costMatches) {
        const key = `${match.costEventPartId}:${center}`
        const source = sources.get(key)
        const net = match.actualNetAmount ?? source?.netAmount
        if (!source || !source.sourceInvoiceId || !canMatchFixedCostSource(source.tags) || net == null || !Number.isFinite(net) || Math.abs(net) > Math.abs(source.grossAmount) + 0.011 || (net !== 0 && Math.sign(net) !== Math.sign(source.grossAmount)) || matchedKeys.has(key)) { invalid = true; continue }
        matchedKeys.add(key)
        if (!source.tags.includes('fixed')) centerWarnings.push(`${cost.name}: wybrana część faktury nie ma potwierdzonej klasyfikacji jako koszt stały. Uwzględniono ją na podstawie ręcznego przypisania; potwierdź klasyfikację.`)
        actual += net
        netEstimated ||= match.actualNetAmount == null && source.netEstimated
      }
      if (invalid) centerWarnings.push(`${cost.name}: powiązana faktura jest niedostępna, zdublowana lub nie ma kwoty netto. Kwota oczekiwana pozostaje w raporcie; wymaga sprawdzenia.`)
      if (netEstimated) centerWarnings.push(`${cost.name}: netto części faktury rozdzielono proporcjonalnie do brutto. Zweryfikuj przy różnych stawkach VAT.`)
      const actualNetAmount = costMatches.length && !invalid ? roundMoney(actual) : null
      return { id: cost.id, name: cost.name, expectedNetAmount: cost.expectedNetAmount, actualNetAmount,
        includedNetAmount: actualNetAmount ?? cost.expectedNetAmount,
        status: invalid ? 'invalid' as const : actualNetAmount !== null ? 'actual' as const : 'expected' as const,
        netEstimated, matches: costMatches }
    })
    const centerSources = input.sources.filter((source) => source.costCenterId === center)
    const variableSources = centerSources.filter((source) => isVariableSource(source) && !matchedKeys.has(sourceKey(source)))
    const omittedFixed = centerSources.filter((source) => isFixedSource(source) && !matchedKeys.has(sourceKey(source)))
    const unknownVariable = variableSources.some((source) => source.netAmount == null)
    const variableNet = roundMoney(variableSources.reduce((sum, source) => sum + (source.netAmount ?? 0), 0))
    if (unknownVariable) centerWarnings.push('Część kosztów zmiennych nie ma kwoty netto. Próg jest niedostępny do ich uzupełnienia.')
    if (variableSources.some((source) => source.netEstimated)) centerWarnings.push('Netto części kosztów zmiennych rozdzielono proporcjonalnie do brutto; wymaga weryfikacji przy mieszanym VAT.')
    if (omittedFixed.length) centerWarnings.push(`Niepowiązane koszty oznaczone jako stałe: ${omittedFixed.length}. Nie są dodane do wybranych kosztów stałych.`)
    if (!fixedCosts.length) centerWarnings.push('Brak wybranych pozycji kosztów stałych. Wybierz koszty przed oceną progu.')
    const unclassified = centerSources.filter((source) => !matchedKeys.has(sourceKey(source)) && !has(source, ['fixed', 'variable', 'goods', 'cogs', 'one-off', 'payroll']))
    if (unclassified.length) centerWarnings.push(`Pozycje bez klasyfikacji kosztu: ${unclassified.length}. Nie są uwzględnione w progu.`)
    centerWarnings.push('Brak kompletnego kosztu pracodawcy z HR. Raport nie obejmuje pełnego kosztu salonu.')
    centerWarnings.push('Koszty zmienne obejmują tylko dokumenty ujęte w tym miesiącu; przyszłe koszty zmienne są nieznane.')
    const actualFixedNet = roundMoney(fixedCosts.filter((row) => row.actualNetAmount !== null).reduce((sum, row) => sum + row.includedNetAmount, 0))
    const expectedFixedNet = roundMoney(fixedCosts.filter((row) => row.actualNetAmount === null).reduce((sum, row) => sum + row.includedNetAmount, 0))
    const fixedNet = roundMoney(actualFixedNet + expectedFixedNet)
    const canCalculate = margin !== null && fixedCosts.length > 0 && !unknownVariable && !fixedCosts.some((row) => row.status === 'invalid')
    const targetNet = canCalculate ? roundMoney((fixedNet + variableNet) / margin.margin) : null
    const fixedOnlyTargetNet = margin && fixedCosts.length > 0 ? roundMoney(fixedNet / margin.margin) : null
    const ratio = revenueNet !== null && revenueNet > 0 && revenueGross > 0 ? revenueGross / revenueNet : null
    const targetGross = targetNet !== null && ratio !== null ? roundMoney(targetNet * ratio) : null
    return [center, { costCenterId: center, revenueGross, revenueNet, revenueBasis, fixedCosts, expectedFixedNet, actualFixedNet, fixedNet,
      variableNet, fixedOnlyTargetNet, targetNet, targetGross, deltaGross: targetGross !== null ? roundMoney(revenueGross - targetGross) : null,
      operatingResultNet: revenueNet !== null && margin && canCalculate ? roundMoney(revenueNet * margin.margin - fixedNet - variableNet) : null,
      omittedFixedCount: omittedFixed.length, omittedFixedNet: roundMoney(omittedFixed.reduce((sum, source) => sum + (source.netAmount ?? 0), 0)),
      goodsNet: roundMoney(centerSources.filter(isPurchaseSource).reduce((sum, source) => sum + (source.netAmount ?? 0), 0)),
      oneOffNet: roundMoney(centerSources.filter((source) => has(source, ['one-off'])).reduce((sum, source) => sum + (source.netAmount ?? 0), 0)),
      hr: { status: 'missing', amount: null }, status: 'provisional', warnings: centerWarnings }]
  })) as Record<BreakEvenSalon, BreakEvenSalonReport>
  return { year: input.year, month: input.month, margin, byCostCenter, historicalSuggestion: input.historicalSuggestion,
    warnings, warningAmount: input.warningSummary.plnAmount, warningSummary: input.warningSummary }
}

export function calculateHistoricalSuggestion(months: Array<{
  period: string; revenue: Array<{ costCenterId: string; amount: number }>; bases: BreakEvenRevenueBasis[];
  sources: BreakEvenSource[]; warnings: string[];
}>): BreakEvenHistoricalSuggestion {
  let revenueNet = 0
  let purchasesNet = 0
  const warnings: string[] = []
  if (months.length < 3) warnings.push('Sugestia wymaga trzech zakończonych miesięcy.')
  for (const month of months) {
    warnings.push(...month.warnings.map((warning) => `${month.period}: ${warning}`))
    for (const center of BREAK_EVEN_SALONS) {
      const rows = month.revenue.filter((row) => row.costCenterId === center)
      const gross = roundMoney(rows.reduce((sum, row) => sum + row.amount, 0))
      const basis = month.bases.find((row) => row.costCenterId === center) ?? null
      const net = rows.length ? resolveRevenueNet(gross, basis) : null
      if (net === null) warnings.push(`${month.period} ${center}: brak aktualnej podstawy obrotu netto.`)
      else revenueNet += net
    }
    const purchases = month.sources.filter(isPurchaseSource)
    if (!purchases.length) warnings.push(`${month.period}: brak sklasyfikowanych zakupów towarów; nie zakładamy zerowego kosztu zakupów.`)
    if (month.sources.some((source) => !has(source, ['fixed', 'variable', 'goods', 'cogs', 'one-off', 'payroll']))) warnings.push(`${month.period}: niesklasyfikowane koszty mogą zawierać zakup towarów.`)
    for (const source of purchases) {
      if (source.netAmount === null) warnings.push(`${month.period}: zakup ${source.title} bez kwoty netto PLN.`)
      else purchasesNet += source.netAmount
      if (source.netEstimated) warnings.push(`${month.period}: netto zakupu ${source.title} wymaga potwierdzenia podziału VAT.`)
    }
  }
  if (revenueNet <= 0) warnings.push('Brak dodatniego obrotu netto do wyznaczenia sugestii.')
  return { status: warnings.length ? 'incomplete' : 'available', margin: warnings.length || revenueNet <= 0 ? null : (revenueNet - purchasesNet) / revenueNet,
    revenueNet: roundMoney(revenueNet), purchasesNet: roundMoney(purchasesNet), months: months.map((month) => month.period), warnings: [...new Set(warnings)] }
}

export function parseBreakEvenPeriod(search: URLSearchParams, now = new Date()) {
  const year = Number(search.get('year') ?? now.getFullYear())
  const month = Number(search.get('month') ?? now.getMonth() + 1)
  return Number.isInteger(year) && year >= 2020 && year <= 2100 && Number.isInteger(month) && month >= 1 && month <= 12 ? { year, month } : null
}
