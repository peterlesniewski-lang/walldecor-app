export type BreakEvenSalon = 'JAG' | 'PUL'
export interface BreakEvenMarginSetting { id: string; margin: number; effectiveFrom: string; note: string | null }
export interface BreakEvenFixedCost { id: string; name: string; costCenterId: BreakEvenSalon; supplierNip: string | null; supplierName: string | null; expectedNetAmount: number; effectiveFrom: string; effectiveTo: string | null; active: boolean }
export interface BreakEvenFixedCostMatch { id: string; fixedCostId: string; year: number; month: number; costEventPartId: string; costCenterId: string; actualNetAmount: number | null }
export interface BreakEvenRevenueBasis { id: string; year: number; month: number; costCenterId: string; netAmount: number; grossAmountSnapshot: number }
export interface BreakEvenSource {
  partId: string; eventId: string; sourceInvoiceId: string | null; title: string; supplierName: string | null; supplierNip: string | null;
  costCenterId: string; grossAmount: number; netAmount: number | null; netEstimated: boolean;
  tags: string[]; matchedFixedCostId: string | null;
}
export interface BreakEvenSourcesResult { year: number; month: number; sources: BreakEvenSource[]; warnings: string[] }
export interface BreakEvenFixedCostRow {
  id: string; name: string; expectedNetAmount: number; actualNetAmount: number | null; includedNetAmount: number;
  status: 'expected' | 'actual' | 'invalid'; netEstimated: boolean; matches: BreakEvenFixedCostMatch[];
}
export interface BreakEvenSalonReport {
  costCenterId: BreakEvenSalon; revenueGross: number; revenueNet: number | null; revenueBasis: BreakEvenRevenueBasis | null;
  fixedCosts: BreakEvenFixedCostRow[]; expectedFixedNet: number; actualFixedNet: number; fixedNet: number;
  variableNet: number; fixedOnlyTargetNet: number | null;
  targetNet: number | null; targetGross: number | null; deltaGross: number | null; operatingResultNet: number | null;
  omittedFixedCount: number; omittedFixedNet: number; goodsNet: number; oneOffNet: number;
  hr: { status: 'missing'; amount: null }; status: 'provisional'; warnings: string[];
}
export interface BreakEvenHistoricalSuggestion {
  status: 'available' | 'incomplete'; margin: number | null; revenueNet: number; purchasesNet: number;
  months: string[]; warnings: string[];
}
export interface BreakEvenReport {
  year: number; month: number; margin: BreakEvenMarginSetting | null;
  byCostCenter: Record<BreakEvenSalon, BreakEvenSalonReport>;
  historicalSuggestion: BreakEvenHistoricalSuggestion; warnings: string[];
  warningAmount: number;
  warningSummary: { plnAmount: number; unconvertedCount: number; unconvertedByCurrency: Array<{ currency: string; amount: number; count: number }> };
}
export interface BreakEvenResponse { report: BreakEvenReport; year: number; month: number; settings: { margins: BreakEvenMarginSetting[]; fixedCosts: BreakEvenFixedCost[] } }
