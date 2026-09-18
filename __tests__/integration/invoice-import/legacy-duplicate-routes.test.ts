// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@/generated/prisma'
import { POST as CREATE_INVOICE } from '@/app/api/finance/ksef/invoices/route'
import * as invoiceRoute from '@/app/api/finance/ksef/invoices/[id]/route'
import { POST as APPROVE_INVOICE } from '@/app/api/finance/ksef/invoices/[id]/approve/route'
import { approveInvoiceDraft } from '@/lib/invoice-import/approval-service'

const state = vi.hoisted(() => ({ db: null as unknown as PrismaClient, authStatus: null as number | null }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.db } }))
vi.mock('@/lib/finance/finance-access', () => ({
  requireFinanceAdmin: vi.fn(async () => state.authStatus
    ? { error: new Response(JSON.stringify({ error: 'Access denied' }), { status: state.authStatus }) }
    : { session: { user: { id: 'admin', role: 'ADMIN' } } }),
}))

const directory = mkdtempSync(path.join(tmpdir(), 'invoice-legacy-duplicate-'))
const databaseUrl = `file:${path.join(directory, 'duplicates.db')}`
let other: PrismaClient

const manualData = (overrides: Record<string, unknown> = {}) => ({
  supplierName: 'Dostawca Sp. z o.o.', supplierNip: 'PL1234567890',
  invoiceNumber: 'FV/9/2026', issueDate: '2026-09-10', currency: 'PLN',
  grossAmount: 123, netAmount: 100, vatAmount: 23, ...overrides,
})
const jsonRequest = (body?: unknown) => new NextRequest('http://localhost/api/finance/ksef/invoices', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const createManual = (overrides: Record<string, unknown> = {}) => CREATE_INVOICE(jsonRequest(manualData(overrides)))
const approveManual = (id: string) => APPROVE_INVOICE(jsonRequest(), { params: Promise.resolve({ id }) })
const readInvoice = (id: string) => {
  expect(invoiceRoute.GET).toBeTypeOf('function')
  return invoiceRoute.GET(new NextRequest(`http://localhost/api/finance/ksef/invoices/${id}`), {
    params: Promise.resolve({ id }),
  })
}
const approveDraft = (id: string, db = state.db) => approveInvoiceDraft(db, 'admin', id, {
  expectedVersion: 1, idempotencyKey: `legacy-regression-${randomUUID()}`,
})

async function createDraft(overrides: Record<string, unknown> = {}) {
  const batch = await state.db.invoiceImportBatch.create({ data: { ownerUserId: 'admin' } })
  const attachment = await state.db.invoiceAttachment.create({ data: {
    storageKey: `${randomUUID()}.bin`, sha256: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    originalName: 'invoice.pdf', mimeType: 'application/pdf', byteSize: 100, pageCount: 1,
    state: 'READY', createdById: 'admin',
  } })
  return state.db.invoiceImportDraft.create({ data: {
    batchId: batch.id, attachmentId: attachment.id,
    dataJson: JSON.stringify({
      documentType: 'INVOICE', supplierName: 'Dostawca Sp. z o.o.', taxId: 'PL1234567890',
      invoiceNumber: 'FV/9/2026', issueDate: '2026-09-10', currency: 'PLN',
      gross: 123, net: 100, vat: 23, paymentStatus: 'UNPAID', costCenterId: 'JAG',
      tagIds: ['tag-fixed'], ...overrides,
    }),
  } })
}

async function snapshot() {
  return {
    invoices: await state.db.ksefInvoice.findMany({ orderBy: { id: 'asc' } }),
    parts: await state.db.ksefInvoicePart.findMany({ orderBy: { id: 'asc' } }),
    partTags: await state.db.ksefInvoicePartTag.findMany({ orderBy: [{ partId: 'asc' }, { tagId: 'asc' }] }),
    allocations: await state.db.ksefInvoicePartAllocation.findMany({ orderBy: { id: 'asc' } }),
    costs: await state.db.costEvent.findMany({ orderBy: { id: 'asc' } }),
    costParts: await state.db.costEventPart.findMany({ orderBy: { id: 'asc' } }),
    costTags: await state.db.costEventPartTag.findMany({ orderBy: [{ partId: 'asc' }, { tagId: 'asc' }] }),
    costAllocations: await state.db.costEventPartAllocation.findMany({ orderBy: { id: 'asc' } }),
    costAudits: await state.db.costAuditLog.findMany({ orderBy: { id: 'asc' } }),
    draftAudits: await state.db.invoiceDraftAudit.findMany({ orderBy: { id: 'asc' } }),
    drafts: await state.db.invoiceImportDraft.findMany({ orderBy: { id: 'asc' } }),
  }
}

async function expectDuplicate(response: Response, invoiceId: string, draftId: string | null) {
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({
    code: 'INVOICE_DUPLICATE', error: 'Ta faktura jest już zapisana. Otwórz istniejący dokument.',
    duplicate: { invoiceId, draftId },
  })
}

beforeAll(async () => {
  const initialized = spawnSync('sqlite3', [path.join(directory, 'duplicates.db'), 'VACUUM;'], { encoding: 'utf8' })
  if (initialized.status !== 0) throw new Error(initialized.stderr || initialized.stdout)
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(migrated.stderr || migrated.stdout)
  state.db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  other = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await state.db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
})

beforeEach(async () => {
  state.authStatus = null
  await state.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "InvoiceDraftAudit_delete_guard"')
  await state.db.invoiceDraftAudit.deleteMany()
  await state.db.invoiceImportDraft.deleteMany()
  await state.db.invoiceAttachment.deleteMany()
  await state.db.invoiceImportBatch.deleteMany()
  await state.db.costAuditLog.deleteMany()
  await state.db.costEventPartTag.deleteMany()
  await state.db.costEventPartAllocation.deleteMany()
  await state.db.costEventPart.deleteMany()
  await state.db.costEvent.deleteMany()
  await state.db.ksefInvoicePartTag.deleteMany()
  await state.db.ksefInvoicePartAllocation.deleteMany()
  await state.db.ksefInvoicePart.deleteMany()
  await state.db.ksefInvoice.deleteMany()
  await state.db.ksefSupplierRuleTag.deleteMany()
  await state.db.ksefSupplierRule.deleteMany()
  await state.db.costTag.deleteMany()
  await state.db.costTagGroup.deleteMany()
  await state.db.costCenter.deleteMany()
  await state.db.aiJob.deleteMany()
  await state.db.aiQueueLease.deleteMany()
  await state.db.user.deleteMany()
  await state.db.user.create({ data: {
    id: 'admin', name: 'Admin', email: 'admin@duplicates.test', passwordHash: 'test', role: 'ADMIN',
  } })
  await state.db.costCenter.create({ data: { id: 'JAG', name: 'JAG' } })
  await state.db.costTagGroup.create({ data: { id: 'group-behavior', slug: 'behavior', name: 'Charakter' } })
  await state.db.costTag.create({ data: { id: 'tag-fixed', groupId: 'group-behavior', slug: 'fixed', name: 'Stały' } })
  await state.db.ksefSupplierRule.create({ data: {
    supplierNamePattern: 'dostawca', costCenterId: 'JAG', tags: { create: { tagId: 'tag-fixed' } },
  } })
  await state.db.$executeRawUnsafe(`CREATE TRIGGER "InvoiceDraftAudit_delete_guard"
    BEFORE DELETE ON "InvoiceDraftAudit" BEGIN SELECT RAISE(ABORT, 'InvoiceDraftAudit rows are immutable'); END`)
})

afterAll(async () => {
  await state.db?.$disconnect()
  await other?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('legacy/import duplicate protection with actual SQLite handlers', () => {
  it('reads the existing legacy invoice with an explicit private summary after a duplicate response', async () => {
    const created = await createManual({ supplierNip: ' DE 123-ABC ' })
    expect(created.status).toBe(201)
    const original = await created.json()
    await state.db.ksefInvoice.update({ where: { id: original.id }, data: {
      notes: 'Private accounting notes', xmlContent: '<PrivateInvoice/>', bankAccount: 'private-account',
    } })
    const duplicate = await createManual({ supplierNip: 'DE123ABC' })
    await expectDuplicate(duplicate, original.id, null)
    const before = await snapshot()

    const response = await readInvoice(original.id)

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ invoice: {
      id: original.id, supplierName: 'Dostawca Sp. z o.o.', supplierNip: 'DE 123-ABC',
      invoiceNumber: 'FV/9/2026', issueDate: '2026-09-10T00:00:00.000Z',
      grossAmount: 123, currency: 'PLN', status: 'MAPPED',
    } })
    expect(await snapshot()).toEqual(before)
  })

  it.each([401, 403])('rejects the invoice summary when finance admin access returns %s', async (status) => {
    const created = await createManual()
    const invoice = await created.json()
    state.authStatus = status
    const before = await snapshot()

    const response = await readInvoice(invoice.id)

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: 'Access denied' })
    expect(await snapshot()).toEqual(before)
  })

  it('returns a private 404 for a missing invoice summary', async () => {
    const before = await snapshot()
    const response = await readInvoice('missing-invoice')
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ error: 'Invoice not found' })
    expect(await snapshot()).toEqual(before)
  })

  it('blocks manual recreation after import approval and preserves the existing document pointer without writes', async () => {
    const draft = await createDraft()
    const imported = await approveDraft(draft.id)
    expect(imported.outcome).toBe('APPROVED')
    const before = await snapshot()

    await expectDuplicate(await createManual(), imported.invoiceId, draft.id)

    expect(await snapshot()).toEqual(before)
    expect(await state.db.costEvent.aggregate({ where: { status: 'APPROVED', documentStatus: 'ACTIVE' },
      _count: true, _sum: { grossAmount: true } })).toMatchObject({ _count: 1, _sum: { grossAmount: 123 } })
  })

  it('blocks approval of an already stored legacy duplicate before creating cost or audit records', async () => {
    const draft = await createDraft()
    const imported = await approveDraft(draft.id)
    // A historic duplicate, deliberately inserted as fixture to bypass the creation endpoint.
    const legacy = await state.db.ksefInvoice.create({ data: {
      ...manualData(), issueDate: new Date('2026-09-10T19:30:00.000Z'), source: 'MANUAL', status: 'MAPPED',
      costCenterId: 'JAG', parts: { create: { label: 'FV/9/2026', grossAmount: 123,
        tags: { create: { tagId: 'tag-fixed' } }, allocations: { create: { costCenterId: 'JAG', percent: 100 } } } },
    } })
    const before = await snapshot()

    await expectDuplicate(await approveManual(legacy.id), imported.invoiceId, draft.id)

    expect(await snapshot()).toEqual(before)
  })

  it('returns a null draft pointer when the existing document came from manual entry', async () => {
    const firstResponse = await createManual()
    expect(firstResponse.status).toBe(201)
    const first = await firstResponse.json()
    const before = await snapshot()
    await expectDuplicate(await createManual(), first.id, null)
    expect(await snapshot()).toEqual(before)
  })

  it('keeps reverse-order import approval duplicate semantics and one active cost', async () => {
    const legacyResponse = await createManual()
    expect(legacyResponse.status).toBe(201)
    const legacy = await legacyResponse.json()
    expect((await approveManual(legacy.id)).status).toBe(200)
    const draft = await createDraft()

    expect(await approveDraft(draft.id)).toMatchObject({ outcome: 'DUPLICATE', invoiceId: legacy.id, costEventId: null })

    expect(await state.db.ksefInvoice.count()).toBe(1)
    expect(await state.db.costEvent.count({ where: { status: 'APPROVED', documentStatus: 'ACTIVE' } })).toBe(1)
  })

  it('serializes concurrent manual creation and import approval across independent SQLite clients', async () => {
    const draft = await createDraft()
    const [manualResponse, imported] = await Promise.all([createManual(), approveDraft(draft.id, other)])
    if (imported.outcome === 'APPROVED') {
      await expectDuplicate(manualResponse, imported.invoiceId, draft.id)
    } else {
      expect(imported.outcome).toBe('DUPLICATE')
      expect(manualResponse.status).toBe(201)
      const manual = await manualResponse.json()
      expect(imported.invoiceId).toBe(manual.id)
      expect((await approveManual(manual.id)).status).toBe(200)
    }
    expect(await state.db.ksefInvoice.count()).toBe(1)
    expect(await state.db.costEvent.aggregate({ where: { status: 'APPROVED', documentStatus: 'ACTIVE' },
      _count: true, _sum: { grossAmount: true } })).toMatchObject({ _count: 1, _sum: { grossAmount: 123 } })
  })

  it.each([
    { label: 'PL prefix', taxId: 'PL1234567890', supplierNip: '123-456-78-90' },
    { label: 'missing manual tax ID', taxId: 'PL1234567890', supplierNip: '' },
    { label: 'missing imported tax ID', taxId: null, supplierNip: 'PL1234567890' },
    { label: 'foreign letters and separators', taxId: 'DE 123-ABC', supplierNip: 'de123abc' },
  ])('uses the same conservative identity for $label', async ({ taxId, supplierNip }) => {
    const draft = await createDraft({ taxId })
    const imported = await approveDraft(draft.id)
    const before = await snapshot()
    await expectDuplicate(await createManual({ supplierNip, supplierName: '  DOSTAWCA   SP. Z O.O. ',
      invoiceNumber: ' fv/9/2026 ' }), imported.invoiceId, draft.id)
    expect(await snapshot()).toEqual(before)
  })

  it.each([
    { label: 'different foreign country prefix', importedTaxId: 'DE1234567890', overrides: { supplierNip: ' GB1234567890 ' } },
    { label: 'different foreign letters', importedTaxId: 'DE123ABC', overrides: { supplierNip: 'DE123DEF' } },
    { label: 'different invoice number', importedTaxId: undefined, overrides: { invoiceNumber: 'FV/10/2026' } },
    { label: 'different UTC date', importedTaxId: undefined, overrides: { issueDate: '2026-09-11' } },
  ])('allows $label through both create and approve handlers', async ({ importedTaxId, overrides }) => {
    const draft = await createDraft(importedTaxId ? { taxId: importedTaxId } : {})
    await approveDraft(draft.id)
    const response = await createManual(overrides)
    expect(response.status).toBe(201)
    const manual = await response.json()
    expect(manual.supplierNip).toBe((overrides.supplierNip ?? 'PL1234567890').trim())
    expect((await approveManual(manual.id)).status).toBe(200)
    expect(await state.db.ksefInvoice.count()).toBe(2)
    expect(await state.db.costEvent.count({ where: { status: 'APPROVED', documentStatus: 'ACTIVE' } })).toBe(2)
  })
})
