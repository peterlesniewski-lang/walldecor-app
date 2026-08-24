import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import path from 'node:path'
import { validateInstallationCalendarE2eDatabase } from './src/lib/installations/calendar-e2e-database'

if (process.env.E2E_DATABASE_URL && process.env.WALLDECOR_E2E_PRIVATE_DIRECTORY_OWNED !== 'true') {
  throw new Error('Playwright odmawia użycia bazy E2E, której prywatnego katalogu sam nie utworzył.')
}
const createdE2eDirectory = process.env.E2E_DATABASE_URL ? null : mkdtempSync('/tmp/walldecor-installations-e2e-')
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL
  ?? `file:${path.join(createdE2eDirectory!, 'calendar.db')}`
const e2eMediaRoot = process.env.E2E_MEDIA_ROOT
  ?? path.join(path.dirname(e2eDatabaseUrl.slice('file:'.length)), 'media')
if (!validateInstallationCalendarE2eDatabase({
  DATABASE_URL: e2eDatabaseUrl,
  E2E_DATABASE_URL: e2eDatabaseUrl,
})) {
  throw new Error('E2E_DATABASE_URL musi wskazywać calendar.db w prywatnym katalogu /tmp/walldecor-installations-e2e-* bez dowiązań.')
}
process.env.E2E_DATABASE_URL = e2eDatabaseUrl
process.env.DATABASE_URL = e2eDatabaseUrl
process.env.WALLDECOR_E2E_PRIVATE_DIRECTORY_OWNED = 'true'
process.env.ADMIN_USERNAME ??= 'admin'
process.env.ADMIN_PASSWORD ??= 'ChangeMe123!'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // All installation E2E specs deliberately use the one database passed to
  // the shared web server. SQLite cannot safely migrate that file in parallel.
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl,
      E2E_DATABASE_URL: e2eDatabaseUrl,
      NEXTAUTH_URL: 'http://localhost:3000',
      NEXTAUTH_SECRET: 'e2e-installation-order-local-secret',
      // Explicit E2E-only fake adapter; production requires the authenticated
      // private media service and rejects this switch. The Calendar guard also
      // checks that this is the same isolated database as the test process.
      INSTALLATION_MEDIA_TEST_ADAPTER: 'filesystem',
      INSTALLATION_MEDIA_TEST_ROOT: e2eMediaRoot,
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'fake',
      GOOGLE_CALENDAR_ID: 'e2e-calendar@example.test',
      GOOGLE_CALENDAR_IMPERSONATED_USER: 'info@walldecor.pl',
    },
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
