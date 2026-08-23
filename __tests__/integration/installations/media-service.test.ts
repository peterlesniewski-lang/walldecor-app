import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { createInstallationFormTemplate, createInstallationOrderFormSnapshot, publishInstallationFormTemplate } from '@/lib/installations/catalog-service'
import { createClientLink } from '@/lib/installations/client-link'
import { autosaveClientForm, startClientFormCorrection, submitClientForm, InstallationFormValidationError } from '@/lib/installations/form-service'
import { createInstallationOrder } from '@/lib/installations/order-service'
import {
  createClientQuestionFile,
  createMismatchEvidenceFile,
  createMobileUploadHandoff,
  InstallationMediaAccessError,
  listClientQuestionFiles,
  redeemMobileUploadHandoff,
  revokeMobileUploadHandoff,
  softDeleteInstallationFile,
  uploadMobileHandoffFile,
  type InstallationMediaAdapter,
} from '@/lib/installation-media/service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installations-media-'))
const databasePath = path.join(databaseDirectory, 'media.db')
const databaseUrl = `file:${databasePath}`
let db: PrismaClient
let token: string
let otherToken: string
let orderId: string
let otherOrderId: string

const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const media: InstallationMediaAdapter = {
  upload: async ({ fileId, jobId, contentType, bytes }) => ({
    fileId, jobId, contentType, byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }),
  download: async () => new Response(imageBytes, { headers: { 'Content-Type': 'image/png' } }),
  remove: async () => undefined,
}

function applyMigrations() {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  for (const migrationSqlPath of readdirSync(migrationRoot).sort()
    .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
    .filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databasePath], { cwd: process.cwd(), input: readFileSync(migrationSqlPath, 'utf8'), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
}

async function seedOrder(email: string, number: string) {
  const order = await createInstallationOrder(db, {
    client: { name: `Klient ${number}`, email, phone: '+48 500 600 700' },
    address: { street: 'Plikowa', buildingNumber: '5', postalCode: '00-005', city: 'Warszawa' },
    primaryEmployeeId: 'owner', backupEmployeeId: 'backup',
  }, 'admin')
  const draft = await createInstallationFormTemplate(db, {
    name: `Pliki ${number}`, actorId: 'admin',
    questions: [
      { key: 'opis-sciany', type: 'TEXT', label: 'Opis ściany' },
      { key: 'zdjecie-sciany', type: 'FILE', label: 'Dodaj zdjęcie ściany', required: true },
    ],
  })
  const template = await publishInstallationFormTemplate(db, draft.id, 'admin')
  await createInstallationOrderFormSnapshot(db, { orderId: order.id, templateId: template.id }, 'admin')
  const link = await createClientLink(db, { orderId: order.id, createdById: 'admin', expiresAt: new Date(Date.now() + 86_400_000) })
  return { order, token: link.token }
}

beforeAll(async () => {
  applyMigrations()
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'MEDIA', name: 'Media' } })
  await db.employee.createMany({ data: [
    { id: 'owner', firstName: 'Anna', lastName: 'Plik', email: 'media.owner@example.test', position: 'Koordynator', costCenterId: 'MEDIA', startDate: new Date('2026-01-01'), active: true },
    { id: 'backup', firstName: 'Bartek', lastName: 'Plik', email: 'media.backup@example.test', position: 'Koordynator', costCenterId: 'MEDIA', startDate: new Date('2026-01-01'), active: true },
  ] })
  const primary = await seedOrder('media.client@example.test', 'M-1')
  const other = await seedOrder('media.other@example.test', 'M-2')
  orderId = primary.order.id
  otherOrderId = other.order.id
  token = primary.token
  otherToken = other.token
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('private client files', () => {
  it('requires an explicit correction after submit and preserves its prior answers and files', async () => {
    await expect(submitClientForm(db, token, { revisionNumber: 1, draftVersion: 0, clientMutationId: 'media-required-file-before-upload' }))
      .rejects.toBeInstanceOf(InstallationFormValidationError)

    const created = await createClientQuestionFile(db, token, {
      questionKey: 'zdjecie-sciany', filename: 'sciana.png', contentType: 'image/png', bytes: imageBytes,
    }, media)
    expect(created.status).toBe('READY')
    expect(created.sha256).toBe(createHash('sha256').update(imageBytes).digest('hex'))
    expect(await listClientQuestionFiles(db, token, 'zdjecie-sciany')).toHaveLength(1)
    await expect(listClientQuestionFiles(db, otherToken, 'zdjecie-sciany')).resolves.toEqual([])

    const saved = await autosaveClientForm(db, token, {
      revisionNumber: 1,
      draftVersion: 0,
      clientMutationId: 'media-answer-before-submit',
      answers: [{ questionKey: 'opis-sciany', value: 'Ściana przy oknie.' }],
    })
    const preSubmitHandoff = await createMobileUploadHandoff(db, token, { questionKey: 'zdjecie-sciany' })
    const dormantPreSubmitHandoff = await createMobileUploadHandoff(db, token, { questionKey: 'zdjecie-sciany' })
    const preSubmitMobile = await redeemMobileUploadHandoff(db, preSubmitHandoff.code)
    await submitClientForm(db, token, { revisionNumber: 1, draftVersion: saved.draftVersion, clientMutationId: 'media-required-file-after-upload' })
    const submitted = await db.installationFormSubmission.findUniqueOrThrow({ where: { orderId_revisionNumber: { orderId, revisionNumber: 1 } } })

    await expect(uploadMobileHandoffFile(db, preSubmitMobile.cookieValue, {
      filename: 'po-wyslaniu.png', contentType: 'image/png', bytes: imageBytes,
    }, media)).rejects.toBeInstanceOf(InstallationMediaAccessError)
    await expect(redeemMobileUploadHandoff(db, dormantPreSubmitHandoff.code)).rejects.toBeInstanceOf(InstallationMediaAccessError)
    await expect(listClientQuestionFiles(db, token, 'zdjecie-sciany')).rejects.toBeInstanceOf(InstallationMediaAccessError)
    await expect(createClientQuestionFile(db, token, {
      questionKey: 'zdjecie-sciany', filename: 'niejawna-korekta.png', contentType: 'image/png', bytes: imageBytes,
    }, media)).rejects.toBeInstanceOf(InstallationMediaAccessError)
    await expect(createMobileUploadHandoff(db, token, { questionKey: 'zdjecie-sciany' })).rejects.toBeInstanceOf(InstallationMediaAccessError)
    await expect(db.installationFormSubmission.count({ where: { orderId } })).resolves.toBe(1)
    await expect(db.installationFormSubmission.findUnique({ where: { draftKey: orderId } })).resolves.toBeNull()
    await expect(db.installationFile.count({ where: { orderId } })).resolves.toBe(1)
    await expect(db.mobileUploadHandoff.count({ where: { orderId } })).resolves.toBe(2)

    const correction = await startClientFormCorrection(db, token)
    expect(correction).toMatchObject({ revisionNumber: 2, status: 'DRAFT' })
    expect(correction.answers).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionKey: 'opis-sciany', value: 'Ściana przy oknie.' }),
    ]))
    await expect(db.installationFormSubmission.findUniqueOrThrow({ where: { draftKey: orderId } }))
      .resolves.toMatchObject({ id: expect.any(String), revisionOfId: submitted.id })
    await expect(listClientQuestionFiles(db, token, 'zdjecie-sciany')).resolves.toEqual([
      expect.objectContaining({ id: created.id, originalFilename: 'sciana.png' }),
    ])

    await softDeleteInstallationFile(db, orderId, created.id, 'owner-user', media)
    await expect(listClientQuestionFiles(db, token, 'zdjecie-sciany')).resolves.toEqual([])
  })

  it('burns the QR code once, stores no plaintext code, and lets the mobile session add only its bound question file', async () => {
    const handoff = await createMobileUploadHandoff(db, token, { questionKey: 'zdjecie-sciany' })
    expect(handoff.code).toHaveLength(43)
    const persisted = await db.mobileUploadHandoff.findUniqueOrThrow({ where: { id: handoff.handoffId } })
    expect(persisted.codeHash).not.toContain(handoff.code)
    expect(persisted.codeHash).toBe(createHash('sha256').update(handoff.code).digest('hex'))

    const redeemed = await redeemMobileUploadHandoff(db, handoff.code)
    await expect(redeemMobileUploadHandoff(db, handoff.code)).rejects.toBeInstanceOf(InstallationMediaAccessError)
    const mobileFile = await uploadMobileHandoffFile(db, redeemed.cookieValue, {
      filename: 'aparat.png', contentType: 'image/png', bytes: imageBytes,
    }, media)
    expect(mobileFile.questionKey).toBe('zdjecie-sciany')
    await revokeMobileUploadHandoff(db, handoff.handoffId, token)
    await expect(uploadMobileHandoffFile(db, redeemed.cookieValue, {
      filename: 'po-revoke.png', contentType: 'image/png', bytes: imageBytes,
    }, media)).rejects.toBeInstanceOf(InstallationMediaAccessError)
  })

  it('rejects a handoff code which is not bound to the active client link', async () => {
    const randomCode = randomBytes(32).toString('base64url')
    await expect(redeemMobileUploadHandoff(db, randomCode)).rejects.toBeInstanceOf(InstallationMediaAccessError)
  })

  it('releases a QR upload slot after a media failure so the same mobile session can retry safely', async () => {
    const handoff = await createMobileUploadHandoff(db, token, { questionKey: 'zdjecie-sciany', maxFiles: 1 })
    const redeemed = await redeemMobileUploadHandoff(db, handoff.code)
    const failingMedia: InstallationMediaAdapter = { ...media, upload: async () => { throw new Error('media temporarily unavailable') } }

    await expect(uploadMobileHandoffFile(db, redeemed.cookieValue, {
      filename: 'pierwsza-proba.png', contentType: 'image/png', bytes: imageBytes,
    }, failingMedia)).rejects.toThrow('media temporarily unavailable')
    await expect(db.mobileUploadHandoff.findUniqueOrThrow({ where: { id: handoff.handoffId } })).resolves.toMatchObject({ usedFiles: 0 })

    await expect(uploadMobileHandoffFile(db, redeemed.cookieValue, {
      filename: 'druga-proba.png', contentType: 'image/png', bytes: imageBytes,
    }, media)).resolves.toMatchObject({ status: 'READY', source: 'MOBILE_QR' })
    await expect(db.mobileUploadHandoff.findUniqueOrThrow({ where: { id: handoff.handoffId } })).resolves.toMatchObject({ usedFiles: 1 })
    await expect(db.mobileUploadHandoff.update({ where: { id: handoff.handoffId }, data: { usedFiles: 0 } })).rejects.toBeTruthy()
  })

  it('keeps maxFiles=1 correct under concurrent mobile upload attempts', async () => {
    const handoff = await createMobileUploadHandoff(db, token, { questionKey: 'zdjecie-sciany', maxFiles: 1 })
    const redeemed = await redeemMobileUploadHandoff(db, handoff.code)
    const attempts = await Promise.allSettled(['rownowaga-a.png', 'rownowaga-b.png'].map((filename) => uploadMobileHandoffFile(db, redeemed.cookieValue, {
      filename, contentType: 'image/png', bytes: imageBytes,
    }, media)))
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1)
    await expect(db.installationFile.count({ where: { mobileHandoffId: handoff.handoffId, status: 'READY' } })).resolves.toBe(1)
    await expect(db.mobileUploadHandoff.findUniqueOrThrow({ where: { id: handoff.handoffId } })).resolves.toMatchObject({ usedFiles: 1 })
  })

  it('soft-deletes a ready mismatch file when its final database attachment fails', async () => {
    const mismatch = await db.installationMismatch.create({ data: {
      orderId,
      description: 'Zmiana zlecenia dokładnie po przyjęciu prywatnego pliku.',
      reason: 'EXECUTION_RISK',
      evidenceReference: 'installation-report:race',
      reportedById: 'owner',
    } })
    let beginUpload!: () => void
    const uploadBegan = new Promise<void>((resolve) => { beginUpload = resolve })
    let releaseUpload!: () => void
    const uploadRelease = new Promise<void>((resolve) => { releaseUpload = resolve })
    let removedFileId: string | null = null
    const delayedMedia: InstallationMediaAdapter = {
      ...media,
      upload: async (input) => {
        beginUpload()
        await uploadRelease
        return media.upload(input)
      },
      remove: async (fileId) => { removedFileId = fileId },
    }

    const attachment = createMismatchEvidenceFile(db, orderId, mismatch.id, 'owner-user', {
      filename: 'dowod-race.png', contentType: 'image/png', bytes: imageBytes,
    }, delayedMedia)
    await uploadBegan
    const pending = await db.installationFile.findFirstOrThrow({ where: { orderId, purpose: 'MISMATCH_EVIDENCE', status: 'PENDING' } })
    await db.installationMismatch.update({ where: { id: mismatch.id }, data: { orderId: otherOrderId } })
    releaseUpload()

    await expect(attachment).rejects.toBeTruthy()
    await expect(db.installationFile.findUniqueOrThrow({ where: { id: pending.id } })).resolves.toMatchObject({ status: 'READY', softDeletedAt: expect.any(Date) })
    expect(removedFileId).toBe(pending.id)
  })
})
