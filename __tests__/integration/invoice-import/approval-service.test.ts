// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { approveInvoiceDraft, revokeInvoiceDraft } from '@/lib/invoice-import/approval-service'
import { editDraft } from '@/lib/invoice-import/draft-service'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-invoice-approval-'))
const databaseUrl = `file:${path.join(directory, 'approval.db')}`
const client = () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
let db: PrismaClient
let other: PrismaClient

const validData = (overrides: Record<string, unknown> = {}) => ({
  documentType: 'INVOICE', supplierName: 'Dostawca Sp. z o.o.', taxId: 'PL1234567890',
  invoiceNumber: 'FV/9/2026', issueDate: '2026-09-10', currency: 'PLN',
  gross: 123, net: 100, vat: 23, paymentStatus: 'UNPAID', costCenterId: 'JAG',
  tagIds: ['tag-fixed'], ...overrides,
})

async function seedBase() {
  await db.user.createMany({ data: [
    { id: 'admin', role: 'ADMIN', name: 'Admin', email: 'admin@example.test', passwordHash: 'test' },
    { id: 'admin2', role: 'ADMIN', name: 'Admin 2', email: 'admin2@example.test', passwordHash: 'test' },
    { id: 'manager', role: 'MANAGER', name: 'Manager', email: 'manager@example.test', passwordHash: 'test' },
    { id: 'disabled', role: 'ADMIN', isActive: false, name: 'Disabled', email: 'disabled@example.test', passwordHash: 'test' },
    { id: 'password', role: 'ADMIN', mustChangePassword: true, name: 'Password', email: 'password@example.test', passwordHash: 'test' },
  ] })
  for (const id of ['JAG', 'PUL', 'GLOBAL']) {
    await db.costCenter.create({ data: { id, name: id } })
  }
  const behavior = await db.costTagGroup.create({ data: { id: 'group-behavior', slug: 'behavior', name: 'Charakter' } })
  await db.costTag.create({ data: { id: 'tag-fixed', groupId: behavior.id, slug: 'fixed', name: 'Stały' } })
  await db.costTag.create({ data: { id: 'tag-variable', groupId: behavior.id, slug: 'variable', name: 'Zmienny' } })
  const role = await db.costTagGroup.create({ data: { id: 'group-role', slug: 'role', name: 'Typ' } })
  await db.costTag.create({ data: { id: 'tag-confidential', groupId: role.id, slug: 'confidential', name: 'Poufne' } })
  await db.costTag.create({ data: { id: 'tag-inactive', groupId: role.id, slug: 'inactive', name: 'Nieaktywny', active: false } })
  const supplier = await db.costTagGroup.create({ data: { id: 'group-supplier', slug: 'supplier-group', name: 'Dostawca' } })
  await db.costTag.create({ data: { id: 'tag-strategic', groupId: supplier.id, slug: 'strategic', name: 'Stały dostawca' } })
  await db.costTag.create({ data: { id: 'tag-new', groupId: supplier.id, slug: 'new', name: 'Nowy dostawca' } })
}

async function createDraft(data = validData()) {
  const batch = await db.invoiceImportBatch.create({ data: { ownerUserId: 'admin' } })
  const attachment = await db.invoiceAttachment.create({ data: {
    storageKey: `${randomUUID()}.bin`, sha256: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    originalName: 'faktura.pdf', mimeType: 'application/pdf', byteSize: 100, pageCount: 1,
    state: 'READY', createdById: 'admin',
  } })
  return db.invoiceImportDraft.create({ data: {
    batchId: batch.id, attachmentId: attachment.id, dataJson: JSON.stringify(data),
  } })
}

const approveInput = (key: string, expectedVersion = 1, confirmedPeriodIds: string[] = []) => ({
  expectedVersion, idempotencyKey: key, confirmedPeriodIds,
})

beforeAll(async () => {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' }, encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(migrated.stderr || migrated.stdout)
  db = client()
  other = client()
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
})

beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "InvoiceDraftAudit_delete_guard"')
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_approval_audit_failure"')
  await db.invoiceDraftAudit.deleteMany()
  await db.invoiceImportDraft.deleteMany()
  await db.invoiceAttachment.deleteMany()
  await db.invoiceImportBatch.deleteMany()
  await db.costAuditLog.deleteMany()
  await db.costEventPartTag.deleteMany()
  await db.costEventPartAllocation.deleteMany()
  await db.costEventPart.deleteMany()
  await db.costEvent.deleteMany()
  await db.ksefInvoicePartTag.deleteMany()
  await db.ksefInvoicePartAllocation.deleteMany()
  await db.ksefInvoicePart.deleteMany()
  await db.ksefInvoice.deleteMany()
  await db.ksefSupplierRuleTag.deleteMany()
  await db.ksefSupplierRule.deleteMany()
  await db.financePeriodClose.deleteMany()
  await db.costTag.deleteMany()
  await db.costTagGroup.deleteMany()
  await db.costCenter.deleteMany()
  await db.aiJob.deleteMany()
  await db.aiQueueLease.deleteMany()
  await db.user.deleteMany()
  await seedBase()
  await db.$executeRawUnsafe(`CREATE TRIGGER "InvoiceDraftAudit_delete_guard"
    BEFORE DELETE ON "InvoiceDraftAudit" BEGIN SELECT RAISE(ABORT, 'InvoiceDraftAudit rows are immutable'); END`)
})

afterAll(async () => {
  await db?.$disconnect()
  await other?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('invoice draft approval service', () => {
  it('atomically creates the approved invoice, active cost and immutable receipt', async () => {
    const draft = await createDraft()

    const result = await approveInvoiceDraft(db, 'admin', draft.id, {
      expectedVersion: 1, idempotencyKey: 'approve-0001',
    })

    expect(result).toMatchObject({
      outcome: 'APPROVED', draftId: draft.id, version: 2,
      invoiceId: expect.any(String), costEventId: expect.any(String),
    })
    const storedDraft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })
    expect(storedDraft).toMatchObject({ state: 'APPROVED', version: 2, invoiceId: result.invoiceId })
    expect(await db.ksefInvoice.count()).toBe(1)
    expect(await db.costEvent.count()).toBe(1)
    expect(await db.invoiceDraftAudit.count()).toBe(1)
  })

  it.each(['missing', 'manager', 'disabled', 'password'])('authorizes from the current database role for %s', async (actorId) => {
    const draft = await createDraft()
    await expect(approveInvoiceDraft(db, actorId, draft.id, {
      expectedVersion: 1, idempotencyKey: `deny-${actorId}-01`,
    })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(await db.ksefInvoice.count()).toBe(0)
    expect(await db.costEvent.count()).toBe(0)
  })

  it.each([
    { input: {}, code: 'INVALID_INPUT' },
    { input: { expectedVersion: 0, idempotencyKey: 'invalid-0001' }, code: 'INVALID_INPUT' },
    { input: { expectedVersion: 1, idempotencyKey: 'short' }, code: 'INVALID_INPUT' },
    { input: { expectedVersion: 1, idempotencyKey: 'invalid-0002', unexpected: true }, code: 'INVALID_INPUT' },
    { input: { expectedVersion: 1, idempotencyKey: 'invalid-0003', confirmedPeriodIds: ['x', 'x'] }, code: 'INVALID_INPUT' },
  ])('strictly rejects malformed mutation input %#', async ({ input, code }) => {
    const draft = await createDraft()
    await expect(approveInvoiceDraft(db, 'admin', draft.id, input)).rejects.toMatchObject({ code, status: 422 })
    expect(await db.ksefInvoice.count()).toBe(0)
  })

  it.each([
    [{ gross: -1 }, 'NEGATIVE_AMOUNT'],
    [{ documentType: 'PROFORMA' }, 'PROFORMA_UNSUPPORTED'],
    [{ issueDate: '2026-03-31' }, 'ISSUE_DATE_BEFORE_CUTOVER'],
    [{ supplierName: undefined }, 'SUPPLIER_NAME_REQUIRED'],
  ] as const)('returns controlled field issues for blocked approval data %#', async (overrides, issueCode) => {
    const draft = await createDraft(validData(overrides))
    await expect(approveInvoiceDraft(db, 'admin', draft.id, {
      expectedVersion: 1, idempotencyKey: `blocked-${issueCode}`,
    })).rejects.toMatchObject({
      code: 'APPROVAL_VALIDATION_FAILED', status: 422,
      issues: [expect.objectContaining({ code: issueCode, messagePolish: expect.any(String) })],
    })
    expect(await db.ksefInvoice.count()).toBe(0)
  })

  it.each([
    [{ costCenterId: 'PUL' }, 'COST_CENTER_NOT_FOUND'],
    [{ tagIds: ['missing-tag'] }, 'TAG_NOT_FOUND'],
    [{ tagIds: ['tag-fixed', 'tag-inactive'] }, 'TAG_INACTIVE'],
    [{ tagIds: ['tag-fixed', 'tag-variable'] }, 'CONTRADICTORY_TAGS'],
    [{ tagIds: ['tag-confidential'] }, 'BEHAVIOR_TAG_REQUIRED'],
    [{ tagIds: ['tag-fixed', 'tag-strategic', 'tag-new'] }, 'CONTRADICTORY_TAGS'],
  ] as const)('rejects invalid stored classification %#', async (overrides, issueCode) => {
    if (issueCode === 'COST_CENTER_NOT_FOUND') await db.costCenter.delete({ where: { id: 'PUL' } })
    const draft = await createDraft(validData(overrides))
    await expect(approveInvoiceDraft(db, 'admin', draft.id, {
      expectedVersion: 1, idempotencyKey: `classify-${issueCode}`,
    })).rejects.toMatchObject({ code: 'APPROVAL_VALIDATION_FAILED', status: 422,
      issues: [expect.objectContaining({ code: issueCode })] })
  })

  it('persists exact nominal, reporting, classification and payment data without invented values or rules', async () => {
    const draft = await createDraft(validData({
      supplierName: 'Lieferant GmbH', taxId: 'DE 123-ABC', invoiceNumber: 'EU-01',
      currency: 'EUR', gross: 10, net: null, vat: null,
      reportingGross: 43.21, reportingNet: null, reportingVat: null,
      conversionConfirmed: true, conversionNote: 'Kurs z potwierdzonego wyciągu',
      tagIds: ['tag-fixed', 'tag-confidential'], paymentStatus: 'PAID',
      bankAccount: 'DE001234', notes: 'Poufna faktura',
    }))
    const result = await approveInvoiceDraft(db, 'admin', draft.id, approveInput('foreign-0001'))

    const invoice = await db.ksefInvoice.findUniqueOrThrow({ where: { id: result.invoiceId },
      include: { parts: { include: { tags: true, allocations: true } } } })
    expect(invoice).toMatchObject({
      source: 'MANUAL', supplierName: 'Lieferant GmbH', supplierNip: 'DE 123-ABC', invoiceNumber: 'EU-01',
      grossAmount: 10, netAmount: null, vatAmount: null, currency: 'EUR',
      reportingGrossAmount: 43.21, reportingNetAmount: null, reportingVatAmount: null,
      originalCurrency: 'EUR', originalGrossAmount: 10, originalNetAmount: null, originalVatAmount: null,
      currencyConversionNote: 'Kurs z potwierdzonego wyciągu', convertedById: 'admin',
      paymentStatus: 'PAID', paidAt: null, dueDate: null, bankAccount: 'DE001234', notes: 'Poufna faktura',
      costCenterId: 'JAG', subCategoryId: null, supplierRuleId: null, status: 'APPROVED', documentStatus: 'ACTIVE',
    })
    expect(invoice.convertedAt).toBeInstanceOf(Date)
    expect(invoice.parts).toHaveLength(1)
    expect(invoice.parts[0]).toMatchObject({ grossAmount: 43.21,
      tags: expect.arrayContaining([
        expect.objectContaining({ tagId: 'tag-fixed' }),
        expect.objectContaining({ tagId: 'tag-confidential' }),
      ]),
      allocations: [{ costCenterId: 'JAG', percent: 100 }] })
    const event = await db.costEvent.findUniqueOrThrow({ where: { id: result.costEventId! },
      include: { parts: { include: { tags: true, allocations: true } } } })
    expect(event).toMatchObject({ source: 'MANUAL', sourceInvoiceId: invoice.id, supplierNip: 'DE 123-ABC',
      grossAmount: 43.21, netAmount: null, vatAmount: null, currency: 'PLN', isConfidential: true,
      status: 'APPROVED', documentStatus: 'ACTIVE', createdById: 'admin' })
    expect(event.parts).toHaveLength(1)
    expect(event.parts[0].tags).toHaveLength(2)
    expect(event.parts[0].allocations).toEqual([expect.objectContaining({ costCenterId: 'JAG', percent: 100, fallbackUsed: false })])
    expect(await db.ksefSupplierRule.count()).toBe(0)
    expect(await db.actualEntry.count()).toBe(0)
    const receipt = await db.invoiceDraftAudit.findFirstOrThrow({ where: { action: 'APPROVED' } })
    expect(receipt.requestHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.parse(receipt.resultJson!)).toEqual(result)
    expect(receipt.resultJson).not.toContain('storageKey')
    expect(await db.costAuditLog.count()).toBe(1)
  })

  it('accepts zero PLN amounts and leaves all foreign-conversion and optional date fields null', async () => {
    const draft = await createDraft(validData({ gross: 0, net: 0, vat: 0, taxId: 'PL0000000000' }))
    const result = await approveInvoiceDraft(db, 'admin', draft.id, approveInput('zero-amount-01'))
    const invoice = await db.ksefInvoice.findUniqueOrThrow({ where: { id: result.invoiceId } })
    expect(invoice).toMatchObject({ grossAmount: 0, netAmount: 0, vatAmount: 0,
      reportingGrossAmount: 0, reportingNetAmount: 0, reportingVatAmount: 0,
      originalCurrency: null, originalGrossAmount: null, currencyConversionNote: null,
      convertedById: null, convertedAt: null, paidAt: null, dueDate: null })
  })

  it('rejects foreign drafts missing an authoritative PLN gross without exposing Zod details', async () => {
    const draft = await createDraft(validData({
      currency: 'EUR', gross: 10, reportingGross: null,
      conversionConfirmed: true, conversionNote: 'Kurs z banku',
    }))
    await expect(approveInvoiceDraft(db, 'admin', draft.id, approveInput('foreign-missing-pln')))
      .rejects.toMatchObject({ code: 'APPROVAL_VALIDATION_FAILED', status: 422,
        issues: expect.arrayContaining([expect.objectContaining({ code: 'REPORTING_GROSS_REQUIRED' })]) })
    expect(await db.ksefInvoice.count()).toBe(0)
  })

  it('requires READY attachment, exact OPEN state and current version', async () => {
    const storageError = await createDraft()
    await db.invoiceAttachment.update({ where: { id: storageError.attachmentId }, data: { state: 'STORAGE_ERROR' } })
    await expect(approveInvoiceDraft(db, 'admin', storageError.id, approveInput('not-ready-0001')))
      .rejects.toMatchObject({ code: 'ATTACHMENT_NOT_READY', status: 409 })

    const archived = await createDraft({ ...validData(), invoiceNumber: 'ARCHIVE-1' })
    await db.invoiceImportDraft.update({ where: { id: archived.id }, data: { state: 'ARCHIVED' } })
    await expect(approveInvoiceDraft(db, 'admin', archived.id, approveInput('archived-0001')))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })

    const stale = await createDraft({ ...validData(), invoiceNumber: 'STALE-1' })
    await expect(approveInvoiceDraft(db, 'admin', stale.id, approveInput('stale-000001', 2)))
      .rejects.toMatchObject({ code: 'STALE_VERSION', status: 409 })
    await expect(approveInvoiceDraft(db, 'admin', ` ${stale.id}`, approveInput('exact-id-0001')))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('returns the exact receipt before state/version checks and conflicts on changed key use', async () => {
    const draft = await createDraft()
    const input = approveInput('same-key-0001')
    const first = await approveInvoiceDraft(db, 'admin', draft.id, input)
    const retry = await approveInvoiceDraft(db, 'admin', draft.id, input)
    expect(retry).toEqual(first)
    expect(await db.ksefInvoice.count()).toBe(1)
    expect(await db.costEvent.count()).toBe(1)
    await expect(approveInvoiceDraft(db, 'admin', draft.id, { ...input, expectedVersion: 2 }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
  })

  it('serializes independent SQLite clients so concurrent approvals create one cost', async () => {
    const sameKeyDraft = await createDraft()
    const sameInput = approveInput('concurrent-same-key')
    const [first, second] = await Promise.all([
      approveInvoiceDraft(db, 'admin', sameKeyDraft.id, sameInput),
      approveInvoiceDraft(other, 'admin', sameKeyDraft.id, sameInput),
    ])
    expect(second).toEqual(first)
    expect(await db.costEvent.count()).toBe(1)

    const differentKeyDraft = await createDraft({ ...validData(), invoiceNumber: 'CONCURRENT-2' })
    const attempts = await Promise.allSettled([
      approveInvoiceDraft(db, 'admin', differentKeyDraft.id, approveInput('concurrent-key-a')),
      approveInvoiceDraft(other, 'admin2', differentKeyDraft.id, approveInput('concurrent-key-b')),
    ])
    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find((item) => item.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'STALE_VERSION', status: 409 })
    expect(await db.costEvent.count()).toBe(2)
  })

  it('deduplicates across all invoice history with full tax IDs and safe name fallback', async () => {
    const existing = await db.ksefInvoice.create({ data: {
      source: 'KSEF', supplierName: 'Inna nazwa', supplierNip: 'DE123ABC', invoiceNumber: ' eu-01 ',
      issueDate: new Date('2026-09-10T12:00:00.000Z'), grossAmount: 9, status: 'MAPPED', documentStatus: 'CANCELLED',
    } })
    const fullId = await createDraft(validData({
      supplierName: 'Całkiem inna nazwa', taxId: 'de 123-abc', invoiceNumber: 'EU-01',
    }))
    const duplicate = await approveInvoiceDraft(db, 'admin', fullId.id, approveInput('duplicate-full-id'))
    expect(duplicate).toEqual(expect.objectContaining({ outcome: 'DUPLICATE', invoiceId: existing.id,
      costEventId: null, version: 1 }))
    expect((await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: fullId.id } }))).toMatchObject({ state: 'OPEN', version: 1, invoiceId: null })
    expect(await db.costEvent.count()).toBe(0)

    const noNipInvoice = await db.ksefInvoice.create({ data: { supplierName: '  Dostawca   Bez NIP ',
      supplierNip: null, invoiceNumber: 'NN/1', issueDate: new Date('2026-09-11T00:00:00Z'), grossAmount: 10 } })
    const noNip = await createDraft(validData({ supplierName: 'dostawca bez nip', taxId: null,
      invoiceNumber: ' nn/1 ', issueDate: '2026-09-11' }))
    await expect(approveInvoiceDraft(db, 'admin', noNip.id, approveInput('duplicate-no-nip')))
      .resolves.toMatchObject({ outcome: 'DUPLICATE', invoiceId: noNipInvoice.id })
  })

  it('serializes two distinct drafts with canonically equal business identities into one invoice and cost', async () => {
    const first = await createDraft(validData({ taxId: 'PL1234567890', invoiceNumber: ' FV/CONCURRENT ' }))
    const second = await createDraft(validData({ taxId: '123-456-78-90', invoiceNumber: 'fv/concurrent' }))
    const results = await Promise.all([
      approveInvoiceDraft(db, 'admin', first.id, approveInput('different-draft-first')),
      approveInvoiceDraft(other, 'admin2', second.id, approveInput('different-draft-second')),
    ])
    expect(results.map((result) => result.outcome).sort()).toEqual(['APPROVED', 'DUPLICATE'])
    expect(new Set(results.map((result) => result.invoiceId)).size).toBe(1)
    expect(await db.ksefInvoice.count()).toBe(1)
    expect(await db.costEvent.count({ where: { status: 'APPROVED' } })).toBe(1)
    expect(await db.invoiceImportDraft.count({ where: { state: 'OPEN', invoiceId: null } })).toBe(1)
    expect(await db.invoiceImportDraft.count({ where: { state: 'APPROVED' } })).toBe(1)
  })

  it('does not fall back to supplier name when both tax IDs exist and differ', async () => {
    await db.ksefInvoice.create({ data: { supplierName: 'Shared Supplier', supplierNip: 'DE111',
      invoiceNumber: 'SAME-1', issueDate: new Date('2026-09-10T00:00:00Z'), grossAmount: 10 } })
    const draft = await createDraft(validData({ supplierName: 'Shared Supplier', taxId: 'DE222', invoiceNumber: 'SAME-1' }))
    await expect(approveInvoiceDraft(db, 'admin', draft.id, approveInput('different-tax-ids')))
      .resolves.toMatchObject({ outcome: 'APPROVED' })
    expect(await db.ksefInvoice.count()).toBe(2)
  })

  it('revokes exactly one active cost while retaining its immutable financial parts and permanent invoice link', async () => {
    const draft = await createDraft()
    const approved = await approveInvoiceDraft(db, 'admin', draft.id, approveInput('approve-revoke-01'))
    const beforeParts = await db.costEventPart.findMany({ where: { eventId: approved.costEventId! },
      include: { tags: true, allocations: true } })

    const revoked = await revokeInvoiceDraft(db, 'admin', draft.id, approveInput('revoke-000001', 2))
    expect(revoked).toMatchObject({ outcome: 'REVOKED', draftId: draft.id, version: 3,
      invoiceId: approved.invoiceId, costEventId: approved.costEventId })
    const storedDraft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })
    expect(storedDraft).toMatchObject({ state: 'OPEN', version: 3, invoiceId: approved.invoiceId, latestAiJobId: null })
    const invoice = await db.ksefInvoice.findUniqueOrThrow({ where: { id: approved.invoiceId } })
    expect(invoice).toMatchObject({ status: 'MAPPED', documentStatus: 'ACTIVE' })
    const cost = await db.costEvent.findUniqueOrThrow({ where: { id: approved.costEventId! } })
    expect(cost).toMatchObject({ status: 'VOID', sourceInvoiceId: null, documentStatus: 'ACTIVE' })
    expect(await db.costEventPart.findMany({ where: { eventId: cost.id }, include: { tags: true, allocations: true } }))
      .toEqual(beforeParts)
    expect(await db.ksefInvoicePart.count({ where: { invoiceId: invoice.id } })).toBe(1)
    expect(await db.costAuditLog.count()).toBe(2)
    expect(await revokeInvoiceDraft(db, 'admin', draft.id, approveInput('revoke-000001', 2))).toEqual(revoked)
    expect(await db.costEvent.count()).toBe(1)
  })

  it('edits after revoke and reapproves the same invoice ID with one new active cost', async () => {
    const draft = await createDraft()
    const first = await approveInvoiceDraft(db, 'admin', draft.id, approveInput('first-approval-01'))
    await revokeInvoiceDraft(db, 'admin', draft.id, approveInput('first-revoke-001', 2))
    const edited = await editDraft(db, 'admin', draft.id, 3, {
      invoiceNumber: 'FV/EDIT/2026', issueDate: '2026-10-03', gross: 246, net: 200, vat: 46,
    })
    expect(edited).toMatchObject({ version: 4, state: 'OPEN', invoiceId: first.invoiceId })
    const second = await approveInvoiceDraft(db, 'admin', draft.id, approveInput('second-approval-1', 4))
    expect(second).toMatchObject({ outcome: 'APPROVED', invoiceId: first.invoiceId, version: 5 })
    expect(second.costEventId).not.toBe(first.costEventId)
    const invoice = await db.ksefInvoice.findUniqueOrThrow({ where: { id: first.invoiceId }, include: { parts: true } })
    expect(invoice).toMatchObject({ invoiceNumber: 'FV/EDIT/2026', issueDate: new Date('2026-10-03T00:00:00Z'),
      grossAmount: 246, status: 'APPROVED' })
    expect(invoice.parts).toHaveLength(1)
    const costs = await db.costEvent.findMany({ orderBy: { createdAt: 'asc' }, include: { parts: true } })
    expect(costs).toHaveLength(2)
    expect(costs.map((cost) => cost.status).sort()).toEqual(['APPROVED', 'VOID'])
    expect(costs.find((cost) => cost.status === 'VOID')?.parts).toHaveLength(1)
    expect(costs.find((cost) => cost.status === 'APPROVED')).toMatchObject({ sourceInvoiceId: first.invoiceId,
      reference: 'FV/EDIT/2026', grossAmount: 246 })
  })

  it('an original approval receipt retried after revoke never recreates a cost', async () => {
    const draft = await createDraft()
    const originalInput = approveInput('old-approval-retry')
    const approval = await approveInvoiceDraft(db, 'admin', draft.id, originalInput)
    await revokeInvoiceDraft(db, 'admin', draft.id, approveInput('old-retry-revoke', 2))

    expect(await approveInvoiceDraft(db, 'admin', draft.id, originalInput)).toEqual(approval)
    expect(await db.costEvent.count()).toBe(1)
    expect(await db.costEvent.count({ where: { status: 'APPROVED' } })).toBe(0)
    expect((await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })).state).toBe('OPEN')
  })

  it('rejects revoke unless draft, linked invoice and exactly one active cost are consistent', async () => {
    const open = await createDraft()
    await expect(revokeInvoiceDraft(db, 'admin', open.id, approveInput('revoke-open-001')))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })

    const approvedDraft = await createDraft({ ...validData(), invoiceNumber: 'NO-COST-1' })
    const approved = await approveInvoiceDraft(db, 'admin', approvedDraft.id, approveInput('approve-no-cost'))
    await db.costEvent.update({ where: { id: approved.costEventId! }, data: { status: 'VOID', sourceInvoiceId: null } })
    await expect(revokeInvoiceDraft(db, 'admin', approvedDraft.id, approveInput('revoke-no-cost1', 2)))
      .rejects.toMatchObject({ code: 'COST_CONFLICT', status: 409 })
  })

  it('requires and invalidates exact old/new closed-period completion IDs atomically on reapproval', async () => {
    const draft = await createDraft(validData({ issueDate: '2026-08-20' }))
    const first = await approveInvoiceDraft(db, 'admin', draft.id, approveInput('months-approve-1'))
    await revokeInvoiceDraft(db, 'admin', draft.id, approveInput('months-revoke-01', 2))
    await editDraft(db, 'admin', draft.id, 3, { issueDate: '2026-09-02', invoiceNumber: 'MONTH-EDIT' })
    const august = await db.financePeriodClose.create({ data: { year: 2026, month: 8, closedById: 'admin' } })
    const september = await db.financePeriodClose.create({ data: { year: 2026, month: 9, closedById: 'admin' } })

    await expect(approveInvoiceDraft(db, 'admin', draft.id,
      approveInput('months-incomplete', 4, [september.id])))
      .rejects.toMatchObject({ code: 'CLOSED_PERIOD_CONFIRMATION_REQUIRED', status: 409,
        periods: [expect.objectContaining({ id: august.id })] })
    expect(await db.financePeriodClose.count()).toBe(2)
    expect(await db.costEvent.count()).toBe(1)
    expect(await db.ksefInvoice.findUniqueOrThrow({ where: { id: first.invoiceId } })).toMatchObject({
      status: 'MAPPED', issueDate: new Date('2026-08-20T00:00:00Z'),
    })

    const result = await approveInvoiceDraft(db, 'admin', draft.id,
      approveInput('months-complete-1', 4, [september.id, august.id]))
    expect(result.outcome).toBe('APPROVED')
    if (result.outcome !== 'APPROVED') throw new Error('Expected approval result')
    expect(result.invalidatedPeriods?.map((period) => period.id).sort()).toEqual([august.id, september.id].sort())
    expect(await db.financePeriodClose.count()).toBe(0)
    expect(await db.costAuditLog.count({ where: { action: 'finance.period.invalidate' } })).toBe(2)
  })

  it('rolls back invoice, cost, parts, draft, receipt and closed-period invalidation when the final audit fails', async () => {
    const draft = await createDraft(validData({ issueDate: '2026-07-15' }))
    const closed = await db.financePeriodClose.create({ data: { year: 2026, month: 7, closedById: 'admin' } })
    await db.$executeRawUnsafe(`CREATE TRIGGER "test_approval_audit_failure"
      BEFORE INSERT ON "InvoiceDraftAudit" WHEN NEW.action = 'APPROVED'
      BEGIN SELECT RAISE(ABORT, 'test approval audit failure'); END`)

    await expect(approveInvoiceDraft(db, 'admin', draft.id,
      approveInput('rollback-final-audit', 1, [closed.id]))).rejects.toThrow()
    expect(await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .toMatchObject({ state: 'OPEN', version: 1, invoiceId: null })
    expect(await db.ksefInvoice.count()).toBe(0)
    expect(await db.ksefInvoicePart.count()).toBe(0)
    expect(await db.costEvent.count()).toBe(0)
    expect(await db.costEventPart.count()).toBe(0)
    expect(await db.costAuditLog.count()).toBe(0)
    expect(await db.invoiceDraftAudit.count()).toBe(0)
    expect(await db.financePeriodClose.findUnique({ where: { id: closed.id } })).not.toBeNull()
  })

  it('rolls back revocation and period invalidation when its final audit fails', async () => {
    const draft = await createDraft(validData({ issueDate: '2026-07-15' }))
    const approved = await approveInvoiceDraft(db, 'admin', draft.id, approveInput('revoke-rollback-first'))
    const closed = await db.financePeriodClose.create({ data: { year: 2026, month: 7, closedById: 'admin' } })
    const invoiceBefore = await db.ksefInvoice.findUniqueOrThrow({ where: { id: approved.invoiceId } })
    const costBefore = await db.costEvent.findUniqueOrThrow({ where: { id: approved.costEventId! } })
    const draftBefore = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })
    const auditsBefore = await db.costAuditLog.count()
    await db.$executeRawUnsafe(`CREATE TRIGGER "test_approval_audit_failure"
      BEFORE INSERT ON "InvoiceDraftAudit" WHEN NEW.action = 'REVOKED'
      BEGIN SELECT RAISE(ABORT, 'test revoke audit failure'); END`)

    await expect(revokeInvoiceDraft(db, 'admin', draft.id,
      approveInput('revoke-rollback-final', 2, [closed.id]))).rejects.toThrow()
    expect(await db.ksefInvoice.findUniqueOrThrow({ where: { id: approved.invoiceId } })).toEqual(invoiceBefore)
    expect(await db.costEvent.findUniqueOrThrow({ where: { id: approved.costEventId! } })).toEqual(costBefore)
    expect(await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })).toEqual(draftBefore)
    expect(await db.financePeriodClose.findUnique({ where: { id: closed.id } })).toEqual(closed)
    expect(await db.costAuditLog.count()).toBe(auditsBefore)
    expect(await db.invoiceDraftAudit.count({ where: { action: 'REVOKED' } })).toBe(0)
  })

  it('cancels only a latest QUEUED extraction and detaches a latest RUNNING extraction', async () => {
    const queuedDraft = await createDraft()
    const queued = await db.aiJob.create({ data: { ownerUserId: 'admin', kind: 'INVOICE_EXTRACT',
      status: 'QUEUED', payloadJson: JSON.stringify({ draftId: queuedDraft.id, attachmentId: queuedDraft.attachmentId, revision: 1 }) } })
    await db.invoiceImportDraft.update({ where: { id: queuedDraft.id }, data: { latestAiJobId: queued.id } })
    await approveInvoiceDraft(db, 'admin', queuedDraft.id, approveInput('cancel-queued-01'))
    expect(await db.aiJob.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: 'CANCELLED',
      workerId: null, leaseToken: null, leaseUntil: null })

    const runningDraft = await createDraft({ ...validData(), invoiceNumber: 'RUNNING-1' })
    const running = await db.aiJob.create({ data: { ownerUserId: 'admin', kind: 'INVOICE_EXTRACT',
      status: 'RUNNING', payloadJson: JSON.stringify({ draftId: runningDraft.id, attachmentId: runningDraft.attachmentId, revision: 1 }),
      workerId: 'worker', leaseToken: 'lease', leaseUntil: new Date(Date.now() + 60_000) } })
    await db.invoiceImportDraft.update({ where: { id: runningDraft.id }, data: { latestAiJobId: running.id } })
    await approveInvoiceDraft(db, 'admin', runningDraft.id, approveInput('detach-running-1'))
    expect((await db.aiJob.findUniqueOrThrow({ where: { id: running.id } })).status).toBe('RUNNING')
    expect((await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: runningDraft.id } })).latestAiJobId).toBeNull()
  })

  it('keeps archival/KSeF fields and MANUAL source while reapproval replaces only current invoice parts', async () => {
    const draft = await createDraft()
    const first = await approveInvoiceDraft(db, 'admin', draft.id, approveInput('archive-fields-approve'))
    await revokeInvoiceDraft(db, 'admin', draft.id, approveInput('archive-fields-revoke', 2))
    await db.ksefInvoice.update({ where: { id: first.invoiceId }, data: {
      externalId: 'KSEF-ARCHIVE-1', xmlContent: '<Invoice>archive</Invoice>', xmlFetchedAt: new Date('2026-09-11T10:00:00Z'),
      paymentDetailsFetchedAt: new Date('2026-09-11T11:00:00Z'),
    } })
    await editDraft(db, 'admin', draft.id, 3, { gross: 124, net: 101, vat: 23 })
    await approveInvoiceDraft(db, 'admin', draft.id, approveInput('archive-fields-reapprove', 4))
    expect(await db.ksefInvoice.findUniqueOrThrow({ where: { id: first.invoiceId } })).toMatchObject({
      source: 'MANUAL', externalId: 'KSEF-ARCHIVE-1', xmlContent: '<Invoice>archive</Invoice>',
      xmlFetchedAt: new Date('2026-09-11T10:00:00Z'), paymentDetailsFetchedAt: new Date('2026-09-11T11:00:00Z'),
      grossAmount: 124,
    })
    expect(await db.ksefInvoicePart.count({ where: { invoiceId: first.invoiceId } })).toBe(1)
  })

  it('fails reapproval on an unexpected linked cost without mutating invoice or draft', async () => {
    const draft = await createDraft()
    const first = await approveInvoiceDraft(db, 'admin', draft.id, approveInput('conflict-approve-1'))
    await revokeInvoiceDraft(db, 'admin', draft.id, approveInput('conflict-revoke-01', 2))
    await db.costEvent.create({ data: { source: 'MANUAL', sourceInvoiceId: first.invoiceId,
      eventDate: new Date('2026-09-10T00:00:00Z'), grossAmount: 1, status: 'DRAFT', documentStatus: 'ACTIVE' } })
    await expect(approveInvoiceDraft(db, 'admin', draft.id, approveInput('conflict-reapprove', 3)))
      .rejects.toMatchObject({ code: 'COST_CONFLICT', status: 409 })
    expect(await db.ksefInvoice.findUniqueOrThrow({ where: { id: first.invoiceId } })).toMatchObject({ status: 'MAPPED', grossAmount: 123 })
    expect(await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ state: 'OPEN', version: 3 })
  })

  it('returns an existing draft pointer for duplicate history and defensively rejects a corrupt receipt', async () => {
    const original = await createDraft()
    const first = await approveInvoiceDraft(db, 'admin', original.id, approveInput('dupe-pointer-first'))
    const duplicateDraft = await createDraft()
    const duplicate = await approveInvoiceDraft(db, 'admin', duplicateDraft.id, approveInput('dupe-pointer-second'))
    expect(duplicate).toMatchObject({ outcome: 'DUPLICATE', invoiceId: first.invoiceId, existingDraftId: original.id })

    await db.$executeRawUnsafe('DROP TRIGGER "InvoiceDraftAudit_update_guard"')
    try {
      await db.invoiceDraftAudit.update({ where: { actorId_idempotencyKey: {
        actorId: 'admin', idempotencyKey: 'dupe-pointer-second',
      } }, data: { resultJson: '{broken' } })
      await expect(approveInvoiceDraft(db, 'admin', duplicateDraft.id, approveInput('dupe-pointer-second')))
        .rejects.toMatchObject({ code: 'CORRUPT_RECEIPT', status: 500 })
    } finally {
      await db.$executeRawUnsafe(`CREATE TRIGGER "InvoiceDraftAudit_update_guard"
        BEFORE UPDATE ON "InvoiceDraftAudit" BEGIN SELECT RAISE(ABORT, 'InvoiceDraftAudit rows are immutable'); END`)
    }
  })

  it('rejects a syntactically valid APPROVED receipt without a cost event and performs no extra business write', async () => {
    const draft = await createDraft()
    const input = approveInput('semantic-approved-receipt')
    const approved = await approveInvoiceDraft(db, 'admin', draft.id, input)
    const counts = {
      invoices: await db.ksefInvoice.count(), costs: await db.costEvent.count(),
      draftAudits: await db.invoiceDraftAudit.count(), costAudits: await db.costAuditLog.count(),
    }
    await db.$executeRawUnsafe('DROP TRIGGER "InvoiceDraftAudit_update_guard"')
    try {
      await db.invoiceDraftAudit.update({ where: { actorId_idempotencyKey: {
        actorId: 'admin', idempotencyKey: input.idempotencyKey,
      } }, data: { resultJson: JSON.stringify({ ...approved, costEventId: null }) } })
    } finally {
      await db.$executeRawUnsafe(`CREATE TRIGGER "InvoiceDraftAudit_update_guard"
        BEFORE UPDATE ON "InvoiceDraftAudit" BEGIN SELECT RAISE(ABORT, 'InvoiceDraftAudit rows are immutable'); END`)
    }

    await expect(approveInvoiceDraft(db, 'admin', draft.id, input))
      .rejects.toMatchObject({ code: 'CORRUPT_RECEIPT', status: 500 })
    expect({
      invoices: await db.ksefInvoice.count(), costs: await db.costEvent.count(),
      draftAudits: await db.invoiceDraftAudit.count(), costAudits: await db.costAuditLog.count(),
    }).toEqual(counts)
  })

  it('rejects bounded-ID and cost-event violations in valid REVOKED, APPROVED and DUPLICATE receipts', async () => {
    const revokedDraft = await createDraft({ ...validData(), invoiceNumber: 'SEM-REVOKE' })
    await approveInvoiceDraft(db, 'admin', revokedDraft.id, approveInput('semantic-revoke-approve'))
    const revokedInput = approveInput('semantic-revoke-receipt', 2)
    const revoked = await revokeInvoiceDraft(db, 'admin', revokedDraft.id, revokedInput)
    const originalDraft = await createDraft({ ...validData(), invoiceNumber: 'SEM-DUPLICATE' })
    const originalInput = approveInput('semantic-empty-invoice')
    const original = await approveInvoiceDraft(db, 'admin', originalDraft.id, originalInput)
    const duplicateDraft = await createDraft({ ...validData(), invoiceNumber: 'SEM-DUPLICATE' })
    const duplicateInput = approveInput('semantic-duplicate-receipt')
    const duplicate = await approveInvoiceDraft(db, 'admin', duplicateDraft.id, duplicateInput)
    const counts = [await db.ksefInvoice.count(), await db.costEvent.count(), await db.invoiceDraftAudit.count()]
    await db.$executeRawUnsafe('DROP TRIGGER "InvoiceDraftAudit_update_guard"')
    try {
      for (const [key, result] of [
        [revokedInput.idempotencyKey, { ...revoked, costEventId: null }],
        [originalInput.idempotencyKey, { ...original, invoiceId: '' }],
        [duplicateInput.idempotencyKey, { ...duplicate, costEventId: 'unexpected-cost' }],
      ] as const) await db.invoiceDraftAudit.update({ where: { actorId_idempotencyKey: {
        actorId: 'admin', idempotencyKey: key,
      } }, data: { resultJson: JSON.stringify(result) } })
    } finally {
      await db.$executeRawUnsafe(`CREATE TRIGGER "InvoiceDraftAudit_update_guard"
        BEFORE UPDATE ON "InvoiceDraftAudit" BEGIN SELECT RAISE(ABORT, 'InvoiceDraftAudit rows are immutable'); END`)
    }
    for (const [draftId, input, operation] of [
      [revokedDraft.id, revokedInput, revokeInvoiceDraft], [originalDraft.id, originalInput, approveInvoiceDraft],
      [duplicateDraft.id, duplicateInput, approveInvoiceDraft],
    ] as const) await expect(operation(db, 'admin', draftId, input))
      .rejects.toMatchObject({ code: 'CORRUPT_RECEIPT', status: 500 })
    expect([await db.ksefInvoice.count(), await db.costEvent.count(), await db.invoiceDraftAudit.count()]).toEqual(counts)
  })

  it.each([
    '{broken',
    JSON.stringify({ ...validData(), gross: 'not-a-number' }),
    JSON.stringify({ ...validData(), extra: 'not-allowed' }),
  ])('turns corrupt or structurally invalid stored JSON into controlled field issues', async (dataJson) => {
    const draft = await createDraft()
    await db.invoiceImportDraft.update({ where: { id: draft.id }, data: { dataJson } })
    await expect(approveInvoiceDraft(db, 'admin', draft.id, approveInput(`bad-json-${randomUUID()}`)))
      .rejects.toMatchObject({ code: 'APPROVAL_VALIDATION_FAILED', status: 422,
        issues: [expect.objectContaining({ messagePolish: expect.any(String) })] })
    expect(await db.ksefInvoice.count()).toBe(0)
  })
})
