import type { InstallationCalendarAdapter } from './calendar-adapter'
import type { CalendarEnvironment } from './calendar-config'
import { readInstallationCalendarConfig } from './calendar-server-config'
import { FakeInstallationCalendarAdapter } from './fake-calendar-adapter'
import { createGoogleInstallationCalendarAdapter } from './google-calendar-adapter'

/**
 * The sole runtime construction point for the scheduled Calendar worker.
 * It always reads the server-side configuration first, so a disabled or
 * production-fake integration cannot claim any outbox work.
 */
export function createInstallationCalendarAdapter(
  env: CalendarEnvironment = process.env,
): InstallationCalendarAdapter {
  const configuration = readInstallationCalendarConfig(env)
  if (configuration.adapter === 'fake') return new FakeInstallationCalendarAdapter()
  return createGoogleInstallationCalendarAdapter()
}
