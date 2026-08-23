import { defineConfig } from '@playwright/test'

const stableRunId = (process.env.E2E_RUN_ID ?? 'local').replace(/[^a-zA-Z0-9_-]/g, '_')
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL
  ?? `file:/tmp/walldecor-installations-e2e-${stableRunId}.db`
const e2eMediaRoot = process.env.E2E_MEDIA_ROOT
  ?? `/tmp/walldecor-installations-e2e-media-${stableRunId}`
if (!e2eDatabaseUrl.startsWith('file:/tmp/walldecor-installations-e2e-')) {
  throw new Error('E2E_DATABASE_URL musi wskazywać izolowaną SQLite w /tmp.')
}
process.env.E2E_DATABASE_URL = e2eDatabaseUrl

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
      // private media service and rejects this switch.
      INSTALLATION_MEDIA_TEST_ADAPTER: 'filesystem',
      INSTALLATION_MEDIA_TEST_ROOT: e2eMediaRoot,
    },
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
