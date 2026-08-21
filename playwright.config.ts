import { defineConfig } from '@playwright/test'

const stableRunId = (process.env.E2E_RUN_ID ?? 'local').replace(/[^a-zA-Z0-9_-]/g, '_')
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL
  ?? `file:/tmp/walldecor-installations-e2e-${stableRunId}.db`
if (!e2eDatabaseUrl.startsWith('file:/tmp/walldecor-installations-e2e-')) {
  throw new Error('E2E_DATABASE_URL musi wskazywać izolowaną SQLite w /tmp.')
}
process.env.E2E_DATABASE_URL = e2eDatabaseUrl

export default defineConfig({
  testDir: './e2e',
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
    },
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
