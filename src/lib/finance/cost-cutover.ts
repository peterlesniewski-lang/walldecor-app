// From April 2026 costs come from cost events (KSeF + manual) and payroll; earlier months come
// from historical ActualEntry rows, which already include wages.
export const KSEF_COST_EVENT_START_YEAR = 2026
export const KSEF_COST_EVENT_START_MONTH = 4
export const COST_EVENT_START_MONTH_KEY = `${KSEF_COST_EVENT_START_YEAR}-${String(KSEF_COST_EVENT_START_MONTH).padStart(2, '0')}`
