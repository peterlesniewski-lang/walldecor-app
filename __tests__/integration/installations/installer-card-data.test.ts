import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { getInstallerInstallationCardData } from '@/lib/installations/installer-card-data'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-installer-card-'))
const databasePath = path.join(directory, 'card.db')
let db: PrismaClient
const readResults: unknown[] = []
const viewer = { role: 'INSTALLER' as const, employeeId: 'own', employeeActive: true, authorized: true }

beforeAll(async () => {
  const migrations = path.join(process.cwd(), 'prisma/migrations')
  for (const file of readdirSync(migrations).sort().map((name) => path.join(migrations, name, 'migration.sql')).filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databasePath], { input: readFileSync(file, 'utf8'), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
  db = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'ICD', name: 'Installer card' } })
  for (const id of ['owner', 'backup', 'own', 'other', 'order-only', 'outsider']) {
    await db.employee.create({ data: { id, firstName: id, lastName: 'Test', email: `${id}-PRIVATE@example.test`, position: 'Test', costCenterId: 'ICD', startDate: new Date('2026-01-01') } })
  }
  await db.installationClient.create({ data: { id: 'client', name: 'Klient', email: 'CLIENT-PRIVATE@example.test', phone: 'PRIVATE-PHONE' } })
  await db.installationOrder.create({ data: { id: 'order', number: 'CARD-TEST', clientId: 'client', primaryEmployeeId: 'owner', backupEmployeeId: 'backup', addressStreet: 'Sienna', addressPostalCode: '00-001', addressCity: 'Warszawa', externalId: 'PRIVATE-EXTERNAL-ID' } })
  await db.installationOrderInstaller.create({ data: { orderId: 'order', employeeId: 'order-only' } })
  await db.installationRoom.create({ data: { id: 'room', orderId: 'order', name: 'Salon' } })
  for (const [id, employeeId, sortOrder] of [['own-scope', 'own', 1], ['other-scope', 'other', 0]] as const) {
    await db.installationScope.create({ data: { id, roomId: 'room', name: id, sortOrder } })
    await db.installationScopeAssignment.create({ data: { orderId: 'order', scopeId: id, employeeId, createdById: 'PRIVATE-ACTOR' } })
  }
  for (const [id, scopeIds] of [['shared-visit', ['own-scope', 'other-scope']], ['foreign-visit', ['other-scope']]] as const) {
    await db.installationVisit.create({ data: { id, orderId: 'order', startsAt: new Date('2027-01-01'), endsAt: new Date('2027-01-02'), status: 'CONFIRMED', note: 'PRIVATE-VISIT-NOTE', createdById: 'PRIVATE-ACTOR', scopes: { create: scopeIds.map((scopeId) => ({ orderId: 'order', scopeId })) }, syncStates: { create: { kind: 'GOOGLE_CALENDAR', status: 'SYNCED', externalId: `PRIVATE-CALENDAR-${id}`, externalUrl: 'https://private.example.test', lastErrorMessage: 'PRIVATE-SYNC-ERROR' } } } })
  }
  // Observe the actual database results before the helper can present or strip them.
  db.$use(async (params, next) => { const result = await next(params); if (params.action.startsWith('find') || params.action === 'queryRaw') readResults.push(result); return result })
})

afterAll(async () => { await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }) })

describe('installer card database boundary', () => {
  it('selects no private values and returns only participating visits and assigned scopes', async () => {
    readResults.length = 0
    const card = await getInstallerInstallationCardData(db, 'order', viewer)
    expect(card?.order.client).toEqual({ name: 'Klient' })
    expect(card?.rooms[0].scopes.map((scope) => scope.id)).toEqual(['own-scope'])
    expect(card?.visits).toHaveLength(1)
    expect(card?.visits[0]).toMatchObject({ id: 'shared-visit', scopeIds: ['other-scope', 'own-scope'], participants: [{ employeeId: 'own', name: 'own Test', scopeIds: ['own-scope'], inviteStatus: 'READY' }], syncState: { status: 'SYNCED' } })
    expect(JSON.stringify(readResults)).not.toContain('PRIVATE')
    expect(JSON.stringify(readResults)).not.toContain('foreign-visit')
    expect(JSON.stringify(card)).not.toContain('email')
  })

  it('keeps order-only access without inventing participation, and denies unrelated employees', async () => {
    expect(await getInstallerInstallationCardData(db, 'order', { ...viewer, employeeId: 'order-only' })).toMatchObject({ order: { id: 'order' }, rooms: [], visits: [] })
    readResults.length = 0
    expect(await getInstallerInstallationCardData(db, 'order', { ...viewer, employeeId: 'outsider' })).toBeNull()
    expect(readResults).toEqual([null])
  })

  it('fails closed for an unverified, inactive or absent employee before database reads', async () => {
    for (const denied of [{ ...viewer, authorized: false }, { ...viewer, employeeActive: false }, { ...viewer, employeeId: null }, { ...viewer, role: 'EMPLOYEE' as const }]) {
      readResults.length = 0
      expect(await getInstallerInstallationCardData(db, 'order', denied)).toBeNull()
      expect(readResults).toEqual([])
    }
  })

  it('matches trimmed email eligibility without reading the address and preserves archived read access', async () => {
    await db.employee.update({ where: { id: 'own' }, data: { email: '\t\n\u00a0 ' } })
    await db.installationOrder.update({ where: { id: 'order' }, data: { status: 'ARCHIVED', archivedAt: new Date() } })
    const card = await getInstallerInstallationCardData(db, 'order', viewer)
    expect(card?.order.status).toBe('ARCHIVED')
    expect(card?.visits[0].participants[0].inviteStatus).toBe('MISSING_EMAIL')
    await db.employee.update({ where: { id: 'own' }, data: { active: false } })
    expect(await getInstallerInstallationCardData(db, 'order', viewer)).toBeNull()
  })
})
