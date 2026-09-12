// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { withAiQueueMutation } from '@/lib/ai/queue'
import { createInvoiceImportHandlers } from '@/lib/invoice-import/http'
import { createInvoiceImportClient } from '@/lib/invoice-import/client'
import { reconcileImportedKsefInvoice } from '@/lib/invoice-import/ksef-reconciliation-service'

const directory = mkdtempSync(join(tmpdir(), 'invoice-ksef-http-'))
const template = join(directory, 'template.db')
let db: PrismaClient
let actorId: string | null
let draftId: string
let handlers: ReturnType<typeof createInvoiceImportHandlers>
const files = vi.fn(async () => { throw new Error('Files are not needed for reconciliation') })
const request = (body: unknown, method = 'POST') => new NextRequest('http://localhost/api/finance/invoice-import/drafts/example/ksef', {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

beforeAll(async () => {
  execFileSync('/usr/bin/sqlite3', [template, 'VACUUM;'])
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${template}`, RUST_LOG: 'debug' }, stdio: 'pipe', timeout: 60_000,
  })
})
beforeEach(async () => {
  await db?.$disconnect()
  const path = join(directory, `${randomUUID()}.db`)
  cpSync(template, path)
  db = new PrismaClient({ datasources: { db: { url: `file:${path}` } } })
  for (const [id, role] of [['admin', 'ADMIN'], ['manager', 'MANAGER'], ['employee', 'EMPLOYEE']]) {
    await db.user.create({ data: { id, role, name: id, email: `${id}@example.test`, passwordHash: 'test-only' } })
  }
  actorId = 'admin'
  const batch = await db.invoiceImportBatch.create({ data: { ownerUserId: 'admin' } })
  const attachment = await db.invoiceAttachment.create({ data: {
    storageKey: `${randomUUID()}.bin`, sha256: 'a'.repeat(64), originalName: 'Faktura.png', mimeType: 'image/png',
    byteSize: 10, state: 'READY', createdById: 'admin',
  } })
  const draft = await db.invoiceImportDraft.create({ data: {
    batchId: batch.id, attachmentId: attachment.id,
    dataJson: JSON.stringify({ documentType: 'INVOICE', supplierName: 'Dostawca', taxId: 'PL1234567890',
      invoiceNumber: 'TEST/1', issueDate: '2026-09-10', currency: 'PLN', gross: 123, paymentStatus: 'UNPAID', notes: 'Ręczna notatka' }),
  } })
  draftId = draft.id
  await withAiQueueMutation(db, () => new Date(), (tx, _lease, now) => reconcileImportedKsefInvoice(tx, 'admin', {
    ksefNumber: 'KSEF-HTTP', seller: { nip: 'PL1234567890', name: 'Dostawca' },
    invoiceNumber: 'TEST/1', issueDate: '2026-09-10', currency: 'PLN', grossAmount: 124, netAmount: 100, vatAmount: 24,
  }, '<Faktura><Fa/></Faktura>', now))
  files.mockClear()
  handlers = createInvoiceImportHandlers({ db, getSession: async () => actorId ? { user: { id: actorId } } : null, files })
})
afterAll(async () => {
  await db?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

async function resolutionInput() {
  const draft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draftId } })
  const link = await db.invoiceKsefReconciliation.findFirstOrThrow()
  return { reconciliationId: link.id, expectedDraftVersion: draft.version, expectedLinkVersion: link.version,
    action: 'KEEP_LOCAL' as const, idempotencyKey: randomUUID() }
}

describe('KSeF reconciliation HTTP and browser contract on migrated SQLite', () => {
  it('GET exposes current differences but no XML, storage location or internal hashes', async () => {
    const response = await handlers.ksefGET(draftId)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const body = await response.json()
    expect(body.reconciliation).toMatchObject({ draftId, draftVersion: 2, draftState: 'OPEN', links: [{
      externalId: 'KSEF-HTTP', status: 'CONFLICT', approvalBlocked: true,
      differences: expect.arrayContaining([{ field: 'gross', localValue: 123, ksefValue: 124 }]),
    }] })
    expect(JSON.stringify(body)).not.toMatch(/xmlContent|snapshotHash|resolvedDataHash|storageKey|<Faktura/)
    expect((await handlers.ksefGET('missing')).status).toBe(404)
    expect(files).not.toHaveBeenCalled()
  })

  it('authorizes current session before reading malformed bodies or loading the document', async () => {
    for (const id of [null, 'manager', 'employee']) {
      actorId = id
      const status = id ? 403 : 401
      const malformed = new NextRequest('http://localhost/api/finance/invoice-import/drafts/missing/ksef', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken JSON',
      })
      for (const response of [await handlers.ksefGET('missing'), await handlers.ksefPOST(malformed, 'missing')]) {
        expect(response.status).toBe(status)
        expect(response.headers.get('cache-control')).toBe('private, no-store')
      }
      expect(malformed.bodyUsed).toBe(false)
    }
    actorId = 'admin'
    for (const update of [{ isActive: false }, { isActive: true, mustChangePassword: true }]) {
      await db.user.update({ where: { id: 'admin' }, data: update })
      expect((await handlers.ksefPOST(request(await resolutionInput()), draftId)).status).toBe(403)
    }
    expect(await db.invoiceDraftAudit.count({ where: { action: 'KSEF_KEPT_LOCAL' } })).toBe(0)
  })

  it('bounds input, rejects stale versions and unknown fields without writes, and returns controlled errors', async () => {
    const input = await resolutionInput()
    expect((await handlers.ksefPOST(request({ ...input, extra: true }), draftId)).status).toBe(422)
    expect((await handlers.ksefPOST(request({ ...input, expectedDraftVersion: 1 }), draftId)).status).toBe(409)
    expect((await handlers.ksefPOST(request({ ...input, idempotencyKey: 'x'.repeat(9_000) }), draftId)).status).toBe(413)
    const unknown = await handlers.ksefPOST(request({ ...input, reconciliationId: 'missing' }), draftId)
    expect(unknown.status).toBe(404)
    expect(await db.invoiceDraftAudit.count({ where: { action: 'KSEF_KEPT_LOCAL' } })).toBe(0)
    await db.$executeRawUnsafe(`UPDATE "InvoiceKsefReconciliation" SET "snapshotHash" = ?`, 'b'.repeat(64))
    const corrupt = await handlers.ksefGET(draftId)
    expect(corrupt.status).toBe(500)
    expect(await corrupt.json()).toEqual({ error: 'Nie udało się obsłużyć dokumentu.', code: 'CORRUPT_DATA' })
  })

  it('round trips the browser client through real HTTP, retains retry identity and never creates money', async () => {
    let loseResponse = true
    const requests: unknown[] = []
    const client = createInvoiceImportClient(async (url, init) => {
      const incoming = new NextRequest(`http://localhost${String(url)}`, init)
      expect(incoming.nextUrl.pathname).toBe(`/api/finance/invoice-import/drafts/${draftId}/ksef`)
      expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' })
      if (init?.method !== 'POST') return handlers.ksefGET(draftId)
      requests.push(JSON.parse(String(init.body)))
      const response = await handlers.ksefPOST(incoming, draftId)
      if (loseResponse) { loseResponse = false; throw new TypeError('Connection lost after commit') }
      return response
    })
    const detail = await client.ksef(draftId)
    expect(detail.links[0].status).toBe('CONFLICT')
    const input = await resolutionInput()
    await expect(client.resolveKsef(draftId, input)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    const result = await client.resolveKsef(draftId, input)
    expect(result).toMatchObject({ outcome: 'KEPT_LOCAL', draftId, version: 3, reconciliationVersion: 2 })
    expect(requests).toEqual([input, input])
    expect((await client.ksef(draftId)).links[0]).toMatchObject({ status: 'KEPT_LOCAL', approvalBlocked: false })
    expect(await db.invoiceDraftAudit.count({ where: { action: 'KSEF_KEPT_LOCAL' } })).toBe(1)
    expect(await db.ksefInvoice.count()).toBe(0)
    expect(await db.costEvent.count()).toBe(0)
    expect(JSON.parse((await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draftId } })).dataJson))
      .toMatchObject({ gross: 123, notes: 'Ręczna notatka' })
  })
})
