// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-ai-schema-'))
const databaseUrl = `file:${path.join(directory, 'schema.db')}`

afterAll(() => rmSync(directory, { recursive: true, force: true }))

describe('shared AI queue additive migration', () => {
  it('persists isolated jobs and enforces one RUNNING job even outside the queue API', async () => {
    const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' }, encoding: 'utf8',
    })
    expect(migrated.status, migrated.stderr || migrated.stdout).toBe(0)
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    try {
      const tables = await db.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('AiJob', 'AiQueueLease') ORDER BY name",
      )
      expect(tables.map(({ name }) => name)).toEqual(['AiJob', 'AiQueueLease'])
      await db.user.create({ data: { id: 'schema-owner', name: 'Queue owner', email: 'ai-schema@example.test', passwordHash: 'test-only', role: 'ADMIN' } })
      const createRunning = (id: string) => db.$executeRawUnsafe(
        'INSERT INTO "AiJob" ("id", "ownerUserId", "kind", "status", "payloadJson", "priority", "attempts", "workerId", "leaseToken", "leaseUntil", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, 'schema-owner', 'FINANCE_CHAT', 'RUNNING', '{"question":"q","context":"c"}', 100, 1, 'worker', id, Date.now() + 60_000, Date.now(),
      )
      await createRunning('first')
      await expect(createRunning('second')).rejects.toThrow()
      await expect(db.$executeRawUnsafe('UPDATE "AiJob" SET "status" = ? WHERE "id" = ?', 'INVENTED', 'first')).rejects.toThrow()
      await db.$disconnect()
      const restarted = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      try {
        expect(await restarted.$queryRawUnsafe('SELECT "id", "status" FROM "AiJob"')).toEqual([{ id: 'first', status: 'RUNNING' }])
        expect(await restarted.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
        expect(await restarted.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }])
      } finally { await restarted.$disconnect() }
    } finally { await db.$disconnect() }
  })
})
