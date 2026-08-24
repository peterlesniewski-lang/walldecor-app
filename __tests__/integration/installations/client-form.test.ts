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
  hashClientLinkSecret,
  InstallationClientLinkNotFoundError,
  listClientLinkStatuses,
  markClientLinkSent,
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
const dayMs = 24 * 60 * 60 * 1000

function futureDate(days = 30) {
  return new Date(Date.now() + days * dayMs)
}

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
      { key: 'opis', type: 'TEXT', label: 'Opis dodatkowy' },
      { key: 'liczba', type: 'NUMBER', label: 'Liczba dodatkowa' },
      { key: 'wymiar', type: 'DIMENSION', label: 'Wymiar dodatkowy' },
      { key: 'wariant', type: 'SINGLE', label: 'Wariant dodatkowy', options: ['A', 'B'] },
      { key: 'wykonczenie', type: 'MULTI', label: 'Wykończenie dodatkowe', options: ['mat', 'satyna'] },
      { key: 'pytanie-opcjonalne', type: 'YES_NO_UNKNOWN', label: 'Opcjonalne pytanie' },
      { key: 'referencja', type: 'FILE', label: 'Zdjęcie referencyjne', required: true },
    ],
  })
  const template = await publishInstallationFormTemplate(db, draft.id, 'form-admin')
  await createInstallationOrderFormSnapshot(db, { orderId, templateId: template.id }, 'form-admin')
  linkToken = (await createClientLink(db, { orderId, createdById: 'form-admin', expiresAt: futureDate() })).token
  const initial = await loadPublicInstallationProjection(db, linkToken)
  const link = await db.installationClientLink.findUniqueOrThrow({ where: { tokenHash: hashClientLinkSecret(linkToken) } })
  const submission = await db.installationFormSubmission.findUniqueOrThrow({ where: { draftKey: orderId } })
  await db.installationFile.create({ data: {
    id: 'client-form-existing-required-file', orderId, formSubmissionId: submission.id, clientLinkId: link.id,
    purpose: 'CLIENT_QUESTION', questionKey: 'referencja', originalFilename: 'fixture.png', contentType: 'image/png', source: 'WEB', createdById: 'PUBLIC_CLIENT', updatedAt: new Date(),
  } })
  await db.installationFile.update({ where: { id: 'client-form-existing-required-file' }, data: { status: 'READY', byteSize: 1, sha256: 'a'.repeat(64), updatedAt: new Date() } })
  expect(initial.submission.status).toBe('DRAFT')
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

    expect(projection).toMatchObject({
      brand: 'WallDecor', number: expect.stringMatching(/^MON-/), contact: { label: 'WallDecor', email: 'info@walldecor.pl' },
    })
    expect(projection.rooms).toEqual([expect.objectContaining({ name: 'Salon' })])
    expect(projection.form.questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'glify', required: true }),
      expect.objectContaining({ key: 'glify-cm', required: true }),
    ]))
    expect(serialized).not.toContain('marta.private@example.test')
    expect(serialized).not.toContain('Poufna')
    expect(serialized).not.toContain('Marta Klientka')
    expect(serialized).not.toContain('Anna Opiekun')
    expect(serialized).not.toContain(ownerId)
    expect(projection).not.toHaveProperty('clientName')
    expect(projection).not.toHaveProperty('coordinator')
    expect(projection.submission).not.toHaveProperty('id')
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toContain(linkToken)
    expect(rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('autosaves only visible immutable-schema answers with CAS/idempotency, then freezes revisions on submit', async () => {
    const initial = await loadPublicInstallationProjection(db, linkToken)
    expect(initial.submission).toMatchObject({ status: 'DRAFT', revisionNumber: 1, draftVersion: 0 })
    const draft = initial.submission!
    const autosave = {
      revisionNumber: draft.revisionNumber,
      draftVersion: draft.draftVersion,
      clientMutationId: 'autosave-client-form-0001',
      answers: [{ questionKey: 'glify', value: 'UNKNOWN' }, { questionKey: 'kolor', value: 'biały' }],
    }
    const saved = await autosaveClientForm(db, linkToken, autosave)
    const replay = await autosaveClientForm(db, linkToken, autosave)

    expect(saved).toMatchObject({ status: 'DRAFT', draftVersion: 1 })
    expect(replay).toEqual(saved)
    await expect(autosaveClientForm(db, linkToken, {
      revisionNumber: draft.revisionNumber, draftVersion: 1, clientMutationId: 'autosave-hidden-0002',
      answers: [{ questionKey: 'glify-cm', value: '12.5' }],
    })).rejects.toMatchObject({ fieldErrors: { 'glify-cm': expect.any(String) } })

    const submitted = await submitClientForm(db, linkToken, {
      revisionNumber: draft.revisionNumber, draftVersion: 1, clientMutationId: 'submit-client-form-0001',
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
      revisionNumber: correction.revisionNumber, draftVersion: 0, clientMutationId: 'autosave-correction-0001',
      answers: [{ questionKey: 'glify', value: 'YES' }, { questionKey: 'glify-cm', value: '12,5' }],
    })
    const hiddenNestedAnswer = await autosaveClientForm(db, linkToken, {
      revisionNumber: correction.revisionNumber, draftVersion: corrected.draftVersion, clientMutationId: 'autosave-hide-nested-0001',
      answers: [{ questionKey: 'glify', value: 'UNKNOWN' }],
    })
    expect(hiddenNestedAnswer.answers).not.toEqual(expect.arrayContaining([expect.objectContaining({ questionKey: 'glify-cm' })]))
    await submitClientForm(db, linkToken, {
      revisionNumber: corrected.revisionNumber, draftVersion: hiddenNestedAnswer.draftVersion, clientMutationId: 'submit-correction-0001',
    })
    const revisions = await db.$queryRawUnsafe<Array<{ id: string; revisionNumber: number; status: string; revisionOfId: string | null }>>('SELECT "id", "revisionNumber", "status", "revisionOfId" FROM "InstallationFormSubmission" WHERE "orderId" = ? ORDER BY "revisionNumber"', orderId)
    const originalAnswer = await db.$queryRawUnsafe<Array<{ normalizedValue: string }>>('SELECT a."normalizedValue" FROM "InstallationAnswer" a JOIN "InstallationFormSubmission" s ON s."id" = a."submissionId" WHERE s."orderId" = ? AND s."revisionNumber" = 1 AND a."questionKey" = ?', orderId, 'glify')
    expect(revisions.map(({ revisionNumber, status }) => ({ revisionNumber, status }))).toEqual([{ revisionNumber: 1, status: 'SUBMITTED' }, { revisionNumber: 2, status: 'SUBMITTED' }])
    expect(revisions[1].revisionOfId).toBe(revisions[0].id)
    expect(originalAnswer).toEqual([{ normalizedValue: 'UNKNOWN' }])
  })

  it('removes recursively hidden answers and does not require a hidden file on submit', async () => {
    const backup = await db.employee.findFirstOrThrow({ where: { email: 'form.backup@example.test' } })
    const recursiveOrder = await createInstallationOrder(db, {
      client: { name: 'Rekurencyjny klient', email: 'recursive@example.test', phone: '+48 501 444 556' },
      address: { street: 'Testowa', buildingNumber: '10', postalCode: '00-002', city: 'Warszawa' },
      primaryEmployeeId: ownerId,
      backupEmployeeId: backup.id,
    }, 'form-admin')
    const draft = await createInstallationFormTemplate(db, {
      name: 'Formularz rekurencyjnej widoczności', actorId: 'form-admin', questions: [
        { key: 'okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?', required: true },
        { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', required: true, condition: { questionKey: 'okna', equals: 'YES' } },
        { key: 'glebokosc', type: 'DIMENSION', label: 'Jaka jest głębokość?', required: true, condition: { questionKey: 'glify', equals: 'YES' } },
        { key: 'zdjecie-glifu', type: 'FILE', label: 'Dodaj zdjęcie glifu', required: true, condition: { questionKey: 'glify', equals: 'YES' } },
      ],
    })
    const template = await publishInstallationFormTemplate(db, draft.id, 'form-admin')
    await createInstallationOrderFormSnapshot(db, { orderId: recursiveOrder.id, templateId: template.id }, 'form-admin')
    const recursiveToken = (await createClientLink(db, {
      orderId: recursiveOrder.id, createdById: 'form-admin', expiresAt: futureDate(),
    })).token
    const initial = await loadPublicInstallationProjection(db, recursiveToken)

    const filled = await autosaveClientForm(db, recursiveToken, {
      revisionNumber: initial.submission.revisionNumber,
      draftVersion: initial.submission.draftVersion,
      clientMutationId: 'recursive-fill-0001',
      answers: [
        { questionKey: 'okna', value: 'YES' },
        { questionKey: 'glify', value: 'YES' },
        { questionKey: 'glebokosc', value: '12' },
      ],
    })
    const hidden = await autosaveClientForm(db, recursiveToken, {
      revisionNumber: filled.revisionNumber,
      draftVersion: filled.draftVersion,
      clientMutationId: 'recursive-hide-0001',
      answers: [{ questionKey: 'okna', value: 'NO' }],
    })

    expect(hidden.answers.map((answer) => answer.questionKey)).toEqual(['okna'])
    const submission = await db.installationFormSubmission.findUniqueOrThrow({
      where: { orderId_revisionNumber: { orderId: recursiveOrder.id, revisionNumber: 1 } },
    })
    expect(await db.installationAnswer.findMany({
      where: { submissionId: submission.id }, orderBy: { questionKey: 'asc' }, select: { questionKey: true },
    })).toEqual([{ questionKey: 'okna' }])
    await expect(submitClientForm(db, recursiveToken, {
      revisionNumber: hidden.revisionNumber,
      draftVersion: hidden.draftVersion,
      clientMutationId: 'recursive-submit-0001',
    })).resolves.toMatchObject({ status: 'SUBMITTED' })
  })

  it('deletes deliberately cleared optional answers of every supported input kind before submit', async () => {
    const correction = await startClientFormCorrection(db, linkToken)
    const filled = await autosaveClientForm(db, linkToken, {
      revisionNumber: correction.revisionNumber,
      draftVersion: correction.draftVersion,
      clientMutationId: 'optional-fill-0001',
      answers: [
        { questionKey: 'opis', value: 'Przy oknie' },
        { questionKey: 'liczba', value: '4,50' },
        { questionKey: 'wymiar', value: '12.0' },
        { questionKey: 'wariant', value: 'A' },
        { questionKey: 'wykonczenie', value: ['mat', 'satyna'] },
        { questionKey: 'pytanie-opcjonalne', value: 'NO' },
      ],
    })
    expect(filled.answers.map((answer) => answer.questionKey)).toEqual(expect.arrayContaining([
      'opis', 'liczba', 'wymiar', 'wariant', 'wykonczenie', 'pytanie-opcjonalne',
    ]))

    const cleared = await autosaveClientForm(db, linkToken, {
      revisionNumber: correction.revisionNumber,
      draftVersion: filled.draftVersion,
      clientMutationId: 'optional-clear-0001',
      answers: [
        { questionKey: 'opis', value: null },
        { questionKey: 'liczba', value: null },
        { questionKey: 'wymiar', value: null },
        { questionKey: 'wariant', value: null },
        { questionKey: 'wykonczenie', value: [] },
        { questionKey: 'pytanie-opcjonalne', value: null },
      ],
    })
    expect(cleared.answers.map((answer) => answer.questionKey)).not.toEqual(expect.arrayContaining([
      'opis', 'liczba', 'wymiar', 'wariant', 'wykonczenie', 'pytanie-opcjonalne',
    ]))
    await expect(submitClientForm(db, linkToken, {
      revisionNumber: correction.revisionNumber,
      draftVersion: cleared.draftVersion,
      clientMutationId: 'optional-clear-submit-0001',
    })).resolves.toMatchObject({ status: 'SUBMITTED' })
  })

  it('never replays a previously accepted autosave or submit after its link is revoked', async () => {
    const correction = await startClientFormCorrection(db, linkToken)
    const autosaveRequest = {
      revisionNumber: correction.revisionNumber,
      draftVersion: correction.draftVersion,
      clientMutationId: 'revoke-replay-autosave-0001',
      answers: [{ questionKey: 'glify', value: 'UNKNOWN' }, { questionKey: 'kolor', value: 'biały' }],
    }
    const saved = await autosaveClientForm(db, linkToken, autosaveRequest)
    const submitRequest = {
      revisionNumber: correction.revisionNumber,
      draftVersion: saved.draftVersion,
      clientMutationId: 'revoke-replay-submit-0001',
    }
    await submitClientForm(db, linkToken, submitRequest)
    const current = await db.installationClientLink.findUniqueOrThrow({ where: { tokenHash: hashClientLinkSecret(linkToken) } })
    await revokeClientLink(db, current.id, 'form-admin')

    await expect(autosaveClientForm(db, linkToken, autosaveRequest)).rejects.toBeInstanceOf(InstallationClientLinkNotFoundError)
    await expect(submitClientForm(db, linkToken, submitRequest)).rejects.toBeInstanceOf(InstallationClientLinkNotFoundError)
  })

  it('makes revoked, expired and random tokens equally unavailable', async () => {
    const revoked = await createClientLink(db, { orderId, createdById: 'form-admin', expiresAt: futureDate() })
    const expired = await createClientLink(db, { orderId, createdById: 'form-admin', expiresAt: futureDate() })
    await db.installationClientLink.update({ where: { id: expired.link.id }, data: { expiresAt: new Date('2020-01-01') } })
    await revokeClientLink(db, revoked.link.id, 'form-admin')
    for (const token of [revoked.token, expired.token, 'a'.repeat(43)]) {
      await expect(loadPublicInstallationProjection(db, token)).rejects.toBeInstanceOf(InstallationClientLinkNotFoundError)
    }
  })

  it('rejects a direct answer INSERT into an already submitted revision without changing history', async () => {
    const submitted = await db.installationFormSubmission.findFirstOrThrow({ where: { orderId, status: 'SUBMITTED' }, orderBy: { revisionNumber: 'asc' } })
    const before = await db.installationAnswer.count({ where: { submissionId: submitted.id } })

    await expect(db.installationAnswer.create({ data: {
      submissionId: submitted.id, questionKey: 'attempted-late-answer', questionType: 'TEXT',
      valueJson: JSON.stringify({ type: 'TEXT', value: 'late' }), normalizedValue: 'late',
    } })).rejects.toBeTruthy()
    expect(await db.installationAnswer.count({ where: { submissionId: submitted.id } })).toBe(before)
  })

  it('rejects every direct mutation and deletion of a submitted revision while drafts remain writable', async () => {
    const [submitted, correction] = await Promise.all([
      db.installationFormSubmission.findFirstOrThrow({ where: { orderId, status: 'SUBMITTED', revisionNumber: 1 } }),
      db.installationFormSubmission.findFirstOrThrow({ where: { orderId, status: 'SUBMITTED', revisionNumber: 2 } }),
    ])
    const rollback = new Error('ROLLBACK_SUBMITTED_PARENT_GUARD')

    await expect(db.$transaction(async (tx) => {
      for (const data of [
        { status: 'DRAFT' },
        { revisionOfId: null },
        { revisionNumber: { increment: 100 } },
        { draftVersion: { increment: 1 } },
        { submittedAt: new Date('2026-08-22T12:00:00.000Z') },
      ]) {
        await expect(tx.installationFormSubmission.update({ where: { id: correction.id }, data })).rejects.toBeTruthy()
      }
      await expect(tx.$executeRawUnsafe(
        'UPDATE "InstallationFormSubmission" SET "draftVersion" = "draftVersion" + 1 WHERE "id" = ?', correction.id,
      )).rejects.toBeTruthy()
      const disposable = await tx.installationFormSubmission.create({ data: {
        orderId: submitted.orderId,
        formSnapshotId: submitted.formSnapshotId,
        revisionNumber: 99,
        status: 'SUBMITTED',
        submittedAt: new Date(),
      } })
      await expect(tx.installationFormSubmission.delete({ where: { id: disposable.id } })).rejects.toBeTruthy()
      throw rollback
    })).rejects.toBe(rollback)

    const draft = await db.installationFormSubmission.create({ data: {
      orderId: submitted.orderId,
      formSnapshotId: submitted.formSnapshotId,
      revisionNumber: 100,
      status: 'DRAFT',
      draftKey: `${submitted.orderId}-guard-draft`,
    } })
    await expect(db.installationFormSubmission.update({ where: { id: draft.id }, data: { draftVersion: 1 } })).resolves.toMatchObject({ draftVersion: 1 })
    await expect(db.installationFormSubmission.delete({ where: { id: draft.id } })).resolves.toMatchObject({ id: draft.id })
  })

  it('marks a client link sent once, preserving the first actor and rejecting inactive or foreign links', async () => {
    const firstLink = await createClientLink(db, { orderId, createdById: 'form-admin', expiresAt: futureDate() })
    const first = await markClientLinkSent(db, firstLink.link.id, 'send-owner', orderId)
    const repeated = await markClientLinkSent(db, firstLink.link.id, 'different-actor', orderId)
    const sentAudits = await db.installationAuditEvent.findMany({
      where: { orderId, action: 'INSTALLATION_CLIENT_LINK_SENT' }, orderBy: { createdAt: 'asc' },
    })
    expect(first.sentAt).not.toBeNull()
    expect(first.sentById).toBe('send-owner')
    expect(repeated.sentAt).toEqual(first.sentAt)
    expect(repeated.sentById).toBe('send-owner')
    expect((await listClientLinkStatuses(db, orderId)).find((link) => link.id === firstLink.link.id)).toMatchObject({
      sentAt: first.sentAt,
      sentById: 'send-owner',
    })
    expect(sentAudits).toHaveLength(1)
    expect(JSON.parse(sentAudits[0].metadataJson)).toEqual({ linkId: firstLink.link.id, sentAt: first.sentAt!.toISOString() })

    const wrongOrder = await createClientLink(db, { orderId, createdById: 'form-admin', expiresAt: futureDate() })
    const sentCountBeforeWrongOrder = await db.installationAuditEvent.count({ where: { orderId, action: 'INSTALLATION_CLIENT_LINK_SENT' } })
    await expect(markClientLinkSent(db, wrongOrder.link.id, 'send-owner', 'another-order')).rejects.toBeInstanceOf(InstallationClientLinkNotFoundError)
    expect(await db.installationClientLink.findUniqueOrThrow({ where: { id: wrongOrder.link.id } })).toMatchObject({ sentAt: null, sentById: null })
    expect(await db.installationAuditEvent.count({ where: { orderId, action: 'INSTALLATION_CLIENT_LINK_SENT' } })).toBe(sentCountBeforeWrongOrder)

    const expired = await createClientLink(db, { orderId, createdById: 'form-admin', expiresAt: futureDate() })
    await db.installationClientLink.update({ where: { id: expired.link.id }, data: { expiresAt: new Date('2020-01-01') } })
    const sentCountBeforeExpired = await db.installationAuditEvent.count({ where: { orderId, action: 'INSTALLATION_CLIENT_LINK_SENT' } })
    await expect(markClientLinkSent(db, expired.link.id, 'send-owner', orderId)).rejects.toBeInstanceOf(InstallationClientLinkNotFoundError)
    expect(await db.installationClientLink.findUniqueOrThrow({ where: { id: expired.link.id } })).toMatchObject({ sentAt: null, sentById: null })
    expect(await db.installationAuditEvent.count({ where: { orderId, action: 'INSTALLATION_CLIENT_LINK_SENT' } })).toBe(sentCountBeforeExpired)

    const revoked = await createClientLink(db, { orderId, createdById: 'form-admin', expiresAt: futureDate() })
    await revokeClientLink(db, revoked.link.id, 'form-admin', orderId)
    const sentCountBeforeRevoked = await db.installationAuditEvent.count({ where: { orderId, action: 'INSTALLATION_CLIENT_LINK_SENT' } })
    await expect(markClientLinkSent(db, revoked.link.id, 'send-owner', orderId)).rejects.toBeInstanceOf(InstallationClientLinkNotFoundError)
    expect(await db.installationClientLink.findUniqueOrThrow({ where: { id: revoked.link.id } })).toMatchObject({ sentAt: null, sentById: null })
    expect(await db.installationAuditEvent.count({ where: { orderId, action: 'INSTALLATION_CLIENT_LINK_SENT' } })).toBe(sentCountBeforeRevoked)
  })
})
