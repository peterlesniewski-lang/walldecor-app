import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { createInstallationFormTemplate, createInstallationOrderFormSnapshot, publishInstallationFormTemplate } from '@/lib/installations/catalog-service'
import { createClientLink } from '@/lib/installations/client-link'
import { submitClientForm, InstallationFormValidationError } from '@/lib/installations/form-service'
import { createInstallationOrder } from '@/lib/installations/order-service'
import {
  createClientQuestionFile,
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
    questions: [{ key: 'zdjecie-sciany', type: 'FILE', label: 'Dodaj zdjęcie ściany', required: true }],
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
  token = primary.token
  otherToken = other.token
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('private client files', () => {
  it('requires a real ready file for a required FILE question and immediately hides a soft-deleted file', async () => {
    await expect(submitClientForm(db, token, { revisionNumber: 1, draftVersion: 0, clientMutationId: 'media-required-file-before-upload' }))
      .rejects.toBeInstanceOf(InstallationFormValidationError)

    const created = await createClientQuestionFile(db, token, {
      questionKey: 'zdjecie-sciany', filename: 'sciana.png', contentType: 'image/png', bytes: imageBytes,
    }, media)
    expect(created.status).toBe('READY')
    expect(created.sha256).toBe(createHash('sha256').update(imageBytes).digest('hex'))
    expect(await listClientQuestionFiles(db, token, 'zdjecie-sciany')).toHaveLength(1)
    await expect(listClientQuestionFiles(db, otherToken, 'zdjecie-sciany')).resolves.toEqual([])

    await submitClientForm(db, token, { revisionNumber: 1, draftVersion: 0, clientMutationId: 'media-required-file-after-upload' })
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
})
