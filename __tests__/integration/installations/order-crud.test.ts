import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import {
  archiveInstallationOrder,
  createInstallationOrder,
  getInstallationOrder,
  listInstallationOrders,
  updateInstallationOrder,
} from '@/lib/installations/order-service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installations-'))
const databasePath = path.join(databaseDirectory, 'installations.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let primaryEmployeeId: string
let backupEmployeeId: string
let inactiveEmployeeId: string

function createClient() {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } })
}

async function seedEmployees() {
  await db.costCenter.create({ data: { id: 'JAG', name: 'Janki' } })
  const employees = await Promise.all([
    db.employee.create({
      data: {
        firstName: 'Anna', lastName: 'Opiekun', email: 'anna.opiekun@example.pl',
        position: 'Koordynatorka', costCenterId: 'JAG', startDate: new Date('2025-01-01T12:00:00.000Z'), active: true,
      },
    }),
    db.employee.create({
      data: {
        firstName: 'Bartek', lastName: 'Zastępca', email: 'bartek.zastepca@example.pl',
        position: 'Koordynator', costCenterId: 'JAG', startDate: new Date('2025-01-01T12:00:00.000Z'), active: true,
      },
    }),
    db.employee.create({
      data: {
        firstName: 'Celina', lastName: 'Nieaktywna', email: 'celina.nieaktywna@example.pl',
        position: 'Koordynatorka', costCenterId: 'JAG', startDate: new Date('2025-01-01T12:00:00.000Z'), active: false,
      },
    }),
  ])
  primaryEmployeeId = employees[0].id
  backupEmployeeId = employees[1].id
  inactiveEmployeeId = employees[2].id
}

beforeAll(async () => {
  const schemaSql = execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' },
  )
  execFileSync('sqlite3', [databasePath], { input: schemaSql })
  db = createClient()
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await seedEmployees()
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('installation order CRUD persists in a real SQLite database', () => {
  it('creates, lists, reads, updates, archives, and survives a Prisma restart', async () => {
    const created = await createInstallationOrder(db, {
      client: { name: 'Jan Kowalski', email: 'jan.kowalski@example.pl', phone: '+48 501 234 567' },
      address: { street: 'Puławska', buildingNumber: '17', postalCode: '02-515', city: 'Warszawa' },
      primaryEmployeeId,
      backupEmployeeId,
    }, 'admin-user')

    expect(created.number).toMatch(/^MON-\d{8}-\d{4}$/)
    expect((await listInstallationOrders(db)).map((order) => order.id)).toEqual([created.id])
    expect((await getInstallationOrder(db, created.id))?.client.name).toBe('Jan Kowalski')
    expect(created.auditEvents).toHaveLength(1)
    expect(created.auditEvents[0]).toMatchObject({ actorId: 'admin-user', action: 'INSTALLATION_ORDER_CREATED' })

    const updated = await updateInstallationOrder(db, created.id, {
      client: { name: 'Jan Kowalski', email: 'jan.kowalski@example.pl', phone: '+48 511 000 111' },
      address: { street: 'Puławska', buildingNumber: '17A', postalCode: '02-515', city: 'Warszawa' },
      primaryEmployeeId: backupEmployeeId,
      backupEmployeeId: primaryEmployeeId,
    }, 'manager-user')

    expect(updated.client.phone).toBe('+48 511 000 111')
    expect(updated.addressBuildingNumber).toBe('17A')
    expect(updated.primaryEmployeeId).toBe(backupEmployeeId)
    expect(updated.auditEvents.map((event) => event.action)).toEqual([
      'INSTALLATION_ORDER_UPDATED',
      'INSTALLATION_ORDER_CREATED',
    ])

    const archived = await archiveInstallationOrder(db, created.id, 'admin-user')
    expect(archived.status).toBe('ARCHIVED')
    expect(archived.archivedAt).toBeInstanceOf(Date)
    expect(await listInstallationOrders(db)).toEqual([])
    expect((await listInstallationOrders(db, { includeArchived: true })).map((order) => order.id)).toEqual([created.id])

    await db.$disconnect()
    db = createClient()
    await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')

    const afterRestart = await getInstallationOrder(db, created.id)
    expect(existsSync(databasePath)).toBe(true)
    expect(afterRestart).toMatchObject({
      id: created.id,
      status: 'ARCHIVED',
      addressBuildingNumber: '17A',
      client: { phone: '+48 511 000 111' },
    })
  })

  it('enforces unique order numbers and employee foreign keys in SQLite', async () => {
    const created = await createInstallationOrder(db, {
      client: { name: 'Maria Nowak', email: 'maria.nowak@example.pl', phone: '+48 502 345 678' },
      address: { street: 'Domaniewska', buildingNumber: '10', postalCode: '02-672', city: 'Warszawa' },
      primaryEmployeeId,
      backupEmployeeId,
    }, 'admin-user')

    await expect(db.installationOrder.create({
      data: {
        number: created.number,
        clientId: created.clientId,
        addressStreet: 'Domaniewska',
        addressPostalCode: '02-672',
        addressCity: 'Warszawa',
        primaryEmployeeId,
        backupEmployeeId,
      },
    })).rejects.toMatchObject({ code: 'P2002' })

    await expect(db.installationOrder.create({
      data: {
        number: 'MON-20260822-9999',
        clientId: created.clientId,
        addressStreet: 'Domaniewska',
        addressPostalCode: '02-672',
        addressCity: 'Warszawa',
        primaryEmployeeId: inactiveEmployeeId,
        backupEmployeeId: 'missing-employee',
      },
    })).rejects.toMatchObject({ code: 'P2003' })
  })
})
