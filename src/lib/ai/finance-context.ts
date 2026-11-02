import type { ActualDashboardModel, DashboardMonth } from '@/lib/finance/actual-dashboard'
import { KSEF_COST_EVENT_START_MONTH, KSEF_COST_EVENT_START_YEAR } from '@/lib/finance/realized-costs'
import type { SubiektAiBlock } from '@/lib/finance/subiekt-revenue'
import { CHANNEL_LABELS } from '@/lib/validations/revenue'

function centerLabel(id: string) {
  return ({ JAG: 'Salon A', PUL: 'Salon B', GLOBAL: 'Global' } as Record<string, string>)[id] ?? 'Inne centrum'
}

// Explicit projection prevents future additions to the dashboard model from leaking into AI context.
function monthContext(month: DashboardMonth) {
  return {
    month: month.month,
    revenue: month.revenue,
    costs: month.costs,
    result: month.result,
    hasCosts: month.hasCosts,
    periodClosed: month.periodClosed,
    pendingDocumentCount: month.pendingDocumentCount,
    costsConfirmed: month.costsConfirmed,
    complete: month.complete,
    partialMonth: month.partialMonth,
    futureMonth: month.futureMonth,
    channels: month.channels.map((channel) => ({
      costCenter: centerLabel(channel.costCenterId),
      channel: channel.label,
      amount: channel.amount,
      asOfDate: channel.asOfDate,
      status: channel.status,
    })),
  }
}

/** Explicit projection of the Subiekt read; the AI never sees warehouse symbols it cannot act on except in the unmapped warning. */
function subiektContext(block: SubiektAiBlock | null | undefined) {
  if (!block) return null
  return {
    fetchedAt: block.fetchedAt,
    lastError: block.lastError,
    months: block.months.map((row) => ({
      year: row.year,
      month: row.month,
      costCenter: centerLabel(row.costCenterId),
      channel: CHANNEL_LABELS[row.channel] ?? row.channel,
      subiektGross: row.subiektGross,
      documentCount: row.documentCount,
      enteredAmount: row.enteredAmount,
      difference: row.difference,
    })),
    unmapped: block.unmapped.map((row) => ({ year: row.year, month: row.month, warehouse: row.warehouseSymbol, kind: row.kind, gross: row.grossAmount })),
  }
}

/** Pure JSON context for an ADMIN-authorized caller; does not load data or call an AI service. */
export function buildFinanceAiContext(model: ActualDashboardModel, subiekt?: SubiektAiBlock | null) {
  const costEventFrom = `${KSEF_COST_EVENT_START_YEAR}-${String(KSEF_COST_EVENT_START_MONTH).padStart(2, '0')}-01`
  const subiektRevenue = subiektContext(subiekt)
  return {
    currency: 'PLN',
    costEventFrom,
    interpretation: [
      `Rzeczywiste przychody pochodzą z Revenue. Koszty brutto przed ${costEventFrom} pochodzą z historycznych ActualEntry; od tej daty wyłącznie z CostEvent o statusie APPROVED, według daty kosztu i zapisanych alokacji.`,
      'Kwoty wyniku, przychodów i rozpoznanych kosztów są w PLN. waiting opisuje oczekujące faktury poza rozpoznanym wynikiem; unconverted pozostaje w podanych walutach i nie wolno dodawać go do PLN.',
      'null oznacza brak danych, nie zero. Zapisane zero i kwoty ujemne są rzeczywistymi wartościami. status unknown oznacza nieznaną aktualność; partial oznacza niepełne pokrycie. asOfDate to data pokrycia przychodu, a today to dzień odczytu.',
      'Koszty równe zero bez costsConfirmed nie potwierdzają braku kosztów. Wynik przy complete=false jest niepełny; bieżący miesiąc partialMonth=true pozostaje miesiącem w toku. YTD obejmuje styczeń do wybranego miesiąca i zachowuje własną kompletność.',
      'Porównanie rok do roku wolno opisać tylko gdy yoy nie jest null; w przeciwnym razie podaj ograniczenie z yoyReason i nie wyliczaj porównania samodzielnie.',
      'Kontekst nie zawiera budżetu, prognoz, danych dostawców ani konkretnych faktur. Nie wnioskuj o nich z agregatów. Nie zawiera też sald rachunków, należności, zobowiązań ani powiadomień użytkownika.',
      'Ten kontekst nie zawiera sprzedaży netto ani różnicy netto. Nie przeliczaj brutto dzieląc przez stawkę VAT.',
    ],
    period: { year: model.period.year, month: model.period.month },
    today: model.today,
    selected: monthContext(model.selected),
    months: model.months.map(monthContext),
    byCenter: model.byCenter.map((row) => ({
      costCenter: centerLabel(row.costCenterId), revenue: row.revenue, costs: row.costs, result: row.result, complete: row.complete,
    })),
    ytd: { revenue: model.ytd.revenue, costs: model.ytd.costs, result: model.ytd.result, complete: model.ytd.complete },
    yoy: model.yoy === null ? null : {
      previous: monthContext(model.yoy.previous), revenueDelta: model.yoy.revenueDelta, resultDelta: model.yoy.resultDelta,
    },
    yoyReason: model.yoyReason,
    waiting: {
      count: model.waiting.count,
      plnAmount: model.waiting.plnAmount,
      unconverted: model.waiting.unconverted.map((row) => ({ currency: row.currency, amount: row.amount })),
    },
    subiektRevenue,
  }
}
