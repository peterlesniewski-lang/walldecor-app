import type { MonthEmployerCost } from '@/lib/finance/ceo-net'

/**
 * How payroll employer cost stands in one dashboard month. The amount comes from approved payroll
 * settlements or, until they exist, from an estimate (base salary × employer rates). It is never
 * invented: a month without payroll data says so instead of showing zero.
 */
export type EmployeeCostReadiness =
  | { connected: false; label: string }
  | { connected: true; label: string; amount: number }

const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' })

export function employeeCostReadiness(employerCost: MonthEmployerCost): EmployeeCostReadiness {
  if (employerCost.missingCount > 0) {
    return {
      connected: false,
      label: `Bez kosztu pracodawcy: ${employerCost.missingCount} os. — uzupełnij podstawę lub podział w Wynagrodzeniach. Koszty netto są niepełne.`,
    }
  }
  if (employerCost.amount === null || employerCost.status === 'NONE') {
    return { connected: false, label: 'Koszt pracodawcy z płac nie jest liczony dla tego miesiąca.' }
  }
  const origin = employerCost.status === 'ESTIMATE'
    ? 'szacunek z podstawy do czasu zatwierdzenia listy płac'
    : 'z zatwierdzonych list płac'
  return {
    connected: true,
    amount: employerCost.amount,
    label: `W kosztach netto: koszt pracodawcy ${money.format(employerCost.amount)} (${origin}).`,
  }
}
