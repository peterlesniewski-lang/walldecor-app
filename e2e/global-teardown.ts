import { rmSync } from 'node:fs'
import { validateInstallationCalendarE2eDatabase } from '@/lib/installations/calendar-e2e-database'

export default function globalTeardown() {
  if (process.env.WALLDECOR_E2E_PRIVATE_DIRECTORY_OWNED !== 'true') {
    throw new Error('Odmowa usunięcia katalogu E2E bez znacznika własności Playwright.')
  }
  const validated = validateInstallationCalendarE2eDatabase({
    DATABASE_URL: process.env.DATABASE_URL,
    E2E_DATABASE_URL: process.env.E2E_DATABASE_URL,
  })
  if (!validated) throw new Error('Odmowa usunięcia niezweryfikowanego katalogu E2E.')
  rmSync(validated.directoryPath, { recursive: true, force: true })
}
