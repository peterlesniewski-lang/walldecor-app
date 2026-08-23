import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@/generated/prisma'

/**
 * Every E2E spec and the running Next server share one SQLite file. Prepare it
 * exactly once before the suite; replacing it while Prisma holds a connection
 * makes later specs query a deleted database inode.
 */
export default async function globalSetup() {
  const databaseUrl = process.env.E2E_DATABASE_URL
  if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) {
    throw new Error('E2E_DATABASE_URL musi wskazywać izolowaną SQLite w /tmp.')
  }
  const databasePath = databaseUrl.replace(/^file:/, '')
  rmSync(databasePath, { force: true })

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
}
