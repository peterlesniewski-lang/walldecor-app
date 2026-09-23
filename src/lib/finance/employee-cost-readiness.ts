/**
 * Payroll settlements are built in HR, on a separate branch, and are not read here.
 * When that work lands, replace this function with getEffectivePayrollCosts
 * for the selected month (employer cost in grosze, sourceKey payroll:<employee>:<YYYY-MM>).
 * Do not invent a zero or a sample cost here.
 */
export type EmployeeCostReadiness =
  | { connected: false; label: string }
  | { connected: true; label: string; amount: number }

export function employeeCostReadiness(): EmployeeCostReadiness {
  return {
    connected: false,
    label: 'Koszty pracownicze nie są włączone. Rozliczenia HR powstaną osobno.',
  }
}
