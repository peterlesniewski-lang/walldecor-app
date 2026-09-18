// @vitest-environment node
import { randomUUID, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { PrivateInvoiceAttachmentStore } from '@/lib/invoice-import/private-store'
import { createInvoiceImportHandlers } from '@/lib/invoice-import/http'
import { INVOICE_ATTACHMENT_MAX_BYTES } from '@/lib/invoice-import/contracts'
import { InvoiceFilesConfigurationError } from '@/lib/invoice-import/files-runtime'
import { createInvoiceImportClient } from '@/lib/invoice-import/client'
import { NbpRateError } from '@/lib/invoice-import/nbp-rate'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-invoice-http-'))
const databaseUrl = `file:${path.join(directory, 'http.db')}`
let db: PrismaClient
let bytes: Buffer
let actorId: string | null
let handlers: ReturnType<typeof createInvoiceImportHandlers>
let files: ReturnType<typeof vi.fn>
const json = (body: unknown, method = 'POST', url = 'http://localhost/api/finance/invoice-import/drafts') =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = (query = '') => new NextRequest(`http://localhost/api/finance/invoice-import/drafts${query}`)

beforeAll(async () => {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' }, encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(migrated.stderr || migrated.stdout)
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#e7ddc9' } }).png().toBuffer()
  await db.costCenter.create({ data: { id: 'JAG', name: 'Jagiellońska' } })
  await db.costTagGroup.create({ data: { id: 'behavior-group', name: 'Charakter kosztu', slug: 'behavior' } })
  await db.costTag.create({ data: { id: 'fixed', groupId: 'behavior-group', name: 'Stały', slug: 'fixed' } })
})

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "InvoiceDraftAudit_delete_guard"')
  await db.invoiceDraftAudit.deleteMany()
  await db.$executeRawUnsafe(`CREATE TRIGGER "InvoiceDraftAudit_delete_guard"
    BEFORE DELETE ON "InvoiceDraftAudit" BEGIN SELECT RAISE(ABORT, 'immutable audit'); END`)
  await db.costAuditLog.deleteMany()
  await db.costEventPartTag.deleteMany()
  await db.costEventPartAllocation.deleteMany()
  await db.costEventPart.deleteMany()
  await db.costEvent.deleteMany()
  await db.invoiceImportDraft.deleteMany()
  await db.ksefInvoicePartTag.deleteMany()
  await db.ksefInvoicePartAllocation.deleteMany()
  await db.ksefInvoicePart.deleteMany()
  await db.ksefInvoice.deleteMany()
  await db.invoiceAttachment.deleteMany()
  await db.invoiceImportBatch.deleteMany()
  await db.aiJob.deleteMany()
  await db.aiQueueLease.deleteMany()
  await db.financePeriodClose.deleteMany()
  await db.user.deleteMany()
  for (const [id, role] of [['admin', 'ADMIN'], ['manager', 'MANAGER'], ['employee', 'EMPLOYEE']]) {
    await db.user.create({ data: { id, role, name: id, email: `${id}@example.test`, passwordHash: 'test-only' } })
  }
  actorId = 'admin'
  const store = new PrivateInvoiceAttachmentStore(path.join(directory, randomUUID()))
  files = vi.fn(async () => ({ store, processor: {
    pdfInfoBinary: '/unused-for-image/pdfinfo', pdfToPpmBinary: '/unused-for-image/pdftoppm', workRoot: directory,
  } }))
  handlers = createInvoiceImportHandlers({ db, getSession: async () => actorId ? { user: { id: actorId } } : null, files })
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

async function upload() {
  const batchResponse = await handlers.batchesPOST()
  expect(batchResponse.status).toBe(201)
  const { batch } = await batchResponse.json()
  const form = new FormData()
  form.set('batchId', batch.id)
  form.set('file', new Blob([Uint8Array.from(bytes)], { type: 'image/png' }), 'Faktura ąż.png')
  const response = await handlers.draftsPOST(new NextRequest('http://localhost/api/finance/invoice-import/drafts', { method: 'POST', body: form }))
  expect(response.status).toBe(201)
  return (await response.json()).draft
}

describe('invoice import HTTP boundary', () => {
  it('protects EUR lookup with current user authorization and strict date query', async () => {
    const quote = { currency: 'EUR' as const, paymentDate: '2026-09-14', rate: '4.3228', rateDate: '2026-09-11', tableNumber: '177/A/NBP/2026' }
    const nbpLookup = vi.fn(async () => quote)
    const handler = createInvoiceImportHandlers({ db, files, getSession: async () => actorId ? { user: { id: actorId } } : null, nbpLookup })
    for (const user of [null, 'manager', 'employee']) {
      actorId = user
      expect((await handler.exchangeRateGET(get('?paymentDate=2026-09-14'))).status).toBe(user ? 403 : 401)
    }
    actorId = 'admin'
    for (const flags of [{ isActive: false }, { isActive: true, mustChangePassword: true }]) {
      await db.user.update({ where: { id: actorId }, data: flags })
      expect((await handler.exchangeRateGET(get('?paymentDate=2026-09-14'))).status).toBe(403)
    }
    await db.user.update({ where: { id: actorId }, data: { mustChangePassword: false } })
    for (const query of ['', '?paymentDate=2026-02-30', '?paymentDate=2026-09-14&url=https://evil.test', '?paymentDate=2026-09-14&paymentDate=2026-09-14']) {
      expect((await handler.exchangeRateGET(get(query))).status).toBe(422)
    }
    expect(nbpLookup).not.toHaveBeenCalled()
    const response = await handler.exchangeRateGET(get('?paymentDate=2026-09-14'))
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ quote })
    for (const [code, status] of [['NBP_INVALID_DATE', 422], ['NBP_INVALID_RESPONSE', 502], ['NBP_UNAVAILABLE', 503]] as const) {
      nbpLookup.mockRejectedValueOnce(new NbpRateError(code, status))
      const failed = await handler.exchangeRateGET(get('?paymentDate=2026-09-14'))
      expect(failed.status).toBe(status)
      expect(await failed.json()).toMatchObject({ code, error: expect.stringContaining('ręczn') })
    }
  })
  it('authorizes session and current user state before body parsing or file configuration', async () => {
    for (const actor of [null, 'manager', 'employee']) {
      actorId = actor
      const expected = actor ? 403 : 401
      expect((await handlers.batchesPOST()).status).toBe(expected)
      expect((await handlers.draftsGET(get())).status).toBe(expected)
      expect((await handlers.draftsPOST(json({ invalid: true }))).status).toBe(expected)
      expect((await handlers.draftGET('missing')).status).toBe(expected)
      expect((await handlers.draftPATCH(json({ invalid: true }), 'missing')).status).toBe(expected)
      expect((await handlers.actionsPOST(json({ action: 'ARCHIVE' }), 'missing')).status).toBe(expected)
      expect((await handlers.fileGET(get(), 'missing')).status).toBe(expected)
      expect((await handlers.approvePOST(json({}), 'missing')).status).toBe(expected)
      expect((await handlers.approveDELETE(json({}), 'missing')).status).toBe(expected)
      expect((await handlers.historyGET(get(), 'missing')).status).toBe(expected)
    }
    actorId = 'admin'
    await db.user.update({ where: { id: 'admin' }, data: { mustChangePassword: true } })
    expect((await handlers.batchesPOST()).status).toBe(403)
    expect(files).not.toHaveBeenCalled()
    expect(await db.invoiceImportBatch.count()).toBe(0)
  })

  it('round-trips an original and handles list, edit, skip, archive, restore and extraction with version checks', async () => {
    const draft = await upload()
    expect(draft.attachment.originalName).toBe('Faktura ąż.png')
    expect(draft.attachment).not.toHaveProperty('storageKey')
    expect((await (await handlers.draftsGET(get())).json()).drafts).toHaveLength(1)
    expect((await handlers.draftsGET(get('?unexpected=true'))).status).toBe(422)
    expect((await handlers.draftsGET(get('?__proto__=x&__proto__=y'))).status).toBe(422)
    expect((await handlers.draftsGET(get('?__proto__=x'))).status).toBe(422)
    expect((await handlers.draftGET('missing')).status).toBe(404)
    const editedResponse = await handlers.draftPATCH(json({ expectedVersion: draft.version, data: { supplierName: 'Ręcznie poprawiony' } }, 'PATCH'), draft.id)
    expect(editedResponse.status).toBe(200)
    let current = (await editedResponse.json()).draft
    expect((await handlers.draftPATCH(json({ expectedVersion: draft.version, data: { supplierName: 'Stara karta' } }, 'PATCH'), draft.id)).status).toBe(409)
    for (const action of ['SKIP', 'ARCHIVE', 'RESTORE', 'EXTRACT']) {
      const response = await handlers.actionsPOST(json({ action, expectedVersion: current.version }), draft.id)
      expect(response.status).toBe(200)
      current = (await response.json()).draft
    }
    expect(current.state).toBe('OPEN')
    expect(current.extractionRevision).toBe(2)
    const original = await handlers.fileGET(get('?download=1'), draft.id)
    expect(original.status).toBe(200)
    expect(original.headers.get('cache-control')).toBe('private, no-store')
    expect(original.headers.get('x-content-type-options')).toBe('nosniff')
    expect(original.headers.get('content-type')).toBe('image/png')
    expect(original.headers.get('content-disposition')).toContain("filename*=UTF-8''Faktura%20%C4%85%C5%BC.png")
    expect(Buffer.from(await original.arrayBuffer()).equals(bytes)).toBe(true)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(draft.attachment.sha256)
    const history = await (await handlers.historyGET(get(), draft.id)).json()
    expect(history.entries.map((entry: { action: string }) => entry.action)).toContain('EDITED')
    expect(JSON.stringify(history)).not.toMatch(/storageKey|leaseToken|idempotencyKey/)
    expect(await db.ksefInvoice.count()).toBe(0)
    expect(await db.costEvent.count()).toBe(0)
  })

  it('approves once, returns closed-period confirmation data, and revokes through the same HTTP resource', async () => {
    const draft = await upload()
    const edited = await handlers.draftPATCH(json({ expectedVersion: draft.version, data: {
      documentType: 'INVOICE', supplierName: 'Test HTTP', taxId: 'DEab123', invoiceNumber: 'HTTP/1',
      issueDate: '2026-09-10', currency: 'PLN', gross: 123, net: 100, vat: 23,
      paymentStatus: 'UNKNOWN', costCenterId: 'JAG', tagIds: ['fixed'],
    } }, 'PATCH'), draft.id)
    const current = (await edited.json()).draft
    const period = await db.financePeriodClose.create({ data: { year: 2026, month: 9 } })
    const request = { expectedVersion: current.version, idempotencyKey: randomUUID(), confirmedPeriodIds: [] as string[] }
    const blocked = await handlers.approvePOST(json(request), draft.id)
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toMatchObject({ code: 'CLOSED_PERIOD_CONFIRMATION_REQUIRED', periods: [{ id: period.id, year: 2026, month: 9 }] })
    request.confirmedPeriodIds = [period.id]
    const approved = await handlers.approvePOST(json(request), draft.id)
    expect(approved.status).toBe(200)
    const body = await approved.json()
    expect(body.result.outcome).toBe('APPROVED')
    expect(await (await handlers.approvePOST(json(request), draft.id)).json()).toEqual(body)
    expect(await db.ksefInvoice.count()).toBe(1)
    expect(await db.costEvent.count({ where: { status: 'APPROVED' } })).toBe(1)
    const revoked = await handlers.approveDELETE(json({ expectedVersion: body.result.version, idempotencyKey: randomUUID() }, 'DELETE'), draft.id)
    expect(revoked.status).toBe(200)
    expect((await revoked.json()).result).toMatchObject({ outcome: 'REVOKED', invoiceId: body.result.invoiceId })
    expect(await db.costEvent.count({ where: { status: 'APPROVED' } })).toBe(0)
    expect(await db.costEvent.count({ where: { status: 'VOID' } })).toBe(1)
  })

  it('bounds JSON and multipart bodies and leaves no draft after a truncated upload', async () => {
    const oversized = new NextRequest('http://localhost/api/finance/invoice-import/drafts', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notes: 'x'.repeat(70_000) }),
    })
    expect((await handlers.draftPATCH(oversized, 'missing')).status).toBe(413)
    const oversizedUpload = new NextRequest('http://localhost/api/finance/invoice-import/drafts', {
      method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(INVOICE_ATTACHMENT_MAX_BYTES + 100_000) }, body: 'x',
    })
    expect((await handlers.draftsPOST(oversizedUpload)).status).toBe(413)
    const interrupted = new NextRequest('http://localhost/api/finance/invoice-import/drafts', {
      method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body: '--x\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\npartial',
    })
    expect((await handlers.draftsPOST(interrupted)).status).toBe(400)
    expect(await db.invoiceAttachment.count()).toBe(0)
    expect(await db.invoiceImportDraft.count()).toBe(0)
    expect(await db.aiJob.count()).toBe(0)
  })

  it('never exposes unknown filesystem or database exception text in HTTP errors', async () => {
    const draft = await upload()
    files.mockRejectedValueOnce(new Error('SECRET /private/originals/database.db'))
    const response = await handlers.fileGET(get(), draft.id)
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('returns a controlled unavailable response when private storage is not configured', async () => {
    const draft = await upload()
    files.mockRejectedValueOnce(new InvoiceFilesConfigurationError())
    const response = await handlers.fileGET(get(), draft.id)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'UPLOAD_NOT_CONFIGURED', error: 'Prywatny magazyn dokumentów nie został skonfigurowany.' })
  })

  it('paginates immutable history without leaking receipts and rejects a cursor from another draft', async () => {
    const draft = await upload()
    let current = draft
    for (let index = 0; index < 52; index += 1) {
      const response = await handlers.draftPATCH(json({ expectedVersion: current.version, data: { notes: `Revision ${index}` } }, 'PATCH'), draft.id)
      expect(response.status).toBe(200)
      current = (await response.json()).draft
    }
    const first = await (await handlers.historyGET(get(), draft.id)).json()
    expect(first.entries).toHaveLength(50)
    expect(first.nextCursor).toBe(first.entries.at(-1).id)
    const second = await (await handlers.historyGET(get(`?cursor=${first.nextCursor}`), draft.id)).json()
    expect(second.entries).toHaveLength(3)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.entries, ...second.entries].map((entry: { id: string }) => entry.id)).size).toBe(53)
    expect(Object.keys(first.entries[0]).sort()).toEqual(['action', 'actorName', 'createdAt', 'id'])
    const batchId = (await (await handlers.batchesPOST()).json()).batch.id
    const secondBytes = await sharp({ create: { width: 8, height: 12, channels: 3, background: '#abcdef' } }).png().toBuffer()
    const form = new FormData()
    form.set('batchId', batchId)
    form.set('file', new Blob([Uint8Array.from(secondBytes)], { type: 'image/png' }), 'Second.png')
    const other = (await (await handlers.draftsPOST(new NextRequest('http://localhost/api/finance/invoice-import/drafts', { method: 'POST', body: form }))).json()).draft
    expect((await handlers.historyGET(get(`?cursor=${first.nextCursor}`), other.id)).status).toBe(422)
  })

  it('drives the real HTTP adapter with the browser client and preserves actionable errors', async () => {
    const client = createInvoiceImportClient(async (url, init) => {
      const request = new NextRequest(`http://localhost${String(url)}`, init)
      const pathname = request.nextUrl.pathname
      if (pathname.endsWith('/batches')) return handlers.batchesPOST()
      if (pathname.endsWith('/drafts')) return init?.method === 'POST' ? handlers.draftsPOST(request) : handlers.draftsGET(request)
      const parts = pathname.split('/')
      const id = decodeURIComponent(parts[5])
      if (pathname.endsWith('/actions')) return handlers.actionsPOST(request, id)
      if (pathname.endsWith('/approve')) return init?.method === 'DELETE' ? handlers.approveDELETE(request, id) : handlers.approvePOST(request, id)
      if (pathname.endsWith('/history')) return handlers.historyGET(request, id)
      if (pathname.endsWith('/file')) return handlers.fileGET(request, id)
      return init?.method === 'PATCH' ? handlers.draftPATCH(request, id) : handlers.draftGET(id)
    })
    const batch = await client.createBatch()
    const uploaded = await client.upload(batch.id, new File([Uint8Array.from(bytes)], 'Browser ąż.png', { type: 'image/png' }))
    expect(uploaded.deduplicated).toBe(false)
    expect((await client.list()).map((draft) => draft.id)).toEqual([uploaded.draft.id])
    const current = await client.edit(uploaded.draft.id, uploaded.draft.version, { supplierName: 'Browser' })
    expect((await client.get(current.id)).data.supplierName).toBe('Browser')
    await expect(client.edit(current.id, 1, { supplierName: 'Stale' })).rejects.toMatchObject({ status: 409, code: 'STALE_VERSION' })
    await expect(client.approve(current.id, current.version, randomUUID())).rejects.toMatchObject({ status: 422, code: 'APPROVAL_VALIDATION_FAILED', issues: expect.arrayContaining([expect.objectContaining({ field: 'invoiceNumber' })]) })
    const skipped = await client.action(current.id, current.version, 'SKIP')
    expect(skipped.skippedAt).not.toBeNull()
    expect((await client.history(current.id)).entries).toHaveLength(3)
    const original = await client.original(current.id, current.attachment)
    expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes)
    await expect(client.original(current.id, { ...current.attachment, sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'INVALID_ORIGINAL' })
    const ready = await client.edit(current.id, skipped.version, { documentType: 'INVOICE', taxId: 'PL1234567890', invoiceNumber: 'HTTP/1',
      issueDate: '2026-08-10', gross: 123, currency: 'PLN', paymentStatus: 'UNPAID', costCenterId: 'JAG', tagIds: ['fixed'] })
    const key = randomUUID()
    const approved = await client.approve(ready.id, ready.version, key)
    expect(approved.outcome).toBe('APPROVED')
    expect(await client.approve(ready.id, ready.version, key)).toEqual(approved)
    expect(await db.costEvent.count({ where: { status: 'APPROVED' } })).toBe(1)
    const revoked = await client.revoke(ready.id, approved.version, randomUUID())
    expect(revoked).toMatchObject({ outcome: 'REVOKED', invoiceId: approved.invoiceId })
    expect(await db.costEvent.count({ where: { status: 'APPROVED' } })).toBe(0)
    expect((await client.get(ready.id)).invoiceId).toBe(approved.invoiceId)
  })
})
