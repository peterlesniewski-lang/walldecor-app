// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { createBatch, registerReadyDraft } from '@/lib/invoice-import/draft-service'
import { PrivateInvoiceAttachmentStore } from '@/lib/invoice-import/private-store'
import { getInvoiceOriginal, uploadInvoiceDocument } from '@/lib/invoice-import/file-service'

vi.mock('@/lib/invoice-import/draft-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/invoice-import/draft-service')>()
  return { ...original, registerReadyDraft: vi.fn(original.registerReadyDraft) }
})
const originalDraftService = await vi.importActual<typeof import('@/lib/invoice-import/draft-service')>('@/lib/invoice-import/draft-service')
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-invoice-files-'))
const databaseUrl = `file:${path.join(directory, 'files.db')}`
let db: PrismaClient
let store: PrivateInvoiceAttachmentStore
let storageRoot: string
let bytes: Buffer
const processor = {
  pdfInfoBinary: '/unused-for-image/pdfinfo', pdfToPpmBinary: '/unused-for-image/pdftoppm', workRoot: directory,
}
const environment = () => ({ store, processor })

beforeAll(async () => {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' }, encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(migrated.stderr || migrated.stdout)
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#efe7d5' } }).png().toBuffer()
})

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(registerReadyDraft).mockImplementation(originalDraftService.registerReadyDraft)
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_file_audit_failure"')
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "InvoiceDraftAudit_delete_guard"')
  await db.invoiceDraftAudit.deleteMany()
  await db.$executeRawUnsafe(`CREATE TRIGGER "InvoiceDraftAudit_delete_guard"
    BEFORE DELETE ON "InvoiceDraftAudit" BEGIN SELECT RAISE(ABORT, 'immutable audit'); END`)
  await db.invoiceImportDraft.deleteMany()
  await db.invoiceAttachment.deleteMany()
  await db.invoiceImportBatch.deleteMany()
  await db.aiJob.deleteMany()
  await db.aiQueueLease.deleteMany()
  await db.user.deleteMany()
  for (const [id, role] of [['admin', 'ADMIN'], ['other-admin', 'ADMIN'], ['manager', 'MANAGER']]) {
    await db.user.create({ data: { id, role, name: id, email: `${id}@example.test`, passwordHash: 'test-only' } })
  }
  storageRoot = path.join(directory, randomUUID())
  store = new PrivateInvoiceAttachmentStore(storageRoot)
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

async function upload(client = db) {
  const batch = await createBatch(client, 'admin')
  return uploadInvoiceDocument(client, 'admin', { batchId: batch.id, originalName: 'Faktura ą.png', bytes }, environment())
}

describe('invoice original file orchestration', () => {
  it('persists actual original bytes before creating a READY draft, without a financial row', async () => {
    const uploaded = await upload()
    expect(uploaded).toMatchObject({ deduplicated: false, draft: { state: 'OPEN', attachment: {
      originalName: 'Faktura ą.png', mimeType: 'image/png', pageCount: null, byteSize: bytes.length,
    } } })
    const original = await getInvoiceOriginal(db, 'admin', uploaded.draft.id, environment())
    expect(original.bytes.equals(bytes)).toBe(true)
    expect(original.mimeType).toBe('image/png')
    expect(original.originalName).toBe('Faktura ą.png')
    expect(original).not.toHaveProperty('storageKey')
    expect(await db.ksefInvoice.count()).toBe(0)
    expect(await db.costEvent.count()).toBe(0)
    expect(await db.aiJob.count()).toBe(1)
  })

  it('checks current role and batch ownership before inspecting or writing a file', async () => {
    const batch = await createBatch(db, 'admin')
    const persist = vi.spyOn(store, 'persist')
    const invalidProcessingEnvironment = { store, processor: { ...processor, workRoot: '/missing-invoice-test-root' } }
    for (const actor of ['manager', 'missing']) {
      await expect(uploadInvoiceDocument(db, actor, { batchId: batch.id, originalName: 'x.png', bytes }, invalidProcessingEnvironment))
        .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    }
    await expect(uploadInvoiceDocument(db, 'other-admin', { batchId: batch.id, originalName: 'x.png', bytes }, invalidProcessingEnvironment))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await db.user.update({ where: { id: 'admin' }, data: { isActive: false } })
    await expect(uploadInvoiceDocument(db, 'admin', { batchId: batch.id, originalName: 'x.png', bytes }, environment()))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(persist).not.toHaveBeenCalled()
  })

  it('snapshots the original before the caller can mutate bytes during authorization', async () => {
    const batch = await createBatch(db, 'admin')
    const input = { batchId: batch.id, originalName: 'original.png', bytes: Buffer.from(bytes) }
    const pending = uploadInvoiceDocument(db, 'admin', input, environment())
    input.bytes.fill(0)
    input.originalName = 'changed-after-call.png'
    const uploaded = await pending
    const original = await getInvoiceOriginal(db, 'admin', uploaded.draft.id, environment())
    expect(original.bytes.equals(bytes)).toBe(true)
    expect(original.originalName).toBe('original.png')
  })

  it('rejects unsupported bytes and path-like filenames without registering a draft', async () => {
    const batch = await createBatch(db, 'admin')
    await expect(uploadInvoiceDocument(db, 'admin', { batchId: batch.id, originalName: 'fake.png', bytes: Buffer.from('<svg/>') }, environment()))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' })
    await expect(uploadInvoiceDocument(db, 'admin', { batchId: batch.id, originalName: '../escape.png', bytes }, environment()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(await db.invoiceAttachment.count()).toBe(0)
    expect(await db.invoiceImportDraft.count()).toBe(0)
  })

  it('deduplicates a second upload and compensates only its newly written file', async () => {
    const first = await upload()
    const batch = await createBatch(db, 'other-admin')
    const second = await uploadInvoiceDocument(db, 'other-admin', { batchId: batch.id, originalName: 'copy.jpg', bytes }, environment())
    expect(second.deduplicated).toBe(true)
    expect(second.draft.id).toBe(first.draft.id)
    expect(await readdir(storageRoot)).toHaveLength(1)
    expect((await getInvoiceOriginal(db, 'other-admin', first.draft.id, environment())).bytes.equals(bytes)).toBe(true)
    expect(await db.aiJob.count()).toBe(1)
  })

  it('compensates a database rollback but preserves a neighboring file', async () => {
    await store.persist(Buffer.from('neighbor original'))
    const before = await readdir(storageRoot)
    await db.$executeRawUnsafe(`CREATE TRIGGER "test_file_audit_failure"
      BEFORE INSERT ON "InvoiceDraftAudit" BEGIN SELECT RAISE(ABORT, 'test final audit failure'); END`)
    await expect(upload()).rejects.toThrow()
    expect(await readdir(storageRoot)).toEqual(before)
    expect(await db.invoiceAttachment.count()).toBe(0)
    expect(await db.invoiceImportDraft.count()).toBe(0)
    expect(await db.aiJob.count()).toBe(0)
  })

  it('never compensates a committed attachment after an ambiguous registration response', async () => {
    vi.mocked(registerReadyDraft).mockImplementationOnce(async (...args) => {
      await originalDraftService.registerReadyDraft(...args)
      throw new Error('simulated lost response after committed transaction')
    })
    await expect(upload()).rejects.toThrow('simulated lost response')
    const stored = await db.invoiceImportDraft.findFirstOrThrow()
    expect(await readdir(storageRoot)).toHaveLength(1)
    expect((await getInvoiceOriginal(db, 'admin', stored.id, environment())).bytes.equals(bytes)).toBe(true)
  })

  it('retains the file if database readback cannot safely establish that compensation is unreferenced', async () => {
    const readback = vi.fn().mockRejectedValueOnce(new Error('readback unavailable'))
    const unavailableReadback = new Proxy(db, { get(target, property) {
      if (property === 'invoiceAttachment') return { findUnique: readback }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await db.$executeRawUnsafe(`CREATE TRIGGER "test_file_audit_failure"
      BEFORE INSERT ON "InvoiceDraftAudit" BEGIN SELECT RAISE(ABORT, 'test audit failure'); END`)
    await expect(upload(unavailableReadback)).rejects.toThrow()
    expect(readback).toHaveBeenCalled()
    expect(await readdir(storageRoot)).toHaveLength(1)
    expect(await db.invoiceAttachment.count()).toBe(0)
    expect(warning).toHaveBeenCalledWith('[invoice-import] Private-file cleanup deferred; storage reconciliation required.')
  })

  it('denies original downloads to other roles and checks revocation again after I/O', async () => {
    const uploaded = await upload()
    await expect(getInvoiceOriginal(db, 'manager', uploaded.draft.id, environment()))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    const actualRead = store.readVerified.bind(store)
    vi.spyOn(store, 'readVerified').mockImplementationOnce(async (...args) => {
      const original = await actualRead(...args)
      await db.user.update({ where: { id: 'admin' }, data: { role: 'MANAGER' } })
      return original
    })
    await expect(getInvoiceOriginal(db, 'admin', uploaded.draft.id, environment()))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('fails closed on tampered bytes, incorrect MIME metadata, and missing originals', async () => {
    const uploaded = await upload()
    const attachment = await db.invoiceAttachment.findFirstOrThrow()
    await db.invoiceAttachment.update({ where: { id: attachment.id }, data: { mimeType: 'image/jpeg' } })
    await expect(getInvoiceOriginal(db, 'admin', uploaded.draft.id, environment()))
      .rejects.toMatchObject({ code: 'FILE_UNAVAILABLE' })
    await db.invoiceAttachment.update({ where: { id: attachment.id }, data: { mimeType: 'image/png' } })
    await writeFile(path.join(storageRoot, attachment.storageKey), Buffer.alloc(bytes.length, 1))
    await expect(getInvoiceOriginal(db, 'admin', uploaded.draft.id, environment()))
      .rejects.toMatchObject({ code: 'FILE_UNAVAILABLE' })
    rmSync(path.join(storageRoot, attachment.storageKey))
    await expect(getInvoiceOriginal(db, 'admin', uploaded.draft.id, environment()))
      .rejects.toMatchObject({ code: 'FILE_UNAVAILABLE' })
  })

  it('rejects a READY binding that changes after the original bytes were read', async () => {
    const uploaded = await upload()
    const actualRead = store.readVerified.bind(store)
    vi.spyOn(store, 'readVerified').mockImplementationOnce(async (...args) => {
      const original = await actualRead(...args)
      await db.invoiceAttachment.update({
        where: { id: uploaded.draft.attachment.id }, data: { originalName: 'changed-during-download.png' },
      })
      return original
    })
    await expect(getInvoiceOriginal(db, 'admin', uploaded.draft.id, environment()))
      .rejects.toMatchObject({ code: 'FILE_UNAVAILABLE', status: 500 })
  })
})
