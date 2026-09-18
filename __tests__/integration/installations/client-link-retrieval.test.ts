import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { createInstallationOrder } from '@/lib/installations/order-service'
import { createInstallationFormTemplate, createInstallationOrderFormSnapshot, publishInstallationFormTemplate } from '@/lib/installations/catalog-service'
import { createClientLink, hashClientLinkSecret, listClientLinkStatuses, resolveActiveClientLink, retrieveCurrentClientLink, revokeClientLink } from '@/lib/installations/client-link'
import { ClientLinkDecryptionError, ClientLinkEncryptionConfigurationError } from '@/lib/installations/client-link-crypto'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-link-retrieval-'))
const databasePath = path.join(directory, 'test.db')
let db: PrismaClient
let orderId: string
const future = () => new Date(Date.now() + 86_400_000)

beforeAll(async () => {
  const root = path.join(process.cwd(), 'prisma/migrations')
  for (const migration of readdirSync(root).sort().map((name) => path.join(root, name, 'migration.sql')).filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databasePath], { input: readFileSync(migration, 'utf8'), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr)
  }
  db = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } })
  await db.costCenter.create({ data: { id: 'RETRIEVAL', name: 'Test' } })
  const people = await Promise.all(['Owner', 'Backup'].map((name) => db.employee.create({ data: { firstName: name, lastName: 'Test', email: `${name}@example.test`, position: 'Test', costCenterId: 'RETRIEVAL', startDate: new Date(), active: true } })))
  const order = await createInstallationOrder(db, { client: { name: 'Test', email: 'client@example.test', phone: '+48 501 444 555' }, address: { street: 'Test', buildingNumber: '1', postalCode: '00-001', city: 'Warszawa' }, primaryEmployeeId: people[0].id, backupEmployeeId: people[1].id }, 'admin')
  orderId = order.id
  const draft = await createInstallationFormTemplate(db, { name: 'Retrieval', actorId: 'admin', questions: [{ key: 'test', type: 'TEXT', label: 'Test' }] })
  const template = await publishInstallationFormTemplate(db, draft.id, 'admin')
  await createInstallationOrderFormSnapshot(db, { orderId, templateId: template.id }, 'admin')
})
afterAll(async () => { await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }) })

describe('persistent client links on migrated SQLite', () => {
  it('stores only ciphertext/digest, retrieves the same URL secret, rotates, revokes and expires', async () => {
    const first = await createClientLink(db, { orderId, createdById: 'admin', expiresAt: future() })
    expect(first.link.tokenCiphertext).not.toContain(first.token)
    expect((await retrieveCurrentClientLink(db, orderId)).token).toBe(first.token)
    const statuses = JSON.stringify(await listClientLinkStatuses(db, orderId))
    expect(statuses).not.toContain(first.token)
    expect(statuses).not.toContain('tokenHash')
    expect(statuses).not.toContain('tokenCiphertext')
    const audit = JSON.stringify(await db.installationAuditEvent.findMany({ where: { orderId } }))
    expect(audit).not.toContain(first.token)
    expect(audit).not.toContain(first.link.tokenHash)
    expect(audit).not.toContain(first.link.tokenCiphertext!)
    const next = await createClientLink(db, { orderId, createdById: 'admin', expiresAt: future() })
    expect((await retrieveCurrentClientLink(db, orderId)).token).toBe(next.token)
    await expect(resolveActiveClientLink(db, first.token)).rejects.toThrow()
    await revokeClientLink(db, next.link.id, 'admin', orderId)
    expect((await retrieveCurrentClientLink(db, orderId)).reason).toBe('NO_ACTIVE_LINK')
    const expired = await createClientLink(db, { orderId, createdById: 'admin', expiresAt: future() })
    await db.installationClientLink.update({ where: { id: expired.link.id }, data: { expiresAt: new Date(0) } })
    expect((await retrieveCurrentClientLink(db, orderId)).reason).toBe('NO_ACTIVE_LINK')
  })
  it('keeps hash-only public links valid and never regenerates them during retrieval', async () => {
    const token = 'b'.repeat(43)
    const old = await db.installationClientLink.create({ data: { orderId, tokenHash: hashClientLinkSecret(token), createdById: 'admin', expiresAt: future() } })
    const count = await db.installationClientLink.count()
    expect((await retrieveCurrentClientLink(db, orderId)).reason).toBe('LEGACY_HASH_ONLY')
    expect((await resolveActiveClientLink(db, token)).id).toBe(old.id)
    expect(await db.installationClientLink.count()).toBe(count)
  })
  it('missing key preserves predecessor; damaged ciphertext fails safely while hash auth remains valid', async () => {
    const current = await createClientLink(db, { orderId, createdById: 'admin', expiresAt: future() })
    const savedKey = process.env.INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY
    try {
      delete process.env.INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY
      await expect(createClientLink(db, { orderId, createdById: 'admin', expiresAt: future() })).rejects.toBeInstanceOf(ClientLinkEncryptionConfigurationError)
      expect((await resolveActiveClientLink(db, current.token)).revokedAt).toBeNull()
    } finally { process.env.INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY = savedKey }
    await db.installationClientLink.update({ where: { id: current.link.id }, data: { tokenCiphertext: 'damaged' } })
    await expect(retrieveCurrentClientLink(db, orderId)).rejects.toBeInstanceOf(ClientLinkDecryptionError)
    expect((await resolveActiveClientLink(db, current.token)).id).toBe(current.link.id)
  })
})
