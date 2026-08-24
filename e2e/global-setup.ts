import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@/generated/prisma'
import { validateInstallationCalendarE2eDatabase } from '@/lib/installations/calendar-e2e-database'

/**
 * Every E2E spec and the running Next server share one SQLite file. Prepare it
 * exactly once before the suite; replacing it while Prisma holds a connection
 * makes later specs query a deleted database inode.
 */
export default async function globalSetup() {
  if (process.env.WALLDECOR_E2E_PRIVATE_DIRECTORY_OWNED !== 'true') {
    throw new Error('Playwright nie jest właścicielem prywatnego katalogu E2E.')
  }
  const databaseUrl = process.env.E2E_DATABASE_URL
  const validated = validateInstallationCalendarE2eDatabase({
    DATABASE_URL: process.env.DATABASE_URL,
    E2E_DATABASE_URL: databaseUrl,
  })
  if (!validated) {
    throw new Error('E2E_DATABASE_URL nie spełnia prywatnej granicy bazy E2E.')
  }
  const { databasePath, directoryPath } = validated
  if (existsSync(databasePath)) {
    throw new Error('Baza E2E musi być nowym, nieistniejącym plikiem w prywatnym katalogu.')
  }

  try {
    const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
    for (const migrationPath of readdirSync(migrationRoot).sort()
      .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
      .filter(existsSync)) {
      const result = spawnSync('sqlite3', ['-bail', databasePath], {
        cwd: process.cwd(), input: readFileSync(migrationPath, 'utf8'), encoding: 'utf8',
      })
      if (result.status !== 0) throw new Error(`Nie udało się zastosować migracji ${migrationPath}: ${result.stderr || result.stdout}`)
    }

    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    try {
      await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
      const username = process.env.ADMIN_USERNAME ?? 'admin'
      const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!'
      await db.user.create({
        data: {
          username,
          email: 'e2e-default-admin@example.test',
          name: 'E2E Administrator',
          role: 'ADMIN',
          passwordHash: await bcrypt.hash(password, 10),
          passwordChangedAt: new Date(),
        },
      })
    } finally {
      await db.$disconnect()
    }
  } catch (error) {
    const cleanupTarget = validateInstallationCalendarE2eDatabase({
      DATABASE_URL: process.env.DATABASE_URL,
      E2E_DATABASE_URL: process.env.E2E_DATABASE_URL,
    })
    if (cleanupTarget?.directoryPath === directoryPath) {
      rmSync(cleanupTarget.directoryPath, { recursive: true, force: true })
    }
    throw error
  }
}
