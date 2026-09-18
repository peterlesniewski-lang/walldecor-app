// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { claimAiJob, finishAiJob } from '@/lib/ai/queue'
import {
  archiveDraft,
  createBatch,
  editDraft,
  getDraft,
  listDrafts,
  registerReadyDraft,
  requestExtraction,
  restoreDraft,
  skipDraft,
} from '@/lib/invoice-import/draft-service'
import { INVOICE_ATTACHMENT_MAX_BYTES } from '@/lib/invoice-import/contracts'

const conversion = { mode: 'NBP' as const, paymentDate: '2026-09-14', rate: '4.3228', rateDate: '2026-09-11', tableNumber: '177/A/NBP/2026' }
const nbpLookup = async () => ({ currency: 'EUR' as const, paymentDate: conversion.paymentDate, rate: conversion.rate, rateDate: conversion.rateDate, tableNumber: conversion.tableNumber })

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-invoice-drafts-'))
const databaseUrl = `file:${path.join(directory, 'drafts.db')}`
const client = () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
let db: PrismaClient
let other: PrismaClient

const result = (overrides: Record<string, unknown> = {}) => ({
  documentType: 'INVOICE',
  supplierName: 'Dostawca AI',
  taxId: 'PL1234567890',
  invoiceNumber: 'FV/AI/1',
  issueDate: '2026-09-10',
  dueDate: '2026-09-24',
  currency: 'PLN',
  gross: 123,
  net: 100,
  vat: 23,
  bankAccount: 'PL00112233445566778899001122',
  paymentStatus: 'UNPAID',
  warnings: ['Sprawdź numer rachunku'],
  ...overrides,
})

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    storageKey: `${randomUUID()}.bin`,
    sha256: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    originalName: 'faktura.pdf',
    mimeType: 'application/pdf',
    byteSize: 1024,
    pageCount: 1,
    ...overrides,
  }
}

async function seedUsers() {
  for (const [id, role] of [
    ['admin', 'ADMIN'],
    ['admin2', 'ADMIN'],
    ['manager', 'MANAGER'],
    ['employee', 'EMPLOYEE'],
  ]) {
    await db.user.create({ data: {
      id,
      role,
      name: id,
      email: `${id}@example.test`,
      passwordHash: 'test-only',
    } })
  }
}

async function resetDatabase() {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "InvoiceDraftAudit_delete_guard"')
  await db.invoiceDraftAudit.deleteMany()
  await db.$executeRawUnsafe(`
    CREATE TRIGGER "InvoiceDraftAudit_delete_guard"
    BEFORE DELETE ON "InvoiceDraftAudit"
    BEGIN
      SELECT RAISE(ABORT, 'InvoiceDraftAudit rows are immutable');
    END
  `)
  await db.invoiceImportDraft.deleteMany()
  await db.invoiceAttachment.deleteMany()
  await db.invoiceImportBatch.deleteMany()
  await db.aiJob.deleteMany()
  await db.aiQueueLease.deleteMany()
  await db.user.deleteMany()
  await seedUsers()
}

beforeAll(async () => {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' },
    encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(migrated.stderr || migrated.stdout)
  db = client()
  other = client()
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
})

beforeEach(resetDatabase)

afterAll(async () => {
  await db?.$disconnect()
  await other?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('invoice import draft service', () => {
  it('saves fractional source drafts but refuses confirmation before approval could change their nominal basis', async () => {
    const batch = await createBatch(db, 'admin')
    const { draft } = await registerReadyDraft(db, 'admin', batch.id, metadata())
    const data = { currency: 'EUR', gross: 10.005, conversion: { mode: 'MANUAL_RATE', rate: '4.25', rateDate: null, tableNumber: null, paymentDate: null }, reportingGross: 42.52 }
    await editDraft(db, 'admin', draft.id, 1, data)
    await expect(editDraft(db, 'admin', draft.id, 2, { conversionConfirmed: true })).rejects.toMatchObject({ code: 'EUR_AMOUNT_PRECISION', status: 422 })
    expect((await getDraft(db, 'admin', draft.id)).data).toMatchObject({ gross: 10.005, conversionConfirmed: false })
  })
  it('persists verified NBP provenance, rejects forgery, fences versions, and supports offline note edits', async () => {
    const batch = await createBatch(db, 'admin')
    const { draft } = await registerReadyDraft(db, 'admin', batch.id, metadata())
    const lookup = vi.fn(nbpLookup)
    const data = { currency: 'EUR', gross: 100, paidAt: '2026-09-14', conversion, reportingGross: 432.28, conversionConfirmed: true }
    await expect(editDraft(db, 'admin', draft.id, 1, { ...data, conversion: { ...conversion, rate: '4' }, reportingGross: 400 }, { nbpLookup: lookup })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(lookup).toHaveBeenCalledOnce()
    const saved = await editDraft(db, 'admin', draft.id, 1, data, { nbpLookup: lookup })
    expect(saved.data).toMatchObject(data)
    expect(saved.manualFields).toContain('conversion')
    expect(JSON.parse((await db.invoiceDraftAudit.findFirstOrThrow({ where: { draftId: draft.id, action: 'EDITED' } })).afterJson).data.conversion).toEqual(conversion)
    await db.$disconnect()
    db = client()
    expect((await getDraft(db, 'admin', draft.id)).data.conversion).toEqual(conversion)
    const offline = vi.fn(async () => { throw new Error('offline') })
    await expect(editDraft(db, 'admin', draft.id, 1, data, { nbpLookup: offline })).rejects.toMatchObject({ code: 'STALE_VERSION' })
    const note = await editDraft(db, 'admin', draft.id, 2, { notes: 'Sprawdzone', conversionConfirmed: true }, { nbpLookup: offline })
    expect(note.data.conversionConfirmed).toBe(true)
    expect(offline).not.toHaveBeenCalled()
  })

  it.each([{ paidAt: '2026-09-15' }, { reportingGross: 500 }, { conversion: { ...conversion, rate: '5' } }])('invalidates a changed EUR basis and rejects explicit invalid reconfirmation', async (patch) => {
    const batch = await createBatch(db, 'admin')
    const { draft } = await registerReadyDraft(db, 'admin', batch.id, metadata())
    await editDraft(db, 'admin', draft.id, 1, { currency: 'EUR', gross: 100, paidAt: '2026-09-14', conversion, reportingGross: 432.28, conversionConfirmed: true }, { nbpLookup })
    await expect(editDraft(db, 'admin', draft.id, 2, { ...patch, conversionConfirmed: true }, { nbpLookup })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const changed = await editDraft(db, 'admin', draft.id, 2, patch, { nbpLookup })
    expect(changed.data.conversionConfirmed).toBe(false)
  })

  it('rechecks version after lookup outside the transaction', async () => {
    const batch = await createBatch(db, 'admin')
    const { draft } = await registerReadyDraft(db, 'admin', batch.id, metadata())
    await expect(editDraft(db, 'admin', draft.id, 1, { currency: 'EUR', gross: 100, paidAt: '2026-09-14', conversion, reportingGross: 432.28, conversionConfirmed: true }, { nbpLookup: async () => {
      await editDraft(other, 'admin2', draft.id, 1, { notes: 'Concurrent edit' })
      return nbpLookup()
    } })).rejects.toMatchObject({ code: 'STALE_VERSION' })
    expect((await getDraft(db, 'admin', draft.id)).data).toEqual({ notes: 'Concurrent edit' })
  })

  it('authorizes every operation from current user state and keeps upload batches owner-bound', async () => {
    await expect(createBatch(db, 'manager')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    await expect(createBatch(db, 'missing')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    const batch = await createBatch(db, 'admin')
    await expect(registerReadyDraft(db, 'admin2', batch.id, metadata())).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    const registered = await registerReadyDraft(db, 'admin', batch.id, metadata())
    await expect(getDraft(db, 'employee', registered.draft.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(editDraft(db, 'manager', registered.draft.id, 1, { notes: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await db.user.update({ where: { id: 'admin2' }, data: { isActive: false } })
    await expect(listDrafts(db, 'admin2')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await db.user.update({ where: { id: 'admin2' }, data: { isActive: true, mustChangePassword: true } })
    await expect(skipDraft(db, 'admin2', registered.draft.id, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await db.user.update({ where: { id: 'admin2' }, data: { mustChangePassword: false } })
    await expect(editDraft(db, 'admin2', registered.draft.id, 1, { notes: 'Drugi administrator' }))
      .resolves.toMatchObject({ version: 2, data: { notes: 'Drugi administrator' } })
  })

  it('registers READY metadata, the draft, immutable audit and first extraction job atomically', async () => {
    const batch = await createBatch(db, 'admin')
    const ready = metadata({ sha256: 'a'.repeat(64), originalName: 'FV 1.pdf' })
    const registered = await registerReadyDraft(db, 'admin', batch.id, ready)

    expect(registered).toMatchObject({
      deduplicated: false,
      draft: {
        batchId: batch.id,
        version: 1,
        extractionRevision: 1,
        state: 'OPEN',
        data: {},
        manualFields: [],
        attachment: {
          originalName: 'FV 1.pdf', mimeType: 'application/pdf', byteSize: 1024,
          pageCount: 1, sha256: 'a'.repeat(64), state: 'READY',
        },
        latestJob: { kind: 'INVOICE_EXTRACT', status: 'QUEUED', warnings: [] },
      },
    })
    expect(registered.draft.attachment).not.toHaveProperty('storageKey')
    expect(registered.draft.latestJob).not.toHaveProperty('payloadJson')
    expect(registered.draft.latestJob).not.toHaveProperty('leaseToken')
    expect(registered.draft.latestJob).not.toHaveProperty('workerId')

    const stored = await db.invoiceImportDraft.findUniqueOrThrow({
      where: { id: registered.draft.id }, include: { attachment: true, latestAiJob: true, audits: true },
    })
    expect(stored.attachment).toMatchObject({ ...ready, state: 'READY', createdById: 'admin' })
    expect(JSON.parse(stored.latestAiJob!.payloadJson)).toEqual({
      draftId: stored.id, attachmentId: stored.attachmentId, revision: 1,
    })
    expect(stored.latestAiJob).toMatchObject({ ownerUserId: 'admin', priority: 0, status: 'QUEUED' })
    expect(stored.audits).toHaveLength(1)
    expect(stored.audits[0]).toMatchObject({ action: 'CREATED', actorId: 'admin', aiJobId: stored.latestAiJobId })
    await expect(db.invoiceDraftAudit.update({ where: { id: stored.audits[0].id }, data: { action: 'TAMPERED' } }))
      .rejects.toThrow()
    expect(await db.ksefInvoice.count()).toBe(0)
    expect(await db.costEvent.count()).toBe(0)
    expect(await db.actualEntry.count()).toBe(0)
  })

  it('rolls back attachment, draft and queued job when the final registration audit fails', async () => {
    const batch = await createBatch(db, 'admin')
    await db.$executeRawUnsafe(`CREATE TRIGGER "test_registration_audit_failure"
      BEFORE INSERT ON "InvoiceDraftAudit" WHEN NEW.action = 'CREATED'
      BEGIN SELECT RAISE(ABORT, 'test registration audit failure'); END`)
    try {
      await expect(registerReadyDraft(db, 'admin', batch.id, metadata())).rejects.toThrow()
      expect(await db.invoiceAttachment.count()).toBe(0)
      expect(await db.invoiceImportDraft.count()).toBe(0)
      expect(await db.aiJob.count()).toBe(0)
      expect(await db.invoiceDraftAudit.count()).toBe(0)
      expect(await db.invoiceImportBatch.count()).toBe(1)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER "test_registration_audit_failure"')
    }
  })

  it.each([
    { storageKey: '../escape.bin' },
    { storageKey: '00000000-0000-1000-8000-000000000000.bin' },
    { sha256: 'A'.repeat(64) },
    { sha256: 'not-a-hash' },
    { originalName: '../invoice.pdf' },
    { originalName: 'folder/invoice.pdf' },
    { originalName: 'bad\u0000name.pdf' },
    { originalName: 'bad\u0085name.pdf' },
    { originalName: 'x'.repeat(256) },
    { mimeType: 'text/plain' },
    { byteSize: 0 },
    { byteSize: INVOICE_ATTACHMENT_MAX_BYTES + 1 },
    { mimeType: 'application/pdf', pageCount: null },
    { mimeType: 'application/pdf', pageCount: 11 },
    { mimeType: 'image/png', pageCount: 1 },
  ])('rejects malformed ready metadata without leaving any database row: %j', async (invalid) => {
    const batch = await createBatch(db, 'admin')
    await expect(registerReadyDraft(db, 'admin', batch.id, metadata(invalid)))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', status: 422 })
    expect(await db.invoiceAttachment.count()).toBe(0)
    expect(await db.invoiceImportDraft.count()).toBe(0)
    expect(await db.aiJob.count()).toBe(0)
    expect(await db.invoiceDraftAudit.count()).toBe(0)
  })

  it('deduplicates a global SHA to its original draft and rejects unavailable stored duplicates', async () => {
    const firstBatch = await createBatch(db, 'admin')
    const secondBatch = await createBatch(db, 'admin2')
    const sharedSha = 'b'.repeat(64)
    const first = await registerReadyDraft(db, 'admin', firstBatch.id, metadata({ sha256: sharedSha }))
    const duplicate = await registerReadyDraft(db, 'admin2', secondBatch.id, metadata({ sha256: sharedSha }))

    expect(duplicate.deduplicated).toBe(true)
    expect(duplicate.draft.id).toBe(first.draft.id)
    expect(duplicate.draft.batchId).toBe(firstBatch.id)
    expect(await db.invoiceAttachment.count()).toBe(1)
    expect(await db.invoiceImportDraft.count()).toBe(1)
    expect(await db.aiJob.count()).toBe(1)
    expect(await db.invoiceDraftAudit.count()).toBe(1)

    await db.invoiceAttachment.create({ data: {
      storageKey: `${randomUUID()}.bin`, sha256: 'c'.repeat(64), originalName: 'orphan.pdf',
      mimeType: 'application/pdf', byteSize: 1, pageCount: 1, state: 'STORAGE_ERROR', createdById: 'admin',
    } })
    await expect(registerReadyDraft(db, 'admin', firstBatch.id, metadata({ sha256: 'c'.repeat(64) })))
      .rejects.toMatchObject({ code: 'DUPLICATE_UNAVAILABLE', status: 409 })
    expect(await db.invoiceAttachment.count()).toBe(2)
    expect(await db.aiJob.count()).toBe(1)
  })

  it('enforces at most 20 actual drafts in one owner batch without counting deduplicated uploads', async () => {
    const batch = await createBatch(db, 'admin')
    let first!: Awaited<ReturnType<typeof registerReadyDraft>>
    for (let index = 0; index < 20; index += 1) {
      const added = await registerReadyDraft(db, 'admin', batch.id, metadata({
        sha256: index.toString(16).padStart(64, '0'),
        originalName: `invoice-${index}.png`,
        mimeType: 'image/png',
        pageCount: null,
      }))
      if (index === 0) first = added
    }
    await expect(registerReadyDraft(db, 'admin', batch.id, metadata({ sha256: 'f'.repeat(64) })))
      .rejects.toMatchObject({ code: 'BATCH_LIMIT', status: 409 })
    const duplicate = await registerReadyDraft(db, 'admin', batch.id, metadata({ sha256: '0'.repeat(64) }))
    expect(duplicate).toMatchObject({ deduplicated: true, draft: { id: first.draft.id } })
    expect(await db.invoiceImportDraft.count({ where: { batchId: batch.id } })).toBe(20)
  })

  it('returns bounded filtered snapshots with public metadata and sanitized latest-job diagnostics', async () => {
    const firstBatch = await createBatch(db, 'admin')
    const secondBatch = await createBatch(db, 'admin2')
    const first = await registerReadyDraft(db, 'admin', firstBatch.id, metadata({ sha256: 'd'.repeat(64) }))
    const second = await registerReadyDraft(db, 'admin2', secondBatch.id, metadata({ sha256: 'e'.repeat(64) }))
    await skipDraft(db, 'admin', first.draft.id, 1)
    await editDraft(db, 'admin2', second.draft.id, 1, {
      supplierName: 'Dostawca z listy', invoiceNumber: 'FV/LISTA', gross: 88, currency: 'EUR',
    })
    await archiveDraft(db, 'admin2', second.draft.id, 2)

    await expect(listDrafts(db, 'admin', { limit: 101 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const open = await listDrafts(db, 'admin', { batchId: firstBatch.id, state: 'OPEN', limit: 100 })
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({
      id: first.draft.id,
      skippedAt: expect.any(Date),
      display: { fileName: 'faktura.pdf', supplierName: null, invoiceNumber: null, gross: null, currency: null },
    })
    expect(open[0]).not.toHaveProperty('data')
    expect(open[0]).not.toHaveProperty('attachment')
    expect(await listDrafts(db, 'admin', { state: 'ARCHIVED' })).toEqual([
      expect.objectContaining({
        id: second.draft.id,
        latestJob: null,
        display: {
          fileName: 'faktura.pdf', supplierName: 'Dostawca z listy', invoiceNumber: 'FV/LISTA', gross: 88, currency: 'EUR',
        },
      }),
    ])

    const detail = await getDraft(db, 'admin2', first.draft.id)
    expect(detail).toMatchObject({ data: {}, manualFields: [], attachment: { sha256: 'd'.repeat(64) } })
    expect(JSON.stringify(detail)).not.toContain(first.draft.attachment.id === detail.attachment.id ? 'payloadJson' : 'never')
    expect(detail.attachment).not.toHaveProperty('storageKey')
  })

  it('serializes stale writes, merges strict partial edits and protects every explicit field including null', async () => {
    const batch = await createBatch(db, 'admin')
    const registered = await registerReadyDraft(db, 'admin', batch.id, metadata())
    await expect(editDraft(db, 'admin', registered.draft.id, 1, { unknown: 'no' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const writes = await Promise.allSettled([
      editDraft(db, 'admin', registered.draft.id, 1, {
        supplierName: null,
        notes: 'Pierwsza karta',
        dueDate: undefined,
      }),
      editDraft(other, 'admin2', registered.draft.id, 1, { supplierName: 'Druga karta' }),
    ])
    expect(writes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = writes.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'STALE_VERSION', status: 409 } })
    const stored = await getDraft(db, 'admin', registered.draft.id)
    expect(stored.version).toBe(2)
    if (stored.data.notes === 'Pierwsza karta') {
      expect(stored.data).toEqual({ supplierName: null, notes: 'Pierwsza karta' })
      expect(stored.manualFields).toEqual(expect.arrayContaining(['supplierName', 'notes']))
      expect(stored.manualFields).not.toContain('dueDate')
    } else {
      expect(stored.data).toEqual({ supplierName: 'Druga karta' })
      expect(stored.manualFields).toEqual(['supplierName'])
    }
    expect(await db.invoiceDraftAudit.count({ where: { draftId: stored.id, action: 'EDITED' } })).toBe(1)
  })

  it('merges a successful running AI result into current data without overwriting a concurrent manual edit', async () => {
    const batch = await createBatch(db, 'admin')
    const registered = await registerReadyDraft(db, 'admin', batch.id, metadata())
    const claim = (await claimAiJob(db, 'worker'))!
    expect(claim.id).toBe(registered.draft.latestJob!.id)
    await editDraft(other, 'admin2', registered.draft.id, 1, {
      supplierName: null,
      costCenterId: 'JAG',
      notes: 'Ręcznie sprawdzone',
    })

    await finishAiJob(db, 'worker', claim.id, claim.leaseToken, { status: 'SUCCEEDED', result: result() })
    const detail = await getDraft(db, 'admin', registered.draft.id)
    expect(detail).toMatchObject({
      version: 3,
      extractionRevision: 1,
      data: {
        supplierName: null,
        invoiceNumber: 'FV/AI/1',
        gross: 123,
        costCenterId: 'JAG',
        notes: 'Ręcznie sprawdzone',
      },
      latestJob: { status: 'SUCCEEDED', warnings: ['Sprawdź numer rachunku'] },
    })
    expect(detail.manualFields).toEqual(expect.arrayContaining(['supplierName', 'costCenterId', 'notes']))
    expect(await db.invoiceDraftAudit.findFirst({ where: { draftId: detail.id, action: 'AI_RESULT_APPLIED' } }))
      .toMatchObject({ aiJobId: claim.id })
    expect(await db.ksefInvoice.count()).toBe(0)
    expect(await db.costEvent.count()).toBe(0)
  })

  it('does not apply a running invoice result after its job owner loses the admin role', async () => {
    const batch = await createBatch(db, 'admin')
    const registered = await registerReadyDraft(db, 'admin', batch.id, metadata())
    const claim = (await claimAiJob(db, 'worker'))!
    await db.user.update({ where: { id: 'admin' }, data: { role: 'MANAGER' } })

    await finishAiJob(db, 'worker', claim.id, claim.leaseToken, { status: 'SUCCEEDED', result: result() })
    const stored = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: registered.draft.id } })
    expect(stored).toMatchObject({ version: 1, dataJson: '{}' })
    expect(await db.invoiceDraftAudit.findFirst({
      where: { draftId: stored.id, action: 'AI_RESULT_STALE_SKIPPED', aiJobId: claim.id },
    })).toMatchObject({ resultJson: '{"reason":"ACCESS_REVOKED"}' })
  })

  it('freezes the entire visible foreign-currency basis on confirmation and invalidates it after a manual basis edit', async () => {
    const batch = await createBatch(db, 'admin')
    const registered = await registerReadyDraft(db, 'admin', batch.id, metadata())
    await expect(editDraft(db, 'admin', registered.draft.id, 1, {
      currency: 'PLN', gross: 100, conversionConfirmed: true,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(editDraft(db, 'admin', registered.draft.id, 1, {
      currency: 'EUR', gross: null, conversionConfirmed: true,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const confirmed = await editDraft(db, 'admin', registered.draft.id, 1, {
      currency: 'EUR', gross: 100, conversionConfirmed: true,
    })
    expect(confirmed.data).toEqual({ currency: 'EUR', gross: 100, conversionConfirmed: true })
    expect(confirmed.manualFields).toEqual(expect.arrayContaining([
      'currency', 'gross', 'net', 'vat', 'conversionConfirmed',
    ]))

    const claim = (await claimAiJob(db, 'worker'))!
    await finishAiJob(db, 'worker', claim.id, claim.leaseToken, {
      status: 'SUCCEEDED',
      result: result({ currency: 'USD', gross: 999, net: 800, vat: 199 }),
    })
    const merged = await getDraft(db, 'admin', registered.draft.id)
    expect(merged.data).toMatchObject({ currency: 'EUR', gross: 100, conversionConfirmed: true })
    expect(merged.data).not.toHaveProperty('net')
    expect(merged.data).not.toHaveProperty('vat')

    const invalidated = await editDraft(db, 'admin', registered.draft.id, 3, { gross: 110 })
    expect(invalidated.data).toMatchObject({ currency: 'EUR', gross: 110, conversionConfirmed: false })
    const reconfirmed = await editDraft(db, 'admin', registered.draft.id, 4, { gross: 120, conversionConfirmed: true })
    expect(reconfirmed.data).toMatchObject({ currency: 'EUR', gross: 120, conversionConfirmed: true })
  })

  it('keeps failure outcomes draft-neutral and ignores successful results detached by archive/restore', async () => {
    const batch = await createBatch(db, 'admin')
    const failed = await registerReadyDraft(db, 'admin', batch.id, metadata({ sha256: '1'.repeat(64) }))
    const failedClaim = (await claimAiJob(db, 'worker-failed'))!
    await finishAiJob(db, 'worker-failed', failedClaim.id, failedClaim.leaseToken, { status: 'FAILED', errorCode: 'RUNNER_ERROR' })
    expect(await getDraft(db, 'admin', failed.draft.id)).toMatchObject({ version: 1, data: {}, latestJob: { status: 'FAILED' } })

    const detached = await registerReadyDraft(db, 'admin', batch.id, metadata({ sha256: '2'.repeat(64) }))
    const oldClaim = (await claimAiJob(db, 'worker-old'))!
    const archived = await archiveDraft(other, 'admin2', detached.draft.id, 1)
    expect(archived).toMatchObject({ version: 2, state: 'ARCHIVED', latestJob: null })
    const reopened = await restoreDraft(db, 'admin', detached.draft.id, 2)
    expect(reopened).toMatchObject({ version: 3, state: 'OPEN', latestJob: null })
    await finishAiJob(db, 'worker-old', oldClaim.id, oldClaim.leaseToken, { status: 'SUCCEEDED', result: result() })
    expect(await getDraft(db, 'admin', detached.draft.id)).toMatchObject({ version: 3, state: 'OPEN', data: {}, latestJob: null })
    expect(await db.invoiceDraftAudit.findFirst({ where: { draftId: detached.draft.id, action: 'AI_RESULT_STALE_SKIPPED' } }))
      .toMatchObject({ aiJobId: oldClaim.id })
  })

  it('cancels a queued extraction when archiving so no worker can claim it later', async () => {
    const batch = await createBatch(db, 'admin')
    const registered = await registerReadyDraft(db, 'admin', batch.id, metadata())
    const queuedJobId = registered.draft.latestJob!.id

    const archived = await archiveDraft(db, 'admin2', registered.draft.id, 1)
    expect(archived).toMatchObject({ version: 2, state: 'ARCHIVED', latestJob: null })
    expect(await db.aiJob.findUniqueOrThrow({ where: { id: queuedJobId } })).toMatchObject({
      status: 'CANCELLED', resultJson: null, errorCode: null,
    })
    expect(await claimAiJob(db, 'worker-after-archive')).toBeNull()
  })

  it('fences an older running extraction when a newer revision is requested', async () => {
    const batch = await createBatch(db, 'admin')
    const registered = await registerReadyDraft(db, 'admin', batch.id, metadata())
    const oldClaim = (await claimAiJob(db, 'worker-old'))!
    const revised = await requestExtraction(other, 'admin2', registered.draft.id, 1)
    expect(revised).toMatchObject({ version: 2, extractionRevision: 2, latestJob: { status: 'QUEUED' } })
    expect(revised.latestJob!.id).not.toBe(oldClaim.id)

    await finishAiJob(db, 'worker-old', oldClaim.id, oldClaim.leaseToken, { status: 'SUCCEEDED', result: result() })
    expect(await getDraft(db, 'admin', registered.draft.id)).toMatchObject({
      version: 2, extractionRevision: 2, data: {}, latestJob: { id: revised.latestJob!.id, status: 'QUEUED' },
    })
  })

  it('uses an explicit new extraction to resume a paused queue while retaining the old blocked job', async () => {
    const batch = await createBatch(db, 'admin')
    const registered = await registerReadyDraft(db, 'admin', batch.id, metadata())
    const blockedClaim = (await claimAiJob(db, 'worker-blocked'))!
    await finishAiJob(db, 'worker-blocked', blockedClaim.id, blockedClaim.leaseToken, {
      status: 'BLOCKED', errorCode: 'AUTH',
    })
    expect((await db.aiQueueLease.findUniqueOrThrow({ where: { id: 'shared-ai' } })).pauseReason).toBe('AUTH')

    const retried = await requestExtraction(other, 'admin2', registered.draft.id, 1)
    expect(retried).toMatchObject({
      version: 2,
      extractionRevision: 2,
      latestJob: { status: 'QUEUED', blockedReason: null },
    })
    expect(retried.latestJob!.id).not.toBe(blockedClaim.id)
    expect(await db.aiJob.findUniqueOrThrow({ where: { id: blockedClaim.id } })).toMatchObject({
      status: 'BLOCKED', errorCode: 'AUTH',
    })
    expect((await db.aiQueueLease.findUniqueOrThrow({ where: { id: 'shared-ai' } })).pauseReason).toBeNull()
    expect((await claimAiJob(db, 'worker-resumed'))?.id).toBe(retried.latestJob!.id)
  })

  it('rolls back both job completion and draft merge when the draft write fails', async () => {
    const batch = await createBatch(db, 'admin')
    const registered = await registerReadyDraft(db, 'admin', batch.id, metadata())
    const claim = (await claimAiJob(db, 'worker'))!
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "invoice_draft_test_ai_failure"
      BEFORE UPDATE ON "InvoiceImportDraft"
      WHEN NEW."version" > OLD."version"
      BEGIN
        SELECT RAISE(ABORT, 'synthetic draft merge failure');
      END
    `)
    try {
      await expect(finishAiJob(db, 'worker', claim.id, claim.leaseToken, { status: 'SUCCEEDED', result: result() }))
        .rejects.toThrow()
      expect(await db.aiJob.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({
        status: 'RUNNING', resultJson: null, leaseToken: claim.leaseToken,
      })
      expect(await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: registered.draft.id } }))
        .toMatchObject({ version: 1, dataJson: '{}' })
      expect(await db.invoiceDraftAudit.count({ where: { draftId: registered.draft.id, action: 'AI_RESULT_APPLIED' } })).toBe(0)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "invoice_draft_test_ai_failure"')
    }
  })

  it('persists skip/archive/restore state and sanitized detail across a Prisma reconnect', async () => {
    const batch = await createBatch(db, 'admin')
    const registered = await registerReadyDraft(db, 'admin', batch.id, metadata())
    const skipped = await skipDraft(db, 'admin', registered.draft.id, 1)
    expect(skipped).toMatchObject({ version: 2, state: 'OPEN', skippedAt: expect.any(Date) })
    const archived = await archiveDraft(db, 'admin', skipped.id, 2)
    expect(archived).toMatchObject({ version: 3, state: 'ARCHIVED', latestJob: null })
    await db.$disconnect()
    db = client()
    const persisted = await getDraft(db, 'admin2', archived.id)
    expect(persisted).toMatchObject({ version: 3, state: 'ARCHIVED', skippedAt: expect.any(Date), latestJob: null })
    expect(await db.ksefInvoice.count()).toBe(0)
    expect(await db.costEvent.count()).toBe(0)
    expect(await db.actualEntry.count()).toBe(0)
  })
})
