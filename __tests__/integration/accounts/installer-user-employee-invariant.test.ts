import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installer-invariant-'))
const databasePath = path.join(databaseDirectory, 'installer-invariant.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let sequence = 0

function createClient() {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } })
}

function createOneShotGate(parties: number) {
  let arrivals = 0
  let release: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })

  return async () => {
    if (arrivals < parties) {
      arrivals += 1
      if (arrivals === parties) release()
    }
    await ready
  }
}

function committedMigrationSqlPaths() {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  return readdirSync(migrationRoot)
    .sort()
    .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
    .filter(existsSync)
}

function applyMigrations(databaseFile: string) {
  for (const migrationSqlPath of committedMigrationSqlPaths()) {
    const result = spawnSync('sqlite3', ['-bail', databaseFile], {
      cwd: process.cwd(),
      input: readFileSync(migrationSqlPath, 'utf8'),
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(`Nie udało się zastosować migracji ${migrationSqlPath}: ${result.stderr || result.stdout}`)
    }
  }
}

function nextId(prefix: string) {
  sequence += 1
  return `${prefix}-${sequence}`
}

async function createEmployee(active = true) {
  const id = nextId('employee')
  return db.employee.create({
    data: {
      id,
      firstName: 'Iga',
      lastName: id,
      email: `${id}@example.test`,
      position: 'Instalator',
      costCenterId: 'INV',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      active,
    },
  })
}

async function createUser(input: { employeeId: string | null; role: 'INSTALLER' | 'EMPLOYEE' | 'MANAGER'; isActive?: boolean }) {
  const id = nextId('user')
  return db.user.create({
    data: {
      id,
      username: id,
      name: id,
      email: `${id}@example.test`,
      passwordHash: 'test-only-hash',
      role: input.role,
      isActive: input.isActive ?? true,
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
    },
  })
}

async function activeInstallerInvariantCount() {
  const rows = await db.$queryRawUnsafe<Array<{ count: number }>>(`
    SELECT COUNT(*) AS count
    FROM "User" user
    LEFT JOIN "Employee" employee ON employee."id" = user."employeeId"
    WHERE user."role" = 'INSTALLER'
      AND user."isActive" = 1
      AND (user."employeeId" IS NULL OR employee."id" IS NULL OR employee."active" <> 1)
  `)
  return Number(rows[0]?.count ?? 0)
}

beforeAll(async () => {
  applyMigrations(databasePath)
  db = createClient()
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  await db.$queryRawUnsafe('PRAGMA busy_timeout = 1000')
  await db.costCenter.create({ data: { id: 'INV', name: 'Installer invariant' } })
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('active INSTALLER accounts require an active linked Employee in SQLite', () => {
  it('rejects direct invalid INSERT and UPDATE writes', async () => {
    await expect(createUser({ employeeId: null, role: 'INSTALLER' }))
      .rejects.toMatchObject({ code: 'P2003', meta: { modelName: 'User', field_name: 'foreign key' } })

    const inactiveEmployee = await createEmployee(false)
    const employeeAccount = await createUser({ employeeId: inactiveEmployee.id, role: 'EMPLOYEE' })
    await expect(db.user.update({ where: { id: employeeAccount.id }, data: { role: 'INSTALLER' } }))
      .rejects.toMatchObject({ code: 'P2003', meta: { modelName: 'User', field_name: 'foreign key' } })

    expect(await activeInstallerInvariantCount()).toBe(0)
  })

  it('direct Employee deactivation disables only linked INSTALLER accounts', async () => {
    const installerEmployee = await createEmployee(true)
    const regularEmployee = await createEmployee(true)
    const installerAccount = await createUser({ employeeId: installerEmployee.id, role: 'INSTALLER' })
    const regularAccount = await createUser({ employeeId: regularEmployee.id, role: 'EMPLOYEE' })

    await db.employee.update({ where: { id: installerEmployee.id }, data: { active: false } })
    await db.employee.update({ where: { id: regularEmployee.id }, data: { active: false } })

    await expect(db.user.findUniqueOrThrow({ where: { id: installerAccount.id } })).resolves.toMatchObject({ isActive: false })
    await expect(db.user.findUniqueOrThrow({ where: { id: regularAccount.id } })).resolves.toMatchObject({ isActive: true })
    expect(await activeInstallerInvariantCount()).toBe(0)
  })

  it.each(['create', 'reactivate'] as const)('keeps the invariant during concurrent %s and Employee deactivation', async (operation) => {
    const employee = await createEmployee(true)
    const existingInstaller = operation === 'reactivate'
      ? await createUser({ employeeId: employee.id, role: 'INSTALLER', isActive: false })
      : null
    const creatorClient = createClient()
    const employeeClient = createClient()
    const startTogether = createOneShotGate(2)
    let createdInstallerId: string | null = null

    await Promise.all([
      creatorClient.$queryRawUnsafe('PRAGMA busy_timeout = 1000'),
      employeeClient.$queryRawUnsafe('PRAGMA busy_timeout = 1000'),
    ])

    try {
      const installerWrite = operation === 'create'
        ? (async () => {
            await startTogether()
            const id = nextId('concurrent-user')
            createdInstallerId = id
            return creatorClient.user.create({
              data: {
                id,
                username: id,
                name: id,
                email: `${id}@example.test`,
                passwordHash: 'test-only-hash',
                role: 'INSTALLER',
                isActive: true,
                employeeId: employee.id,
              },
            })
          })()
        : (async () => {
            await startTogether()
            return creatorClient.user.update({ where: { id: existingInstaller!.id }, data: { isActive: true } })
          })()
      const employeeDeactivate = (async () => {
        await startTogether()
        return employeeClient.employee.update({ where: { id: employee.id }, data: { active: false } })
      })()

      const [installerWriteResult, employeeDeactivateResult] = await Promise.allSettled([installerWrite, employeeDeactivate])
      expect(employeeDeactivateResult.status).toBe('fulfilled')
      if (installerWriteResult.status === 'rejected') {
        expect(installerWriteResult.reason).toMatchObject({
          code: 'P2003', meta: { modelName: 'User', field_name: 'foreign key' },
        })
      }
      const trackedInstallerId = operation === 'create' ? createdInstallerId : existingInstaller!.id
      const trackedInstaller = await db.user.findUnique({ where: { id: trackedInstallerId! }, select: { isActive: true } })
      expect(trackedInstaller?.isActive ?? false).toBe(false)
      expect(await activeInstallerInvariantCount()).toBe(0)
    } finally {
      await Promise.all([creatorClient.$disconnect(), employeeClient.$disconnect()])
    }
  })
})
