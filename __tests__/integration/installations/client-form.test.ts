import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { createInstallationOrder, updateInstallationOrder } from '@/lib/installations/order-service'
import { createInstallationFormTemplate, createInstallationOrderFormSnapshot, publishInstallationFormTemplate } from '@/lib/installations/catalog-service'
import {
  createClientLink,
  InstallationClientLinkNotFoundError,
  loadPublicInstallationProjection,
  revokeClientLink,
} from '@/lib/installations/client-link'
import {
  autosaveClientForm,
  getInstallationReadiness,
  resolveInstallationClarification,
  startClientFormCorrection,
  submitClientForm,
} from '@/lib/installations/form-service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installations-client-form-'))
const databasePath = path.join(databaseDirectory, 'client-form.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let orderId: string
let ownerId: string
let linkToken: string

function createDb() {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } })
}

function applyMigrations() {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  for (const migrationSqlPath of readdirSync(migrationRoot).sort()
    .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
    .filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databasePath], {
      cwd: process.cwd(), input: readFileSync(migrationSqlPath, 'utf8'), encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
}

beforeAll(async () => {
  applyMigrations()
  db = createDb()
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'FORM', name: 'Formularz montaży' } })
  const [owner, backup] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Opiekun', email: 'form.owner@example.test', position: 'Koordynatorka', costCenterId: 'FORM', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Zastępca', email: 'form.backup@example.test', position: 'Koordynator', costCenterId: 'FORM', startDate: new Date('2026-01-01'), active: true } }),
  ])
  ownerId = owner.id
  const order = await createInstallationOrder(db, {
    client: { name: 'Marta Klientka', email: 'marta.private@example.test', phone: '+48 501 444 555' },
    address: { street: 'Poufna', buildingNumber: '9', postalCode: '00-001', city: 'Warszawa' },
    primaryEmployeeId: owner.id,
    backupEmployeeId: backup.id,
  }, 'form-admin')
  orderId = order.id
  await db.installationRoom.create({
    data: { orderId, name: 'Salon', scopes: { create: { name: 'Ściana z glifem', scopeProducts: { create: { catalogProductId: (await db.installationCatalogProduct.create({ data: { type: { create: { name: 'Profil', nameKey: 'profil', category: { create: { name: 'Sztukateria', nameKey: 'sztukateria' } } } }, name: 'Listwa L-10', nameKey: 'listwa-l-10' } })).id, productNameSnapshot: 'Listwa L-10' } } } } },
  })
  const draft = await createInstallationFormTemplate(db, {
    name: 'Formularz klienta', actorId: 'form-admin', questions: [
      { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', required: true, riskLevel: 'HIGH' },
      { key: 'glify-cm', type: 'DIMENSION', label: 'Ile cm ma glif?', required: true, condition: { questionKey: 'glify', equals: 'YES' } },
      { key: 'kolor', type: 'SINGLE', label: 'Kolor ściany', required: true, options: ['biały', 'beżowy'] },
      { key: 'referencja', type: 'FILE', label: 'Zdjęcie referencyjne', required: true },
    ],
  })
  const template = await publishInstallationFormTemplate(db, draft.id, 'form-admin')
  await createInstallationOrderFormSnapshot(db, { orderId, templateId: template.id }, 'form-admin')
  linkToken = (await createClientLink(db, { orderId, createdById: 'form-admin', expiresAt: new Date('2027-01-01') })).token
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('client form uses a real SQLite revision history', () => {
  it('keeps the public projection minimal and stores only the token hash', async () => {
    const projection = await loadPublicInstallationProjection(db, linkToken)
    const serialized = JSON.stringify(projection)
    const rows = await db.$queryRawUnsafe<Array<{ tokenHash: string }>>('SELECT "tokenHash" FROM "InstallationClientLink"')

    expect(projection).toMatchObject({ brand: 'WallDecor', number: expect.stringMatching(/^MON-/), clientName: 'Marta Klientka' })
    expect(projection.rooms).toEqual([expect.objectContaining({ name: 'Salon' })])
    expect(projection.form.questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'glify', required: true }),
      expect.objectContaining({ key: 'glify-cm', required: true }),
    ]))
    expect(serialized).not.toContain('marta.private@example.test')
    expect(serialized).not.toContain('Poufna')
    expect(serialized).not.toContain(ownerId)
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toContain(linkToken)
    expect(rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('autosaves only visible immutable-schema answers with CAS/idempotency, then freezes revisions on submit', async () => {
    const initial = await loadPublicInstallationProjection(db, linkToken)
    expect(initial.submission).toMatchObject({ status: 'DRAFT', revisionNumber: 1, draftVersion: 0 })
    const draft = initial.submission!
    const autosave = {
      submissionId: draft.id,
      draftVersion: draft.draftVersion,
      clientMutationId: 'autosave-client-form-0001',
      answers: [{ questionKey: 'glify', value: 'UNKNOWN' }, { questionKey: 'kolor', value: 'biały' }],
    }
    const saved = await autosaveClientForm(db, linkToken, autosave)
    const replay = await autosaveClientForm(db, linkToken, autosave)

    expect(saved).toMatchObject({ status: 'DRAFT', draftVersion: 1 })
    expect(replay).toEqual(saved)
    await expect(autosaveClientForm(db, linkToken, {
      submissionId: draft.id, draftVersion: 1, clientMutationId: 'autosave-hidden-0002',
      answers: [{ questionKey: 'glify-cm', value: '12.5' }],
    })).rejects.toMatchObject({ fieldErrors: { 'glify-cm': expect.any(String) } })

    const submitted = await submitClientForm(db, linkToken, {
      submissionId: draft.id, draftVersion: 1, clientMutationId: 'submit-client-form-0001',
    })
    expect(submitted).toMatchObject({ status: 'SUBMITTED', revisionNumber: 1 })
    expect(await getInstallationReadiness(db, orderId)).toMatchObject({ isReady: false, openBlockingCount: 1 })
    await expect(updateInstallationOrder(db, orderId, { status: 'READY_TO_PLAN' }, 'form-owner'))
      .rejects.toMatchObject({ name: 'InstallationOrderTransitionError' })
    const clarification = await db.$queryRawUnsafe<Array<{ id: string; status: string; questionKey: string }>>('SELECT "id", "status", "questionKey" FROM "InstallationClarification" WHERE "orderId" = ?', orderId)
    expect(clarification).toEqual([expect.objectContaining({ status: 'OPEN', questionKey: 'glify' })])

    await resolveInstallationClarification(db, orderId, clarification[0].id, {
      action: 'RESOLVE', resolution: 'Glif ma 12,5 cm.', note: 'Potwierdzone z klientką.', evidenceReference: 'rozmowa-2026-08-22',
    }, 'form-owner')
    expect(await getInstallationReadiness(db, orderId)).toMatchObject({ isReady: true, openBlockingCount: 0 })
    await expect(updateInstallationOrder(db, orderId, { status: 'READY_TO_PLAN' }, 'form-owner'))
      .resolves.toMatchObject({ status: 'READY_TO_PLAN' })

    const correction = await startClientFormCorrection(db, linkToken)
    expect(correction).toMatchObject({ status: 'DRAFT', revisionNumber: 2, draftVersion: 0 })
    const corrected = await autosaveClientForm(db, linkToken, {
      submissionId: correction.id, draftVersion: 0, clientMutationId: 'autosave-correction-0001',
      answers: [{ questionKey: 'glify', value: 'YES' }, { questionKey: 'glify-cm', value: '12,5' }],
    })
    const hiddenNestedAnswer = await autosaveClientForm(db, linkToken, {
      submissionId: correction.id, draftVersion: corrected.draftVersion, clientMutationId: 'autosave-hide-nested-0001',
      answers: [{ questionKey: 'glify', value: 'UNKNOWN' }],
    })
    expect(hiddenNestedAnswer.answers).not.toEqual(expect.arrayContaining([expect.objectContaining({ questionKey: 'glify-cm' })]))
    await submitClientForm(db, linkToken, {
      submissionId: corrected.id, draftVersion: hiddenNestedAnswer.draftVersion, clientMutationId: 'submit-correction-0001',
    })
    const revisions = await db.$queryRawUnsafe<Array<{ id: string; revisionNumber: number; status: string; revisionOfId: string | null }>>('SELECT "id", "revisionNumber", "status", "revisionOfId" FROM "InstallationFormSubmission" WHERE "orderId" = ? ORDER BY "revisionNumber"', orderId)
    const originalAnswer = await db.$queryRawUnsafe<Array<{ normalizedValue: string }>>('SELECT a."normalizedValue" FROM "InstallationAnswer" a JOIN "InstallationFormSubmission" s ON s."id" = a."submissionId" WHERE s."orderId" = ? AND s."revisionNumber" = 1 AND a."questionKey" = ?', orderId, 'glify')
    expect(revisions.map(({ revisionNumber, status }) => ({ revisionNumber, status }))).toEqual([{ revisionNumber: 1, status: 'SUBMITTED' }, { revisionNumber: 2, status: 'SUBMITTED' }])
    expect(revisions[1].revisionOfId).toBe(revisions[0].id)
    expect(originalAnswer).toEqual([{ normalizedValue: 'UNKNOWN' }])
  })

  it('makes revoked, expired and random tokens equally unavailable', async () => {
    const revoked = await createClientLink(db, { orderId, createdById: 'form-admin', expiresAt: new Date('2027-01-01') })
    const expired = await createClientLink(db, { orderId, createdById: 'form-admin', expiresAt: new Date('2027-01-01') })
    await db.installationClientLink.update({ where: { id: expired.link.id }, data: { expiresAt: new Date('2020-01-01') } })
    await revokeClientLink(db, revoked.link.id, 'form-admin')
    for (const token of [revoked.token, expired.token, 'a'.repeat(43)]) {
      await expect(loadPublicInstallationProjection(db, token)).rejects.toBeInstanceOf(InstallationClientLinkNotFoundError)
    }
  })
})
