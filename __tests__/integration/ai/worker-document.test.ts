// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@/generated/prisma'
import { getInvoiceWorkerDocument } from '@/lib/ai/worker-document'
import { createAiWorkerHandler } from '@/lib/ai/worker-http'
import { PrivateInvoiceAttachmentStore } from '@/lib/invoice-import/private-store'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-worker-document-'))
const databaseUrl = `file:${path.join(directory, 'worker-document.db')}`
const storageRoot = path.join(directory, 'private-originals')
const workRoot = path.join(directory, 'processor-work')
const secret = 'test-worker-document-secret-12345678901234567890'
const workerId = 'invoice-worker'
const leaseToken = 'c80d6c22-af27-43a3-bef1-1fc0ed7fa7de'
const now = new Date()
const leaseUntil = new Date(now.getTime() + 10 * 60_000)
let db: PrismaClient
let competingDb: PrismaClient
let store: PrivateInvoiceAttachmentStore
let originalBytes: Buffer

const processor = {
  pdfInfoBinary: '/unused-for-image/pdfinfo',
  pdfToPpmBinary: '/unused-for-image/pdftoppm',
  workRoot,
}

beforeAll(async () => {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' }, encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(migrated.stderr || migrated.stdout)
  mkdirSync(workRoot, { recursive: true, mode: 0o700 })
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  competingDb = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  originalBytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#d4c4a8' } }).png().toBuffer()
})

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.invoiceDraftAudit.deleteMany()
  await db.invoiceImportDraft.deleteMany()
  await db.invoiceAttachment.deleteMany()
  await db.invoiceImportBatch.deleteMany()
  await db.aiJob.deleteMany()
  await db.aiQueueLease.deleteMany()
  await db.user.deleteMany()
  await db.user.create({ data: {
    id: 'admin', email: 'admin@example.test', name: 'Admin', role: 'ADMIN', passwordHash: 'test-only',
  } })
  store = new PrivateInvoiceAttachmentStore(storageRoot)
})

afterAll(async () => {
  await Promise.all([db?.$disconnect(), competingDb?.$disconnect()])
  rmSync(directory, { recursive: true, force: true })
})

async function fixture() {
  const stored = await store.persist(originalBytes)
  const ids = { batchId: randomUUID(), attachmentId: randomUUID(), draftId: randomUUID(), jobId: randomUUID() }
  await db.invoiceImportBatch.create({ data: { id: ids.batchId, ownerUserId: 'admin' } })
  await db.invoiceAttachment.create({ data: {
    id: ids.attachmentId, storageKey: stored.key, sha256: stored.sha256, byteSize: stored.byteSize,
    originalName: 'faktura.png', mimeType: 'image/png', pageCount: null, state: 'READY', createdById: 'admin',
  } })
  await db.invoiceImportDraft.create({ data: {
    id: ids.draftId, batchId: ids.batchId, attachmentId: ids.attachmentId,
    extractionRevision: 1, state: 'OPEN',
  } })
  await db.aiJob.create({ data: {
    id: ids.jobId, ownerUserId: 'admin', kind: 'INVOICE_EXTRACT', status: 'RUNNING', attempts: 1,
    workerId, leaseToken, leaseUntil,
    payloadJson: JSON.stringify({ draftId: ids.draftId, revision: 1, attachmentId: ids.attachmentId }),
  } })
  await db.invoiceImportDraft.update({ where: { id: ids.draftId }, data: { latestAiJobId: ids.jobId } })
  await db.aiQueueLease.create({ data: { id: 'shared-ai', workerId, leaseToken, leaseUntil } })
  return {
    ...ids,
    request: { workerId, jobId: ids.jobId, leaseToken, attachmentId: ids.attachmentId },
    environment: { store, processor },
  }
}

describe('fenced invoice original transport', () => {
  it('returns actual verified original bytes only for the current job and global lease', async () => {
    const ready = await fixture()
    const document = await getInvoiceWorkerDocument(db, ready.request, ready.environment, now)
    expect(document.bytes.equals(originalBytes)).toBe(true)
    expect(document).toMatchObject({ mimeType: 'image/png', byteSize: originalBytes.length })
    expect(document).not.toHaveProperty('storageKey')
    expect(document).not.toHaveProperty('originalName')
  })

  it('serves the original through the authenticated worker command with private exact headers', async () => {
    const ready = await fixture()
    const handler = createAiWorkerHandler({ db, secret: () => secret, files: async () => ready.environment })
    const response = await handler(new NextRequest('http://localhost/api/internal/ai-worker', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'document', ...ready.request }),
    }))
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer()).equals(originalBytes)).toBe(true)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe(String(originalBytes.length))
    expect(response.headers.get('x-content-sha256')).toMatch(/^[0-9a-f]{64}$/)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-encoding')).toBe('identity')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('denies stale archive, revision, latest-job, attachment, role and lease state before file I/O', async () => {
    const mutations: Array<(ready: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>> = [
      (ready) => db.invoiceImportDraft.update({ where: { id: ready.draftId }, data: { state: 'ARCHIVED' } }),
      (ready) => db.invoiceImportDraft.update({ where: { id: ready.draftId }, data: { extractionRevision: 2 } }),
      (ready) => db.invoiceImportDraft.update({ where: { id: ready.draftId }, data: { latestAiJobId: null } }),
      () => db.user.update({ where: { id: 'admin' }, data: { role: 'MANAGER' } }),
      () => db.aiQueueLease.update({ where: { id: 'shared-ai' }, data: { leaseUntil: now } }),
    ]
    for (const mutate of mutations) {
      await beforeEachFixtureReset()
      const ready = await fixture()
      const read = vi.spyOn(store, 'readVerified')
      await mutate(ready)
      await expect(getInvoiceWorkerDocument(db, ready.request, ready.environment, now))
        .rejects.toMatchObject({ code: 'LEASE_LOST', status: 409 })
      expect(read).not.toHaveBeenCalled()
      vi.restoreAllMocks()
    }

    await beforeEachFixtureReset()
    const ready = await fixture()
    const read = vi.spyOn(store, 'readVerified')
    await expect(getInvoiceWorkerDocument(db, { ...ready.request, attachmentId: randomUUID() }, ready.environment, now))
      .rejects.toMatchObject({ code: 'LEASE_LOST', status: 409 })
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    ['archive', async (ready: Awaited<ReturnType<typeof fixture>>) => {
      await competingDb.invoiceImportDraft.update({ where: { id: ready.draftId }, data: { state: 'ARCHIVED' } })
    }],
    ['re-extraction', async (ready: Awaited<ReturnType<typeof fixture>>) => {
      await competingDb.invoiceImportDraft.update({ where: { id: ready.draftId }, data: { extractionRevision: 2, latestAiJobId: null } })
    }],
    ['role revocation', async () => {
      await competingDb.user.update({ where: { id: 'admin' }, data: { mustChangePassword: true } })
    }],
    ['global lease replacement', async () => {
      await competingDb.aiQueueLease.update({ where: { id: 'shared-ai' }, data: { leaseToken: randomUUID() } })
    }],
  ] as const)('denies %s that happens during actual private-file I/O', async (_name, mutate) => {
    const ready = await fixture()
    const actualRead = store.readVerified.bind(store)
    vi.spyOn(store, 'readVerified').mockImplementationOnce(async (...args) => {
      const bytes = await actualRead(...args)
      await mutate(ready)
      return bytes
    })
    await expect(getInvoiceWorkerDocument(db, ready.request, ready.environment, now))
      .rejects.toMatchObject({ code: 'LEASE_LOST', status: 409 })
  })
})

async function beforeEachFixtureReset() {
  await db.invoiceImportDraft.updateMany({ data: { latestAiJobId: null } })
  await db.invoiceDraftAudit.deleteMany()
  await db.invoiceImportDraft.deleteMany()
  await db.invoiceAttachment.deleteMany()
  await db.invoiceImportBatch.deleteMany()
  await db.aiJob.deleteMany()
  await db.aiQueueLease.deleteMany()
  await db.user.deleteMany()
  await db.user.create({ data: {
    id: 'admin', email: 'admin@example.test', name: 'Admin', role: 'ADMIN', passwordHash: 'test-only',
  } })
  store = new PrivateInvoiceAttachmentStore(path.join(directory, randomUUID()))
}
