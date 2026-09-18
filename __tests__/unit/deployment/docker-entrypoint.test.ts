import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(__dirname, '../../..')
const ENTRYPOINT_SOURCE = join(REPO_ROOT, 'docker-entrypoint.sh')
const DOCKERFILE_SOURCE = join(REPO_ROOT, 'Dockerfile')

let sandboxDir: string
let appDir: string
let callLog: string

async function writeExecutable(path: string, source: string) {
  await writeFile(path, source)
  await chmod(path, 0o755)
}

async function prepareRuntime() {
  sandboxDir = await mkdtemp(join(tmpdir(), 'walldecor-entrypoint-'))
  appDir = join(sandboxDir, 'app')
  callLog = join(sandboxDir, 'calls.log')

  await Promise.all([
    mkdir(join(appDir, 'node_modules/prisma/build'), { recursive: true }),
    mkdir(join(appDir, 'node_modules/.bin'), { recursive: true }),
    mkdir(join(appDir, 'prisma/migrations/20260301210006_init'), { recursive: true }),
    mkdir(join(appDir, '.next/standalone'), { recursive: true }),
    mkdir(join(sandboxDir, 'bin'), { recursive: true }),
  ])

  await cp(ENTRYPOINT_SOURCE, join(appDir, 'docker-entrypoint.sh'))
  await chmod(join(appDir, 'docker-entrypoint.sh'), 0o755)

  await Promise.all([
    writeFile(join(appDir, 'node_modules/prisma/build/index.js'), ''),
    writeFile(join(appDir, 'prisma/schema.prisma'), ''),
    writeFile(join(appDir, 'prisma/seed.ts'), ''),
    writeFile(join(appDir, 'prisma/migrations/20260301210006_init/migration.sql'), '-- test'),
    writeFile(join(appDir, '.next/standalone/server.js'), ''),
    writeExecutable(
      join(sandboxDir, 'bin/node'),
      `#!/bin/sh
printf 'node %s\\n' "$*" >> "$CALL_LOG"
case "$*" in
  *"prisma/build/index.js migrate deploy"*) exit "\${MIGRATE_EXIT:-0}" ;;
  *".next/standalone/server.js"*) exit "\${SERVER_EXIT:-0}" ;;
  *) exit 97 ;;
esac
`,
    ),
    writeExecutable(
      join(appDir, 'node_modules/.bin/tsx'),
      `#!/bin/sh
printf 'tsx %s\\n' "$*" >> "$CALL_LOG"
exit "\${SEED_EXIT:-0}"
`,
    ),
  ])
}

function runEntrypoint(
  overrides: Record<string, string> = {},
): ReturnType<typeof spawnSync> {
  return spawnSync('./docker-entrypoint.sh', {
    cwd: appDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(sandboxDir, 'bin')}:${process.env.PATH}`,
      CALL_LOG: callLog,
      DATABASE_URL: `file:${join(sandboxDir, 'runtime.db')}`,
      WALLDECOR_SKIP_SEED: undefined,
      ...overrides,
    },
  })
}

async function calls() {
  return readFile(callLog, 'utf8').catch(() => '')
}

function createManagedDatabase() {
  const databasePath = join(sandboxDir, 'managed.db')
  execFileSync('sqlite3', [
    databasePath,
    [
      'CREATE TABLE "Employee" ("id" TEXT PRIMARY KEY);',
      "INSERT INTO \"Employee\" (\"id\") VALUES ('existing-employee');",
      'CREATE TABLE "_prisma_migrations" (',
      '  "id" TEXT PRIMARY KEY,',
      '  "finished_at" DATETIME,',
      '  "rolled_back_at" DATETIME',
      ');',
      'INSERT INTO "_prisma_migrations" ("id", "finished_at", "rolled_back_at")',
      "VALUES ('baseline', CURRENT_TIMESTAMP, NULL);",
    ].join(' '),
  ])
  return databasePath
}

beforeEach(async () => {
  await prepareRuntime()
})

afterEach(async () => {
  await rm(sandboxDir, { recursive: true, force: true })
})

describe('production Docker entrypoint', () => {
  it('backs up and migrates an existing managed database before skipping seed and starting the server', async () => {
    const databasePath = createManagedDatabase()

    const result = runEntrypoint({
      DATABASE_URL: `file:${databasePath}`,
      WALLDECOR_SKIP_SEED: 'true',
      SEED_EXIT: '29',
    })

    expect(result.status).toBe(0)
    expect(await calls()).toBe(
      [
        'node ./node_modules/prisma/build/index.js migrate deploy',
        'node .next/standalone/server.js',
        '',
      ].join('\n'),
    )
    expect(result.stdout).toMatch(
      /Creating SQLite backup:[\s\S]*Running database migrations[\s\S]*Skipping database seed[\s\S]*Starting Next.js server/,
    )
    const backupNames = await readdir(join(sandboxDir, 'backups'))
    expect(backupNames).toHaveLength(1)
    expect(execFileSync('sqlite3', [
      join(sandboxDir, 'backups', backupNames[0]),
      'SELECT "id" FROM "Employee";',
    ], { encoding: 'utf8' })).toBe('existing-employee\n')
  })

  it('still runs the seed when the flag is explicitly false', async () => {
    const databasePath = createManagedDatabase()

    const result = runEntrypoint({
      DATABASE_URL: `file:${databasePath}`,
      WALLDECOR_SKIP_SEED: 'false',
    })

    expect(result.status).toBe(0)
    expect(await calls()).toBe(
      [
        'node ./node_modules/prisma/build/index.js migrate deploy',
        'tsx prisma/seed.ts',
        'node .next/standalone/server.js',
        '',
      ].join('\n'),
    )
  })

  it.each(['', '1', '0', 'yes', 'TRUE', ' false '])(
    'rejects invalid skip-seed value %j before any backup or database mutation',
    async (flag) => {
      const databasePath = createManagedDatabase()
      const originalDatabase = await readFile(databasePath)

      const result = runEntrypoint({
        DATABASE_URL: `file:${databasePath}`,
        WALLDECOR_SKIP_SEED: flag,
      })

      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toContain('WALLDECOR_SKIP_SEED must be true or false')
      expect(await calls()).toBe('')
      expect(await readdir(join(sandboxDir, 'backups')).catch(() => [])).toEqual([])
      expect(await readFile(databasePath)).toEqual(originalDatabase)
    },
  )

  it.each(['missing', 'zero-byte', 'empty-schema', 'history-only'])(
    'refuses skipping seed for a %s database',
    async (databaseKind) => {
      let databasePath = join(sandboxDir, 'fresh.db')
      if (databaseKind === 'zero-byte') await writeFile(databasePath, '')
      if (databaseKind === 'empty-schema') {
        execFileSync('sqlite3', [databasePath, 'PRAGMA user_version = 1;'])
      }
      if (databaseKind === 'history-only') {
        databasePath = createManagedDatabase()
        execFileSync('sqlite3', [databasePath, 'DROP TABLE "Employee";'])
      }

      const result = runEntrypoint({
        DATABASE_URL: `file:${databasePath}`,
        WALLDECOR_SKIP_SEED: 'true',
      })

      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toContain('Skipping seed requires an existing non-empty SQLite database')
      expect(await calls()).toBe('')
    },
  )

  it.each(['false', 'true'])('stops before migrations when the backup fails with skip-seed=%s', async (flag) => {
    const databasePath = createManagedDatabase()
    await writeExecutable(join(sandboxDir, 'bin/sqlite3'), '#!/bin/sh\nexit 31\n')

    const result = runEntrypoint({
      DATABASE_URL: `file:${databasePath}`,
      WALLDECOR_SKIP_SEED: flag,
    })

    expect(result.status).toBe(31)
    expect(result.stdout).toContain('Creating SQLite backup:')
    expect(await calls()).toBe('')
  })

  it('stops before the server when migrations fail while seed is skipped', async () => {
    const databasePath = createManagedDatabase()

    const result = runEntrypoint({
      DATABASE_URL: `file:${databasePath}`,
      WALLDECOR_SKIP_SEED: 'true',
      MIGRATE_EXIT: '23',
    })

    expect(result.status).toBe(23)
    expect(await calls()).toBe('node ./node_modules/prisma/build/index.js migrate deploy\n')
  })

  it('stops before seed and server when migrate deploy fails', async () => {
    const result = runEntrypoint({ MIGRATE_EXIT: '23' })

    expect(result.status).toBe(23)
    expect(await calls()).toBe(
      'node ./node_modules/prisma/build/index.js migrate deploy\n',
    )
  })

  it('stops before server when the mandatory seed fails', async () => {
    const result = runEntrypoint({ SEED_EXIT: '29' })

    expect(result.status).toBe(29)
    expect(await calls()).toBe(
      [
        'node ./node_modules/prisma/build/index.js migrate deploy',
        'tsx prisma/seed.ts',
        '',
      ].join('\n'),
    )
  })

  it('runs migrate deploy, seed, and the server in order', async () => {
    const result = runEntrypoint()

    expect(result.status).toBe(0)
    expect(await calls()).toBe(
      [
        'node ./node_modules/prisma/build/index.js migrate deploy',
        'tsx prisma/seed.ts',
        'node .next/standalone/server.js',
        '',
      ].join('\n'),
    )
  })

  it.each(['false', 'true'])('fails fast for a legacy database without migration history with skip-seed=%s', async (flag) => {
    const databasePath = join(sandboxDir, 'legacy.db')
    execFileSync('sqlite3', [databasePath, 'CREATE TABLE "Employee" ("id" TEXT PRIMARY KEY);'])

    const result = runEntrypoint({ DATABASE_URL: `file:${databasePath}`, WALLDECOR_SKIP_SEED: flag })

    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain(
      'has no Prisma migration history',
    )
    expect(await calls()).toBe('')
  })

  it('allows migrate deploy when a non-empty database has successful migration history', async () => {
    const databasePath = join(sandboxDir, 'managed.db')
    execFileSync('sqlite3', [
      databasePath,
      [
        'CREATE TABLE "Employee" ("id" TEXT PRIMARY KEY);',
        'CREATE TABLE "_prisma_migrations" (',
        '  "id" TEXT PRIMARY KEY,',
        '  "finished_at" DATETIME,',
        '  "rolled_back_at" DATETIME',
        ');',
        'INSERT INTO "_prisma_migrations" ("id", "finished_at", "rolled_back_at")',
        "VALUES ('baseline', CURRENT_TIMESTAMP, NULL);",
      ].join(' '),
    ])

    const result = runEntrypoint({ DATABASE_URL: `file:${databasePath}` })

    expect(result.status).toBe(0)
    expect(await calls()).toContain(
      'node ./node_modules/prisma/build/index.js migrate deploy\n',
    )
  })

  it.each(['false', 'true'])('fails fast without a successful migration with skip-seed=%s', async (flag) => {
    const databasePath = join(sandboxDir, 'unfinished-baseline.db')
    execFileSync('sqlite3', [
      databasePath,
      [
        'CREATE TABLE "Employee" ("id" TEXT PRIMARY KEY);',
        'CREATE TABLE "_prisma_migrations" (',
        '  "id" TEXT PRIMARY KEY,',
        '  "finished_at" DATETIME,',
        '  "rolled_back_at" DATETIME',
        ');',
      ].join(' '),
    ])

    const result = runEntrypoint({ DATABASE_URL: `file:${databasePath}`, WALLDECOR_SKIP_SEED: flag })

    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain(
      'has no successful Prisma migration history',
    )
    expect(await calls()).toBe('')
  })

  it.each(['false', 'true'])('fails fast for an unresolved failed migration with skip-seed=%s', async (flag) => {
    const databasePath = join(sandboxDir, 'failed-migration.db')
    execFileSync('sqlite3', [
      databasePath,
      [
        'CREATE TABLE "Employee" ("id" TEXT PRIMARY KEY);',
        'CREATE TABLE "_prisma_migrations" (',
        '  "id" TEXT PRIMARY KEY,',
        '  "finished_at" DATETIME,',
        '  "rolled_back_at" DATETIME',
        ');',
        'INSERT INTO "_prisma_migrations" ("id", "finished_at", "rolled_back_at")',
        "VALUES ('applied', CURRENT_TIMESTAMP, NULL);",
        'INSERT INTO "_prisma_migrations" ("id", "finished_at", "rolled_back_at")',
        "VALUES ('failed', NULL, NULL);",
      ].join(' '),
    ])

    const result = runEntrypoint({ DATABASE_URL: `file:${databasePath}`, WALLDECOR_SKIP_SEED: flag })

    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain(
      'contains a failed Prisma migration',
    )
    expect(await calls()).toBe('')
  })

  it('ships the migration history, seed runtime, and SQLite preflight tool', async () => {
    const dockerfile = await readFile(DOCKERFILE_SOURCE, 'utf8')

    expect(dockerfile).toMatch(/apk add --no-cache[^\n]*\bsqlite\b/)
    expect(dockerfile).toContain('COPY --from=builder /app/prisma ./prisma')
    expect(dockerfile).toContain(
      'COPY --from=builder /app/src/lib/hr/leave-type-catalog.ts ./src/lib/hr/leave-type-catalog.ts',
    )
  })
})
