// Test-only runner for the payroll automat on the ISOLATED Playwright database. Never an HTTP endpoint
// (see e2e/dev-server.ts): the spec spawns this script, which calls the same functions as the
// in-process schedule.
//   node --preserve-symlinks --import tsx e2e/payroll-automation-run.ts run 2026-05  → one month's run
//   node --preserve-symlinks --import tsx e2e/payroll-automation-run.ts due          → one scheduler check "now"
import { PrismaClient } from '../src/generated/prisma'
import { validateInstallationCalendarE2eDatabase } from '../src/lib/installations/calendar-e2e-database'
import { executePayrollAutoCarryover, runDuePayrollAutomation } from '../src/lib/payroll/auto-carryover-scheduler'
import { parsePayrollMonth } from '../src/lib/payroll/period'

async function main() {
  const database = validateInstallationCalendarE2eDatabase(process.env)
  if (!database || process.env.WALLDECOR_E2E_PRIVATE_DIRECTORY_OWNED !== 'true') {
    throw new Error('The payroll automat runner only works on the owned, isolated E2E database.')
  }
  const [mode, month] = process.argv.slice(2)
  const db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } })
  try {
    if (mode === 'run') {
      const period = parsePayrollMonth(month)
      if (!period) throw new Error('Usage: run YYYY-MM')
      const { summary, notified } = await executePayrollAutoCarryover(db, period)
      console.log(JSON.stringify({
        month: summary.month,
        approved: summary.approved.map((person) => person.employeeId).sort(),
        attention: summary.attention.map((person) => ({ employeeId: person.employeeId, reasons: person.reasons })),
        alreadySettled: summary.alreadySettled.map((person) => person.employeeId).sort(),
        errors: summary.errors,
        notified,
      }))
    } else if (mode === 'due') {
      const tick = await runDuePayrollAutomation(db)
      console.log(JSON.stringify({ carryover: tick.carryover.ran ? { ran: true, month: tick.carryover.month } : tick.carryover }))
    } else {
      throw new Error('Usage: run YYYY-MM | due')
    }
  } finally {
    await db.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
