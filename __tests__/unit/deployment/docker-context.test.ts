// @vitest-environment node
import { readFile } from 'node:fs/promises'
import ignore from 'ignore'
import { describe, expect, it } from 'vitest'

// These patterns use the common ignore subset (globs, directory exclusions and
// negations). Fixture paths cover the COPY . . inputs without contacting Docker.
const rules = ignore().add(await readFile(new URL('../../../.dockerignore', import.meta.url), 'utf8'))

describe('Application Docker context', () => {
  it.each([
    '.env', '.env.local', '.env.production', 'worker/ai/.env', 'worker/ai/.env.production',
    'test-results/invoice-batch/summary.json', 'playwright-report/index.html',
    'nested/test-results/invoice.png', 'nested/playwright-report/trace.zip',
    'prisma/dev.db', 'prisma/dev.db-wal', 'prisma/dev.sqlite', 'prisma/dev.sqlite-shm',
    'prisma/dev.sqlite3', 'prisma/dev.sqlite3-journal',
    'data/invoice.pdf', 'uploads/customer.png', 'public/uploads/customer.png',
    'invoice-originals/document.pdf', 'invoice-processing/page.png',
    'oauth/auth.json', '.codex/auth.json', 'runtime/jobs/prompt.txt', 'backups/database.sql',
  ])('excludes private or generated input %s', (file) => {
    expect(rules.ignores(file), file).toBe(true)
  })

  it.each([
    '.env.example', 'worker/ai/.env.example', 'package.json', 'package-lock.json',
    'prisma/schema.prisma', 'prisma/migrations/20260911150000_invoice_import_drafts/migration.sql',
    'src/lib/invoice-import/private-store.ts', 'src/lib/invoice-import/files-runtime.ts',
    'src/generated/prisma/index.js', 'public/logo.svg', 'ceo-module/knowledge.md',
    'worker/ai/catalog.json', 'scripts/run-ai-worker.ts', 'docker-entrypoint.sh',
  ])('keeps required source or example input %s', (file) => {
    expect(rules.ignores(file), file).toBe(false)
  })
})
