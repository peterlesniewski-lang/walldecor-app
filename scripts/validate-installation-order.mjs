import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const workspace = process.cwd()
const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installation-validator-'))
const databasePath = path.join(databaseDirectory, 'installation-order.db')
const databaseUrl = `file:${databasePath}`

const validationProgram = `
import { PrismaClient } from './src/generated/prisma'
import * as serviceModule from './src/lib/installations/order-service'

const { createInstallationOrder, getInstallationOrder, updateInstallationOrder, archiveInstallationOrder, listInstallationOrders } = serviceModule.default
const databaseUrl = process.env.DATABASE_URL
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

try {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'JAG', name: 'Jagiellońska' } })
  const [primary, backup] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Opiekun', email: 'validator.primary@example.test', position: 'Koordynator', costCenterId: 'JAG', startDate: new Date('2026-01-01T12:00:00.000Z') } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Zastępca', email: 'validator.backup@example.test', position: 'Koordynator', costCenterId: 'JAG', startDate: new Date('2026-01-01T12:00:00.000Z') } }),
  ])

  const created = await createInstallationOrder(db, {
    client: { name: 'Klient walidatora', email: 'validator.client@example.test', phone: '+48 501 234 567' },
    address: { street: 'Puławska', buildingNumber: '17', postalCode: '02-515', city: 'Warszawa' },
    primaryEmployeeId: primary.id,
    backupEmployeeId: backup.id,
  }, 'validator-admin')
  if (!created.number || created.auditEvents[0]?.action !== 'INSTALLATION_ORDER_CREATED') throw new Error('CREATE_AUDIT_FAILED')

  const updated = await updateInstallationOrder(db, created.id, {
    address: { buildingNumber: '19B' },
    client: { phone: '+48 511 000 111' },
  }, 'validator-manager')
  if (updated.addressBuildingNumber !== '19B' || updated.client.phone !== '+48 511 000 111') throw new Error('UPDATE_READBACK_FAILED')

  const archived = await archiveInstallationOrder(db, created.id, 'validator-admin')
  if (archived.status !== 'ARCHIVED' || !archived.archivedAt) throw new Error('ARCHIVE_FAILED')
  if ((await listInstallationOrders(db)).length !== 0) throw new Error('ACTIVE_LIST_STILL_CONTAINS_ARCHIVED_ORDER')
  await db.$disconnect()

  const restarted = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await restarted.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  const persisted = await getInstallationOrder(restarted, created.id)
  if (persisted?.addressBuildingNumber !== '19B' || persisted.status !== 'ARCHIVED' || persisted.auditEvents.length !== 3) {
    throw new Error('RESTART_PERSISTENCE_FAILED')
  }
  await restarted.$disconnect()
  console.log(JSON.stringify({ status: 'ok', number: created.number, auditEvents: persisted.auditEvents.length }))
} catch (error) {
  await db.$disconnect().catch(() => undefined)
  throw error
}
`

try {
  const schemaSql = execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
    { cwd: workspace, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' },
  )
  execFileSync('sqlite3', [databasePath], { input: schemaSql, cwd: workspace })
  execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', validationProgram],
    { cwd: workspace, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit' },
  )
} finally {
  rmSync(databaseDirectory, { recursive: true, force: true })
}
