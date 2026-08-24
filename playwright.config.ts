import { defineConfig } from '@playwright/test'
import { existsSync, lstatSync } from 'node:fs'

const stableRunId = (process.env.E2E_RUN_ID ?? 'local').replace(/[^a-zA-Z0-9_-]/g, '_')
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL
  ?? `file:/tmp/walldecor-installations-e2e-${stableRunId}.db`
const e2eMediaRoot = process.env.E2E_MEDIA_ROOT
  ?? `/tmp/walldecor-installations-e2e-media-${stableRunId}`
const isolatedE2eDatabasePattern = /^file:\/tmp\/walldecor-installations-e2e-[A-Za-z0-9_-]+\.db$/u
if (!isolatedE2eDatabasePattern.test(e2eDatabaseUrl)) {
  throw new Error('E2E_DATABASE_URL musi wskazywać izolowaną SQLite w /tmp.')
}
const e2eDatabasePath = e2eDatabaseUrl.slice('file:'.length)
if (existsSync(e2eDatabasePath) && lstatSync(e2eDatabasePath).isSymbolicLink()) {
  throw new Error('E2E_DATABASE_URL nie może wskazywać na dowiązanie symboliczne.')
}
process.env.E2E_DATABASE_URL = e2eDatabaseUrl
process.env.DATABASE_URL = e2eDatabaseUrl
process.env.ADMIN_USERNAME ??= 'admin'
process.env.ADMIN_PASSWORD ??= 'ChangeMe123!'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
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
