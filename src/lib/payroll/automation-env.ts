// Dependency-free so src/instrumentation.ts can import it in every runtime.

/** PAYROLL_AUTO_CARRYOVER=off stops the payroll schedule everywhere; outside production it runs only with =on. */
export function isPayrollSchedulerEnabledByEnv(env: { PAYROLL_AUTO_CARRYOVER?: string; NODE_ENV?: string }) {
  const mode = env.PAYROLL_AUTO_CARRYOVER
  return !(mode === 'off' || (env.NODE_ENV !== 'production' && mode !== 'on'))
}
