// @vitest-environment node
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { withAiQueueMutation, claimAiJob, finishAiJob } from '@/lib/ai/queue'
import { approveInvoiceDraft, revokeInvoiceDraft } from '@/lib/invoice-import/approval-service'
import { editDraft, requestExtraction } from '@/lib/invoice-import/draft-service'
import { buildKsefReconciliationSnapshot } from '@/lib/invoice-import/ksef-reconciliation-policy'
import type { KsefInvoiceMetadata } from '@/lib/finance/ksef-client'
import {
  reconcileImportedKsefInvoice, getDraftKsefReconciliations,
  resolveDraftKsefReconciliation, assertDraftKsefReconciled,
} from '@/lib/invoice-import/ksef-reconciliation-service'
import { summarizeDraftKsefReconciliations, hashKsefComparisonData } from '@/lib/invoice-import/ksef-reconciliation-state'

const directory = mkdtempSync(join(tmpdir(), 'invoice-ksef-service-'))
const template = join(directory, 'template.db')
let db: PrismaClient
let other: PrismaClient
let databaseUrl: string
const client = () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const NOW = new Date('2026-09-12T12:00:00Z')
const metadata = (patch: Partial<KsefInvoiceMetadata> = {}): KsefInvoiceMetadata => ({
  ksefNumber: 'KSEF-ONE', seller: { nip: 'PL1234567890', name: 'Dostawca Sp. z o.o.' },
  invoiceNumber: 'FV/9/2026', issueDate: '2026-09-10', currency: 'PLN',
  grossAmount: 123, netAmount: 100, vatAmount: 23, ...patch,
})
const data = (patch: Record<string, unknown> = {}) => ({
  ...buildKsefReconciliationSnapshot(metadata(), null).data,
  paymentStatus: 'UNPAID', costCenterId: 'JAG', tagIds: ['tag-fixed'], notes: 'Ręczna adnotacja', ...patch,
})
const PAID_XML = '<Faktura><Fa><Platnosc><Zaplacono>1</Zaplacono><DataZaplaty>2026-09-11</DataZaplaty></Platnosc></Fa></Faktura>'

async function createDraft(patch: Record<string, unknown> = {}) {
  const batch = await db.invoiceImportBatch.create({ data: { ownerUserId: 'admin' } })
  const attachment = await db.invoiceAttachment.create({ data: {
    storageKey: `${randomUUID()}.bin`, sha256: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    originalName: 'oryginal.pdf', mimeType: 'application/pdf', byteSize: 100, pageCount: 1,
    state: 'READY', createdById: 'admin',
  } })
  return db.invoiceImportDraft.create({ data: {
    batchId: batch.id, attachmentId: attachment.id, dataJson: JSON.stringify(data(patch)),
    manualFieldsJson: '["notes","gross","costCenterId","tagIds"]',
  } })
}
const observe = (incoming = metadata(), xml: string | null = null, actor = 'admin', database = db) =>
  withAiQueueMutation(database, () => NOW, (tx, _lease, now) => reconcileImportedKsefInvoice(tx, actor, incoming, xml, now))
const detail = (draftId: string) => getDraftKsefReconciliations(db, 'admin', draftId)
async function request(draftId: string, action: 'KEEP_LOCAL' | 'APPLY_TO_DRAFT' = 'KEEP_LOCAL') {
  const current = await detail(draftId)
  return { reconciliationId: current.links[0].id, expectedDraftVersion: current.draftVersion,
    expectedLinkVersion: current.links[0].version, action, idempotencyKey: randomUUID() }
}
async function money() {
  return {
    invoices: await db.ksefInvoice.findMany({ include: { parts: { include: { tags: true, allocations: true } } } }),
    costs: await db.costEvent.findMany({ include: { parts: { include: { tags: true, allocations: true } } } }),
    rules: await db.ksefSupplierRule.findMany(), periods: await db.financePeriodClose.findMany(),
    originals: await db.invoiceAttachment.findMany(),
  }
}
async function assertReady(draftId: string) {
  return db.$transaction(async (tx) => assertDraftKsefReconciled(tx,
    await tx.invoiceImportDraft.findUniqueOrThrow({ where: { id: draftId } })))
}
beforeAll(async () => {
  execFileSync('/usr/bin/sqlite3', [template, 'VACUUM;'])
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${template}`, RUST_LOG: 'debug' }, stdio: 'pipe', timeout: 60_000,
  })
  const seed = new PrismaClient({ datasources: { db: { url: `file:${template}` } } })
  try {
    await seed.user.createMany({ data: [
      { id: 'admin', role: 'ADMIN', name: 'Admin', email: 'admin@example.test', passwordHash: 'test' },
      { id: 'manager', role: 'MANAGER', name: 'Manager', email: 'manager@example.test', passwordHash: 'test' },
      { id: 'disabled', role: 'ADMIN', isActive: false, name: 'Disabled', email: 'disabled@example.test', passwordHash: 'test' },
      { id: 'password', role: 'ADMIN', mustChangePassword: true, name: 'Password', email: 'password@example.test', passwordHash: 'test' },
    ] })
    for (const id of ['JAG', 'PUL', 'GLOBAL']) await seed.costCenter.create({ data: { id, name: id } })
    await seed.costTagGroup.create({ data: { id: 'behavior', slug: 'behavior', name: 'Charakter' } })
    await seed.costTag.create({ data: { id: 'tag-fixed', groupId: 'behavior', slug: 'fixed', name: 'Stały' } })
  } finally { await seed.$disconnect() }
})
beforeEach(async () => {
  await db?.$disconnect()
  await other?.$disconnect()
  const databasePath = join(directory, `${randomUUID()}.db`)
  cpSync(template, databasePath)
  databaseUrl = `file:${databasePath}`
  db = client()
  other = client()
  await db.$queryRawUnsafe('PRAGMA journal_mode=WAL')
})
afterAll(async () => {
  await db?.$disconnect()
  await other?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('KSeF observations preserve imported financial history', () => {
  it.each(['matched', 'amount', 'payment'])('links %s observation after real approval without changing money, source, original or manual fields', async (mode) => {
    const draft = await createDraft()
    await approveInvoiceDraft(db, 'admin', draft.id, { expectedVersion: 1, idempotencyKey: 'approve-original' })
    const beforeMoney = await money()
    const beforeDraft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })
    const result = await observe(metadata(mode === 'amount' ? { grossAmount: 124 } : {}), mode === 'payment' ? PAID_XML : null)
    expect(result).toMatchObject({ outcome: 'LINKED', draftId: draft.id, status: mode === 'matched' ? 'MATCHED' : 'CONFLICT', changed: true })
    expect(await money()).toEqual(beforeMoney)
    expect(await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .toMatchObject({ ...beforeDraft, version: beforeDraft.version + 1, updatedAt: expect.any(Date) })
    const link = (await detail(draft.id)).links[0]
    expect(link).not.toHaveProperty('xmlContent')
    expect(link).not.toHaveProperty('snapshotHash')
    expect(link.approvalBlocked).toBe(mode !== 'matched')
    const audit = await db.invoiceDraftAudit.findFirstOrThrow({ where: { action: 'KSEF_OBSERVED' } })
    expect(audit).toMatchObject({ actorId: 'admin' })
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ draft: { id: draft.id, data: { gross: 123 } }, link: { snapshot: { externalId: 'KSEF-ONE' } } })
    expect(audit.afterJson).not.toContain('<Faktura>')
    if (mode === 'matched') await expect(assertReady(draft.id)).resolves.toBeUndefined()
    else await expect(assertReady(draft.id)).rejects.toMatchObject({ code: 'KSEF_CONFLICT', status: 409 })
  })

  it('same validated snapshot is a no-op after restart and missing XML reuses cached payment', async () => {
    const draft = await createDraft()
    await observe(metadata(), PAID_XML)
    const before = { link: await db.invoiceKsefReconciliation.findFirst(), draft: await db.invoiceImportDraft.findFirst(), audits: await db.invoiceDraftAudit.findMany() }
    await db.$disconnect()
    db = client()
    expect(await observe(metadata({ ksefNumber: ' KSEF-ONE ' }))).toMatchObject({ changed: false, status: 'CONFLICT' })
    expect({ link: await db.invoiceKsefReconciliation.findFirst(), draft: await db.invoiceImportDraft.findFirst(), audits: await db.invoiceDraftAudit.findMany() }).toEqual(before)
    expect((await detail(draft.id)).links[0].snapshot.data.paymentStatus).toBe('PAID')
  })

  it.each(['details', 'approval guard'])('reads %s reconciliation state without fetching cached XML', async (path) => {
    const draft = await createDraft()
    await observe(metadata(), '<Faktura/>')
    const observed = new PrismaClient({
      datasources: { db: { url: databaseUrl } }, log: [{ emit: 'event', level: 'query' }],
    })
    const queries: string[] = []
    observed.$on('query', (event) => { queries.push(event.query) })
    try {
      if (path === 'details') {
        expect((await getDraftKsefReconciliations(observed, 'admin', draft.id)).links[0].status).toBe('MATCHED')
      } else {
        await withAiQueueMutation(observed, () => NOW, async (tx) => {
          await assertDraftKsefReconciled(tx, draft)
        })
      }
      const stateQueries = queries.filter((query) => query.includes('InvoiceKsefReconciliation'))
      expect(stateQueries.length).toBeGreaterThan(0)
      for (const query of stateQueries) {
        expect(query).toContain('snapshotHash')
        expect(query).toContain('snapshotJson')
        expect(query).not.toContain('xmlContent')
      }
    } finally { await observed.$disconnect() }
  })

  it('binds OPEN without creating expense, excludes unbound archived drafts and returns NOT_MATCHED without domain writes', async () => {
    const archived = await createDraft()
    await db.invoiceImportDraft.update({ where: { id: archived.id }, data: { state: 'ARCHIVED' } })
    expect(await observe()).toEqual({ outcome: 'NOT_MATCHED' })
    expect(await db.invoiceDraftAudit.count()).toBe(0)
    const open = await createDraft()
    expect(await observe()).toMatchObject({ outcome: 'LINKED', draftId: open.id })
    expect(await db.ksefInvoice.count()).toBe(0)
    expect(await db.costEvent.count()).toBe(0)
  })

  it('uses permanent imported invoice identity after revoke and date edits, ahead of extra OPEN duplicates', async () => {
    const original = await createDraft()
    const approved = await approveInvoiceDraft(db, 'admin', original.id, { expectedVersion: 1, idempotencyKey: 'approve-original' })
    await revokeInvoiceDraft(db, 'admin', original.id, { expectedVersion: approved.version, idempotencyKey: 'revoke-original' })
    await editDraft(db, 'admin', original.id, 3, { issueDate: '2026-09-11', invoiceNumber: 'EDITED/1' })
    await createDraft()
    expect(await observe()).toMatchObject({ draftId: original.id, status: 'CONFLICT' })
    await db.invoiceImportDraft.update({ where: { id: original.id }, data: { state: 'ARCHIVED' } })
    expect(await observe(metadata({ ksefNumber: 'KSEF-TWO' }))).toMatchObject({ draftId: original.id })
    expect(await observe(metadata({ invoiceNumber: 'OTHER', issueDate: '2026-09-12' }))).toMatchObject({ draftId: original.id, changed: true })
  })

  it('fails ambiguous identity closed with zero links/audits/draft changes', async () => {
    await createDraft()
    await createDraft()
    const before = await db.invoiceImportDraft.findMany()
    await expect(observe(metadata({ grossAmount: 999 }))).rejects.toMatchObject({ code: 'KSEF_AMBIGUOUS_MATCH', status: 409 })
    expect(await db.invoiceKsefReconciliation.count()).toBe(0)
    expect(await db.invoiceDraftAudit.count()).toBe(0)
    expect(await db.invoiceImportDraft.findMany()).toEqual(before)
  })

  it('keeps foreign tax identifiers distinct and falls back to name only when a tax ID is absent', async () => {
    await createDraft({ taxId: 'FR123ABC' })
    const german = await createDraft({ taxId: 'DE123ABC' })
    expect(await observe(metadata({ seller: { nip: 'DE 123-ABC', name: 'Dostawca Sp. z o.o.' } }))).toMatchObject({ draftId: german.id })
    const noTax = await createDraft({ taxId: null, invoiceNumber: 'NO-TAX' })
    expect(await observe(metadata({ ksefNumber: 'KSEF-NO-TAX', invoiceNumber: 'no-tax', seller: { nip: '', name: ' DOSTAWCA Sp. z o.o. ' } })))
      .toMatchObject({ draftId: noTax.id })
  })

  it('serializes two clients observing the same external document into one binding and audit', async () => {
    const draft = await createDraft()
    const results = await Promise.all([observe(), observe(metadata(), null, 'admin', other)])
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ changed: true }), expect.objectContaining({ changed: false })]))
    expect(await db.invoiceKsefReconciliation.count()).toBe(1)
    expect(await db.invoiceDraftAudit.count()).toBe(1)
    expect((await detail(draft.id)).draftVersion).toBe(2)
  })

  it('several unresolved links all contribute to the current approval block and undefined local values are explicit nulls', async () => {
    const draft = await createDraft({ gross: undefined })
    await observe()
    await observe(metadata({ ksefNumber: 'KSEF-TWO', grossAmount: 124 }))
    const current = await detail(draft.id)
    expect(current.links).toHaveLength(2)
    expect(current.links[0].differences).toContainEqual({ field: 'gross', localValue: null, ksefValue: 123 })
    await resolveDraftKsefReconciliation(db, 'admin', draft.id, await request(draft.id))
    expect((await detail(draft.id)).links.map((link) => link.approvalBlocked)).toEqual([false, true])
    await expect(assertReady(draft.id)).rejects.toMatchObject({ code: 'KSEF_CONFLICT' })
  })

  it.each(['missing', 'manager', 'disabled', 'password'])('reauthorizes current %s actor even on NOT_MATCHED, read or malformed resolution', async (actor) => {
    await expect(observe(metadata(), null, actor)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    const draft = await createDraft()
    await expect(getDraftKsefReconciliations(db, actor, draft.id)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    await expect(resolveDraftKsefReconciliation(db, actor, draft.id, {})).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })

  it('reads 404 and reflects a fresh role downgrade', async () => {
    await expect(detail('missing')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    const draft = await createDraft()
    await detail(draft.id)
    await other.user.update({ where: { id: 'admin' }, data: { role: 'MANAGER' } })
    await expect(detail(draft.id)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })
})

describe('explicit KSeF decisions and current state', () => {
  it('KEEP on APPROVED preserves money and current data, survives replay and is reset by changed observation', async () => {
    const draft = await createDraft()
    await approveInvoiceDraft(db, 'admin', draft.id, { expectedVersion: 1, idempotencyKey: 'approve-original' })
    await observe(metadata({ grossAmount: 124 }))
    const before = await money()
    const beforeDraft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })
    const input = await request(draft.id)
    const result = await resolveDraftKsefReconciliation(db, 'admin', draft.id, input)
    expect(result).toMatchObject({ draftId: draft.id, version: 4, reconciliationVersion: 2, outcome: 'KEPT_LOCAL' })
    expect(await money()).toEqual(before)
    expect(await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .toMatchObject({ ...beforeDraft, version: 4, updatedAt: expect.any(Date) })
    await expect(assertReady(draft.id)).resolves.toBeUndefined()
    expect(await observe(metadata({ grossAmount: 124 }))).toMatchObject({ changed: false, status: 'KEPT_LOCAL' })
    await observe(metadata({ grossAmount: 125 }))
    expect((await detail(draft.id)).links[0]).toMatchObject({ status: 'CONFLICT', approvalBlocked: true })
    expect((await db.invoiceKsefReconciliation.findFirst())?.resolvedDataHash).toBeNull()
    expect(await resolveDraftKsefReconciliation(other, 'admin', draft.id, input)).toEqual(result)
    await other.user.update({ where: { id: 'admin' }, data: { isActive: false } })
    await expect(resolveDraftKsefReconciliation(db, 'admin', draft.id, input)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('comparison edits reopen KEEP, whereas classification, note, conversion and reporting edits do not', async () => {
    const draft = await createDraft()
    await observe(metadata({ grossAmount: 124 }))
    const keep = await resolveDraftKsefReconciliation(db, 'admin', draft.id, await request(draft.id))
    const edited = await editDraft(db, 'admin', draft.id, keep.version, { notes: 'Changed', costCenterId: 'PUL', tagIds: [], reportingGross: 450, reportingNet: 400, reportingVat: 50, conversionNote: 'Confirmed elsewhere' })
    expect((await detail(draft.id)).links[0].status).toBe('KEPT_LOCAL')
    const links = await db.invoiceKsefReconciliation.findMany()
    expect(summarizeDraftKsefReconciliations(JSON.stringify(edited.data), links)).toEqual({ linkedCount: 1, conflictCount: 0 })
    const changed = await editDraft(db, 'admin', draft.id, edited.version, { gross: 122 })
    expect((await detail(draft.id)).links[0].status).toBe('CONFLICT')
    expect(summarizeDraftKsefReconciliations(JSON.stringify(changed.data), links)).toEqual({ linkedCount: 1, conflictCount: 1 })
    expect(await observe(metadata({ grossAmount: 124 }))).toMatchObject({ changed: false, status: 'CONFLICT' })
    await editDraft(db, 'admin', draft.id, changed.version, { gross: 124 })
    expect((await detail(draft.id)).links[0].status).toBe('MATCHED')
  })

  it('hashes only comparison fields, treating omitted and null values equally', () => {
    expect(hashKsefComparisonData({ gross: 123 })).toBe(hashKsefComparisonData({ gross: 123, net: null, notes: 'x', conversionConfirmed: true, reportingGross: 999 }))
    for (const [field, value] of Object.entries(buildKsefReconciliationSnapshot(metadata(), PAID_XML).data)) {
      if (value !== null) expect(hashKsefComparisonData({})).not.toBe(hashKsefComparisonData({ [field]: value }))
    }
  })

  it('rejects APPLY while APPROVED; revoke then APPLY preserves binding and protects applied fields', async () => {
    const draft = await createDraft({ currency: 'EUR', gross: 123, reportingGross: 500, conversionConfirmed: true, conversionNote: 'kurs' })
    const approved = await approveInvoiceDraft(db, 'admin', draft.id, { expectedVersion: 1, idempotencyKey: 'approve-original' })
    await observe(metadata({ currency: 'EUR', grossAmount: 125 }), PAID_XML)
    await expect(resolveDraftKsefReconciliation(db, 'admin', draft.id, await request(draft.id, 'APPLY_TO_DRAFT')))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
    await revokeInvoiceDraft(db, 'admin', draft.id, { expectedVersion: 3, idempotencyKey: 'revoke-original' })
    const beforeMoney = await money()
    await db.invoiceImportDraft.update({ where: { id: draft.id }, data: { skippedAt: NOW } })
    const result = await resolveDraftKsefReconciliation(db, 'admin', draft.id, await request(draft.id, 'APPLY_TO_DRAFT'))
    expect(result.outcome).toBe('APPLIED_TO_DRAFT')
    expect(await money()).toEqual(beforeMoney)
    const stored = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })
    expect(stored).toMatchObject({ state: 'OPEN', invoiceId: approved.invoiceId, skippedAt: null, latestAiJobId: null })
    expect(JSON.parse(stored.dataJson)).toMatchObject({ gross: 125, reportingGross: 500, conversionConfirmed: false,
      notes: 'Ręczna adnotacja', costCenterId: 'JAG', tagIds: ['tag-fixed'], paymentStatus: 'PAID', paidAt: '2026-09-11' })
    expect(JSON.parse(stored.manualFieldsJson)).toEqual(expect.arrayContaining(['gross', 'paymentStatus', 'paidAt', 'notes', 'costCenterId', 'tagIds', 'conversionConfirmed']))
    expect((await detail(draft.id)).links[0]).toMatchObject({ status: 'APPLIED_TO_DRAFT', approvalBlocked: false })
  })

  it.each(['KEEP_LOCAL', 'APPLY_TO_DRAFT'] as const)('rejects %s for archived draft or another draft link', async (action) => {
    const draft = await createDraft()
    await observe(metadata({ grossAmount: 124 }))
    const input = await request(draft.id, action)
    const another = await createDraft({ invoiceNumber: 'other' })
    await expect(resolveDraftKsefReconciliation(db, 'admin', another.id, input)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await db.invoiceImportDraft.update({ where: { id: draft.id }, data: { state: 'ARCHIVED' } })
    await expect(resolveDraftKsefReconciliation(db, 'admin', draft.id, input)).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  })

  it.each(['CANCELLED', 'CORRECTION', 'CORRECTED'])('never clears %s approval block with KEEP or APPLY', async (documentStatus) => {
    const draft = await createDraft()
    await observe(metadata({ documentStatus }))
    await resolveDraftKsefReconciliation(db, 'admin', draft.id, await request(draft.id))
    expect((await detail(draft.id)).links[0]).toMatchObject({ status: 'CONFLICT', approvalBlocked: true })
    await expect(assertReady(draft.id)).rejects.toMatchObject({ code: 'KSEF_CONFLICT' })
    await resolveDraftKsefReconciliation(db, 'admin', draft.id, await request(draft.id, 'APPLY_TO_DRAFT'))
    expect((await detail(draft.id)).links[0]).toMatchObject({ status: 'CONFLICT', approvalBlocked: true })
  })

  it.each([{}, { expectedDraftVersion: 0 }, { expectedLinkVersion: 0 }, { idempotencyKey: 'short' }, { unexpected: true }, { action: 'GUESS' }])('strictly rejects malformed decision %#', async (patch) => {
    const draft = await createDraft()
    await observe()
    const input = Object.keys(patch).length ? { ...await request(draft.id), ...patch } : {}
    await expect(resolveDraftKsefReconciliation(db, 'admin', draft.id, input)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 422 })
    expect(await db.invoiceDraftAudit.count()).toBe(1)
  })

  it.each(['expectedDraftVersion', 'expectedLinkVersion'] as const)('checks optimistic %s', async (field) => {
    const draft = await createDraft()
    await observe()
    const input = await request(draft.id)
    await expect(resolveDraftKsefReconciliation(db, 'admin', draft.id, { ...input, [field]: input[field] + 1 }))
      .rejects.toMatchObject({ code: 'STALE_VERSION', status: 409 })
  })

  it('same actor/key replays exact result across clients; a changed payload or global action conflicts', async () => {
    const draft = await createDraft()
    await observe(metadata({ grossAmount: 124 }))
    const input = await request(draft.id)
    const results = await Promise.all([resolveDraftKsefReconciliation(db, 'admin', draft.id, input), resolveDraftKsefReconciliation(other, 'admin', draft.id, input)])
    expect(results[0]).toEqual(results[1])
    expect(await db.invoiceDraftAudit.count({ where: { action: 'KSEF_KEPT_LOCAL' } })).toBe(1)
    await expect(resolveDraftKsefReconciliation(db, 'admin', draft.id, { ...input, action: 'APPLY_TO_DRAFT' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    await db.invoiceDraftAudit.create({ data: { draftId: draft.id, actorId: 'admin', action: 'APPROVED', idempotencyKey: 'used-approval-key', requestHash: 'a'.repeat(64) } })
    await expect(resolveDraftKsefReconciliation(db, 'admin', draft.id, { ...input, idempotencyKey: 'used-approval-key' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
  })

  it('two distinct concurrent decisions allow one winner and reject the stale second', async () => {
    const draft = await createDraft()
    await observe(metadata({ grossAmount: 124 }))
    const input = await request(draft.id)
    const results = await Promise.allSettled([resolveDraftKsefReconciliation(db, 'admin', draft.id, input), resolveDraftKsefReconciliation(other, 'admin', draft.id, { ...input, idempotencyKey: randomUUID() })])
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((item) => item.status === 'rejected')).toMatchObject({ reason: { code: 'STALE_VERSION' } })
  })

  it.each(['QUEUED', 'RUNNING'])('APPLY fences %s AI work from overwriting adopted KSeF values', async (status) => {
    const draft = await createDraft()
    const queued = await requestExtraction(db, 'admin', draft.id, 1)
    const claim = status === 'RUNNING' ? await claimAiJob(db, 'worker') : null
    const jobBeforeObservation = await db.aiJob.findUniqueOrThrow({ where: { id: queued.latestJob!.id } })
    await observe(metadata({ grossAmount: 124 }))
    expect(await db.aiJob.findUniqueOrThrow({ where: { id: queued.latestJob!.id } })).toEqual(jobBeforeObservation)
    expect(await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ latestAiJobId: queued.latestJob!.id })
    await resolveDraftKsefReconciliation(db, 'admin', draft.id, await request(draft.id, 'APPLY_TO_DRAFT'))
    const adopted = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })
    expect(adopted.latestAiJobId).toBeNull()
    if (claim) {
      await finishAiJob(db, 'worker', claim.id, claim.leaseToken, { status: 'SUCCEEDED', result: {
        documentType: 'INVOICE', supplierName: 'Old AI', taxId: null, invoiceNumber: 'OLD', issueDate: '2026-09-10',
        dueDate: null, currency: 'PLN', gross: 999, net: null, vat: null, bankAccount: null, paymentStatus: 'UNKNOWN', warnings: [],
      } })
      expect(await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })).toEqual(adopted)
      expect(await db.aiJob.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ status: 'SUCCEEDED' })
      expect(await db.invoiceDraftAudit.findFirst({ where: { draftId: draft.id, action: 'AI_RESULT_STALE_SKIPPED', aiJobId: claim.id } })).not.toBeNull()
    } else {
      expect(await db.aiJob.findUnique({ where: { id: queued.latestJob!.id } })).toMatchObject({ status: 'CANCELLED' })
    }
  })
})

describe('reconciliation corruption and transaction rollback', () => {
  it.each(['observe-new', 'observe-change', 'KEEP_LOCAL', 'APPLY_TO_DRAFT'])('rolls back all effects after final audit failure for %s', async (mode) => {
    const draft = await createDraft()
    if (mode === 'APPLY_TO_DRAFT') await requestExtraction(db, 'admin', draft.id, 1)
    if (mode !== 'observe-new') await observe(metadata({ grossAmount: 124 }))
    const input = mode === 'KEEP_LOCAL' || mode === 'APPLY_TO_DRAFT' ? await request(draft.id, mode) : null
    const before = { links: await db.invoiceKsefReconciliation.findMany(), drafts: await db.invoiceImportDraft.findMany(), audits: await db.invoiceDraftAudit.findMany(), jobs: await db.aiJob.findMany(), money: await money() }
    await db.$executeRawUnsafe(`CREATE TRIGGER test_reconciliation_audit_failure BEFORE INSERT ON InvoiceDraftAudit BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`)
    await expect(input ? resolveDraftKsefReconciliation(db, 'admin', draft.id, input) : observe(metadata({ grossAmount: 125 }))).rejects.toThrow()
    expect({ links: await db.invoiceKsefReconciliation.findMany(), drafts: await db.invoiceImportDraft.findMany(), audits: await db.invoiceDraftAudit.findMany(), jobs: await db.aiJob.findMany(), money: await money() }).toEqual(before)
  })

  it.each(['hash', 'identity', 'schema', 'json'])('rejects stored snapshot %s corruption during read, observe and resolve', async (mode) => {
    const draft = await createDraft()
    await observe()
    const input = await request(draft.id)
    const snapshot = buildKsefReconciliationSnapshot(metadata(mode === 'identity' ? { ksefNumber: 'WRONG' } : {}), null)
    const snapshotJson = mode === 'json' ? '{' : JSON.stringify(mode === 'schema' ? { ...snapshot, extra: true } : snapshot)
    const hash = mode === 'hash' ? '0'.repeat(64) : createHash('sha256').update(snapshotJson).digest('hex')
    await db.invoiceKsefReconciliation.update({ where: { id: input.reconciliationId }, data: { snapshotJson, snapshotHash: hash } })
    await expect(detail(draft.id)).rejects.toMatchObject({ code: 'CORRUPT_DATA', status: 500 })
    await expect(observe()).rejects.toMatchObject({ code: 'CORRUPT_DATA', status: 500 })
    await expect(resolveDraftKsefReconciliation(db, 'admin', draft.id, input)).rejects.toMatchObject({ code: 'CORRUPT_DATA', status: 500 })
  })

  it.each(['schema', 'draft', 'link', 'outcome', 'draftVersion', 'linkVersion'])('fails corrupt idempotency receipt %s without performing another decision', async (mode) => {
    const draft = await createDraft()
    await observe()
    const input = await request(draft.id)
    const result = await resolveDraftKsefReconciliation(db, 'admin', draft.id, input)
    await db.$executeRawUnsafe('DROP TRIGGER InvoiceDraftAudit_update_guard')
    const corrupt = mode === 'schema' ? {} : { ...result,
      ...(mode === 'draft' ? { draftId: 'another' } : {}),
      ...(mode === 'link' ? { reconciliationId: 'another' } : {}),
      ...(mode === 'outcome' ? { outcome: 'APPLIED_TO_DRAFT' } : {}),
      ...(mode === 'draftVersion' ? { version: result.version + 1 } : {}),
      ...(mode === 'linkVersion' ? { reconciliationVersion: result.reconciliationVersion + 1 } : {}),
    }
    await db.invoiceDraftAudit.updateMany({ where: { idempotencyKey: input.idempotencyKey }, data: { resultJson: JSON.stringify(corrupt) } })
    await expect(resolveDraftKsefReconciliation(db, 'admin', draft.id, input)).rejects.toMatchObject({ code: 'CORRUPT_RECEIPT', status: 500 })
    expect(await db.invoiceDraftAudit.count({ where: { action: 'KSEF_KEPT_LOCAL' } })).toBe(1)
  })
})
