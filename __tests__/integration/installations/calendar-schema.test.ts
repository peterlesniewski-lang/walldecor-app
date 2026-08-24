import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const workspace = process.cwd()
const databaseDirectory = mkdtempSync('/private/tmp/walldecor-installation-calendar-schema-')
const databasePath = path.join(databaseDirectory, 'calendar-schema.db')
const databaseUrl = `file:${databasePath}`

function runMigrate() {
  const result = spawnSync(
    process.execPath,
    [path.join(workspace, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    { cwd: workspace, env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' }, encoding: 'utf8' },
  )

  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
}

afterAll(() => rmSync(databaseDirectory, { recursive: true, force: true }))

describe('installation visit calendar schema', () => {
  it('applies the full migration chain with durable visit, assignment, and outbox tables', async () => {
    runMigrate()
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

    try {
      const [tables, foreignKeys, integrity] = await Promise.all([
        db.$queryRawUnsafe<Array<{ name: string }>>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('InstallationVisit', 'InstallationVisitScope', 'InstallationScopeAssignment', 'IntegrationSyncState', 'IntegrationOutbox', 'IntegrationAttempt') ORDER BY name",
        ),
        db.$queryRawUnsafe('PRAGMA foreign_key_check'),
        db.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check'),
      ])

      expect(tables.map(({ name }) => name)).toEqual([
        'InstallationScopeAssignment',
        'InstallationVisit',
        'InstallationVisitScope',
        'IntegrationAttempt',
        'IntegrationOutbox',
        'IntegrationSyncState',
      ])
      expect(foreignKeys).toEqual([])
      expect(integrity).toEqual([{ integrity_check: 'ok' }])

      await expect(db.$executeRawUnsafe(
        'INSERT INTO "InstallationVisit" ("id", "orderId", "status", "startsAt", "endsAt", "timezone", "revision", "createdById", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'invalid-time-visit', 'missing-order', 'DRAFT', '2026-08-24 09:00:00 UTC', '2026-08-24 09:00:00 UTC', 'Europe/Warsaw', 1, 'calendar-schema-test', '2026-08-24 08:00:00 UTC', '2026-08-24 08:00:00 UTC',
      )).rejects.toThrow('InstallationVisit_time_insert_guard')
    } finally {
      await db.$disconnect()
    }
  })
})
