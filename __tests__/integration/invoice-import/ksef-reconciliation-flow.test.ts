// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { POST as SYNC } from '@/app/api/finance/ksef/sync/route'
import type { KsefInvoiceMetadata } from '@/lib/finance/ksef-client'
import { approveInvoiceDraft, revokeInvoiceDraft } from '@/lib/invoice-import/approval-service'
import { createBatch, editDraft } from '@/lib/invoice-import/draft-service'
import { getInvoiceOriginal, uploadInvoiceDocument } from '@/lib/invoice-import/file-service'
import { PrivateInvoiceAttachmentStore } from '@/lib/invoice-import/private-store'
import { getDraftKsefReconciliations, resolveDraftKsefReconciliation } from '@/lib/invoice-import/ksef-reconciliation-service'

// Only replace the application singleton/session boundary and external KSeF
// network. Queue reservations, domain writes, XML parsing and storage are real.
const state = vi.hoisted(() => ({ db: null as unknown as PrismaClient }))
const network = vi.hoisted(() => ({
  authenticateWithToken: vi.fn(), queryPurchaseInvoiceMetadata: vi.fn(), downloadInvoiceXml: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.db } }))
vi.mock('@/lib/finance/finance-access', () => ({
  requireFinanceAdmin: vi.fn(async () => ({ session: { user: { id: 'admin', role: 'ADMIN' } } })),
}))
vi.mock('@/lib/finance/ksef-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/finance/ksef-client')>(),
  KsefApiClient: vi.fn(function KsefApiClient() { return network }),
}))

const directory = mkdtempSync(join(tmpdir(), 'invoice-ksef-flow-'))
const template = join(directory, 'template.db')
let other: PrismaClient
let store: PrivateInvoiceAttachmentStore
let documentSequence = 0
const environment = () => ({ store, processor: {
  pdfInfoBinary: '/unused-for-image/pdfinfo', pdfToPpmBinary: '/unused-for-image/pdftoppm', workRoot: directory,
} })
const metadata = (patch: Partial<KsefInvoiceMetadata> = {}): KsefInvoiceMetadata => ({
  ksefNumber: 'KSEF-FLOW-ONE', seller: { nip: 'PL1234567890', name: 'Dostawca Sp. z o.o.' },
  invoiceNumber: 'FV/9/2026', issueDate: '2026-09-10', currency: 'PLN',
  grossAmount: 123, netAmount: 100, vatAmount: 23, ...patch,
})
const doubled = () => metadata({ grossAmount: 246, netAmount: 200, vatAmount: 46 })
const PAID_XML = '<Faktura><Fa><Platnosc><Zaplacono>1</Zaplacono><DataZaplaty>2026-09-11</DataZaplaty></Platnosc></Fa></Faktura>'
const data = (patch: Record<string, unknown> = {}) => ({
  documentType: 'INVOICE', supplierName: 'Dostawca Sp. z o.o.', taxId: 'PL1234567890',
  invoiceNumber: 'FV/9/2026', issueDate: '2026-09-10', currency: 'PLN',
  gross: 123, net: 100, vat: 23, paymentStatus: 'UNPAID', costCenterId: 'JAG',
  tagIds: ['tag-fixed'], notes: 'Ręczna adnotacja zachowana po synchronizacji', ...patch,
})
const currentDraft = (id: string) => state.db.invoiceImportDraft.findUniqueOrThrow({ where: { id } })
const detail = (id: string) => getDraftKsefReconciliations(state.db, 'admin', id)
const mutation = (expectedVersion: number, confirmedPeriodIds: string[] = []) => ({
  expectedVersion, idempotencyKey: randomUUID(), confirmedPeriodIds,
})
async function uploadDraft(patch: Record<string, unknown> = {}) {
  documentSequence += 1
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3,
    background: { r: documentSequence % 256, g: 50, b: 150 },
  } }).png().toBuffer()
  const batch = await createBatch(state.db, 'admin')
  const uploaded = await uploadInvoiceDocument(state.db, 'admin', {
    batchId: batch.id, originalName: `faktura-${documentSequence}.png`, bytes,
  }, environment())
  expect(uploaded.deduplicated).toBe(false)
  const draft = await editDraft(state.db, 'admin', uploaded.draft.id, uploaded.draft.version, data(patch))
  return { draft, bytes }
}
function incoming(value = metadata(), xml = '<Faktura />') {
  network.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [value] })
  network.downloadInvoiceXml.mockResolvedValue(xml)
}
async function sync(value = metadata(), xml = '<Faktura />') {
  incoming(value, xml)
  const response = await SYNC()
  return { status: response.status, body: await response.json() }
}
async function resolution(id: string, action: 'KEEP_LOCAL' | 'APPLY_TO_DRAFT' = 'KEEP_LOCAL') {
  const current = await detail(id)
  return { reconciliationId: current.links[0].id, expectedDraftVersion: current.draftVersion,
    expectedLinkVersion: current.links[0].version, action, idempotencyKey: randomUUID() }
}
async function money() {
  return {
    invoices: await state.db.ksefInvoice.findMany({ orderBy: { id: 'asc' }, include: {
      parts: { orderBy: { id: 'asc' }, include: { tags: true, allocations: true } },
    } }),
    costs: await state.db.costEvent.findMany({ orderBy: { id: 'asc' }, include: {
      parts: { orderBy: { id: 'asc' }, include: { tags: true, allocations: true } },
    } }),
    financeAudits: await state.db.costAuditLog.findMany({ orderBy: { id: 'asc' } }),
    periods: await state.db.financePeriodClose.findMany(),
    rules: await state.db.ksefSupplierRule.findMany({ include: { tags: true } }),
    originals: await state.db.invoiceAttachment.findMany(),
  }
}
async function fullSnapshot() {
  return { ...await money(), drafts: await state.db.invoiceImportDraft.findMany(),
    links: await state.db.invoiceKsefReconciliation.findMany(),
    draftAudits: await state.db.invoiceDraftAudit.findMany({ orderBy: { id: 'asc' } }),
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeAll(async () => {
  execFileSync('/usr/bin/sqlite3', [template, 'VACUUM;'])
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${template}`, RUST_LOG: 'debug' }, stdio: 'pipe', timeout: 60_000,
  })
  const seed = new PrismaClient({ datasources: { db: { url: `file:${template}` } } })
  try {
    await seed.user.create({ data: {
      id: 'admin', role: 'ADMIN', name: 'Admin', email: 'admin@flow.test', passwordHash: 'test',
    } })
    for (const id of ['JAG', 'PUL', 'GLOBAL']) await seed.costCenter.create({ data: { id, name: id } })
    await seed.costTagGroup.create({ data: { id: 'behavior', slug: 'behavior', name: 'Charakter' } })
    await seed.costTag.create({ data: { id: 'tag-fixed', groupId: 'behavior', slug: 'fixed', name: 'Stały' } })
    await seed.appSetting.createMany({ data: [
      { key: 'ksef_enabled', value: 'true' }, { key: 'ksef_environment', value: 'test' },
      { key: 'ksef_token', value: 'test-only-token' }, { key: 'ksef_company_nip', value: '5210000000' },
      { key: 'ksef_sync_from', value: new Date().toISOString().slice(0, 10) },
    ] })
  } finally { await seed.$disconnect() }
}, 60_000)
beforeEach(async () => {
  await state.db?.$disconnect()
  await other?.$disconnect()
  const databasePath = join(directory, `${randomUUID()}.db`)
  cpSync(template, databasePath)
  const options = { datasources: { db: { url: `file:${databasePath}` } } }
  state.db = new PrismaClient(options)
  other = new PrismaClient(options)
  await state.db.$queryRawUnsafe('PRAGMA journal_mode=WAL')
  store = new PrivateInvoiceAttachmentStore(join(directory, randomUUID()))
  vi.clearAllMocks()
  network.authenticateWithToken.mockResolvedValue({ accessToken: { token: 'test-only-access-token' } })
  incoming()
})
afterAll(async () => {
  await state.db?.$disconnect()
  await other?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('real KSeF sync, original file and approval flow', () => {
  it('rejects unresolved OPEN KSeF conflict before any invoice or expense write', async () => {
    const { draft } = await uploadDraft()
    expect(await sync(doubled())).toMatchObject({ status: 200, body: { linked: 1, conflicts: 1, imported: 0, updated: 0 } })
    const observed = await currentDraft(draft.id)
    const before = await fullSnapshot()

    await expect(approveInvoiceDraft(state.db, 'admin', draft.id, mutation(observed.version)))
      .rejects.toMatchObject({ code: 'KSEF_CONFLICT', status: 409 })

    expect(await fullSnapshot()).toEqual(before)
    expect(await state.db.ksefInvoice.count()).toBe(0)
    expect(await state.db.costEvent.count()).toBe(0)
  })

  it.each(['matched', 'amount', 'payment'] as const)(
    'links %s to an approved file without changing invoice, cost, classification or original bytes',
    async (mode) => {
      const { draft, bytes } = await uploadDraft()
      const approved = await approveInvoiceDraft(state.db, 'admin', draft.id, mutation(draft.version))
      await state.db.ksefSupplierRule.create({ data: {
        supplierNamePattern: 'Dostawca', costCenterId: 'PUL',
        tags: { create: { tagId: 'tag-fixed' } },
      } })
      const before = await money()
      const beforeDraft = await currentDraft(draft.id)

      expect(await sync(mode === 'amount' ? doubled() : metadata(), mode === 'payment' ? PAID_XML : '<Faktura />'))
        .toMatchObject({ status: 200, body: {
          linked: 1, conflicts: mode === 'matched' ? 0 : 1, imported: 0, updated: 0, mappedByRules: 0,
        } })

      expect(await money()).toEqual(before)
      expect(await currentDraft(draft.id)).toMatchObject({ ...beforeDraft,
        version: beforeDraft.version + 1, updatedAt: expect.any(Date),
      })
      expect(await state.db.ksefInvoice.findMany()).toMatchObject([{
        id: approved.invoiceId, source: 'MANUAL', grossAmount: 123, costCenterId: 'JAG',
      }])
      expect(await state.db.costEvent.findMany()).toMatchObject([{
        id: approved.costEventId, sourceInvoiceId: approved.invoiceId, source: 'MANUAL', grossAmount: 123,
      }])
      expect((await getInvoiceOriginal(state.db, 'admin', draft.id, environment())).bytes).toEqual(bytes)
      const audit = await state.db.invoiceDraftAudit.findFirstOrThrow({ where: { action: 'KSEF_OBSERVED' } })
      expect(audit.actorId).toBe('admin')
      expect(JSON.parse(audit.afterJson!)).toMatchObject({
        draft: { id: draft.id, invoiceId: approved.invoiceId, data: { gross: 123, notes: data().notes } },
        link: { snapshot: { externalId: 'KSEF-FLOW-ONE' } },
      })
      expect(audit.afterJson).not.toContain('<Faktura')
    },
  )

  it('KEEP permits ordinary approval at the local amount and replays the original approval receipt after a new conflict', async () => {
    const { draft } = await uploadDraft()
    expect((await sync(doubled())).status).toBe(200)
    const kept = await resolveDraftKsefReconciliation(state.db, 'admin', draft.id, await resolution(draft.id))
    expect(await state.db.costEvent.count()).toBe(0)
    const input = mutation(kept.version)
    const approved = await approveInvoiceDraft(state.db, 'admin', draft.id, input)
    expect(await state.db.ksefInvoice.findUniqueOrThrow({ where: { id: approved.invoiceId } }))
      .toMatchObject({ source: 'MANUAL', grossAmount: 123 })
    const beforeMoney = await money()

    expect(await sync(metadata({ grossAmount: 369, netAmount: 300, vatAmount: 69 })))
      .toMatchObject({ status: 200, body: { linked: 1, conflicts: 1 } })
    expect((await detail(draft.id)).links[0]).toMatchObject({ status: 'CONFLICT', approvalBlocked: true })
    const beforeReplay = await fullSnapshot()
    await expect(approveInvoiceDraft(state.db, 'admin', draft.id, input)).resolves.toEqual(approved)
    expect(await fullSnapshot()).toEqual(beforeReplay)
    expect(await money()).toEqual(beforeMoney)
  })

  it('a changed observation invalidates KEEP on OPEN and rejected approval cannot invalidate a confirmed closed month', async () => {
    const { draft } = await uploadDraft()
    await sync(doubled())
    await resolveDraftKsefReconciliation(state.db, 'admin', draft.id, await resolution(draft.id))
    await sync(metadata({ grossAmount: 369, netAmount: 300, vatAmount: 69 }))
    const closed = await state.db.financePeriodClose.create({ data: { year: 2026, month: 9, closedById: 'admin' } })
    const before = await fullSnapshot()

    await expect(approveInvoiceDraft(state.db, 'admin', draft.id, mutation((await currentDraft(draft.id)).version, [closed.id])))
      .rejects.toMatchObject({ code: 'KSEF_CONFLICT', status: 409 })

    expect(await fullSnapshot()).toEqual(before)
    const kept = await resolveDraftKsefReconciliation(state.db, 'admin', draft.id, await resolution(draft.id))
    const approved = await approveInvoiceDraft(state.db, 'admin', draft.id, mutation(kept.version, [closed.id]))
    expect(approved).toMatchObject({ outcome: 'APPROVED', invalidatedPeriods: [{ id: closed.id }] })
    expect(await state.db.costEvent.findMany()).toMatchObject([{ grossAmount: 123 }])
    expect(await state.db.financePeriodClose.count()).toBe(0)
    expect(await state.db.costAuditLog.count({ where: { action: 'finance.period.invalidate' } })).toBe(1)
  })

  it('requires revoke before APPLY and creates one replacement expense only on reapproval of the same invoice', async () => {
    const { draft, bytes } = await uploadDraft()
    const first = await approveInvoiceDraft(state.db, 'admin', draft.id, mutation(draft.version))
    await sync(doubled(), PAID_XML)
    const beforeInvalidApply = await fullSnapshot()
    await expect(resolveDraftKsefReconciliation(state.db, 'admin', draft.id, await resolution(draft.id, 'APPLY_TO_DRAFT')))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
    expect(await fullSnapshot()).toEqual(beforeInvalidApply)

    await revokeInvoiceDraft(state.db, 'admin', draft.id, mutation((await currentDraft(draft.id)).version))
    const afterRevoke = await money()
    const applied = await resolveDraftKsefReconciliation(state.db, 'admin', draft.id, await resolution(draft.id, 'APPLY_TO_DRAFT'))
    expect(await money()).toEqual(afterRevoke)
    const updated = await currentDraft(draft.id)
    expect(updated).toMatchObject({ state: 'OPEN', invoiceId: first.invoiceId })
    expect(JSON.parse(updated.dataJson)).toMatchObject({
      gross: 246, net: 200, vat: 46, paymentStatus: 'PAID', paidAt: '2026-09-11',
      notes: data().notes, costCenterId: 'JAG', tagIds: ['tag-fixed'],
    })
    expect(await state.db.costEvent.findMany()).toMatchObject([{
      id: first.costEventId, grossAmount: 123, status: 'VOID', sourceInvoiceId: null,
    }])
    const last = await approveInvoiceDraft(state.db, 'admin', draft.id, mutation(applied.version))
    expect(last).toMatchObject({ outcome: 'APPROVED', invoiceId: first.invoiceId })
    expect(last.costEventId).not.toBe(first.costEventId)
    const result = await money()
    expect(result.invoices).toHaveLength(1)
    expect(result.invoices[0]).toMatchObject({ id: first.invoiceId, source: 'MANUAL', grossAmount: 246,
      notes: data().notes, costCenterId: 'JAG', paymentStatus: 'PAID', parts: [{
        grossAmount: 246, tags: [{ tagId: 'tag-fixed' }], allocations: [{ costCenterId: 'JAG', percent: 100 }],
      }],
    })
    expect(result.costs).toHaveLength(2)
    expect(result.costs.filter((cost) => cost.status === 'APPROVED')).toMatchObject([{
      id: last.costEventId, source: 'MANUAL', sourceInvoiceId: first.invoiceId, grossAmount: 246,
      parts: [{ tags: [{ tagId: 'tag-fixed' }], allocations: [{ costCenterId: 'JAG', percent: 100 }] }],
    }])
    expect((await getInvoiceOriginal(state.db, 'admin', draft.id, environment())).bytes).toEqual(bytes)
  })

  it('allows approval by a second SQLite client while sync waits for XML, then links the freshly approved invoice', async () => {
    const { draft } = await uploadDraft()
    incoming(doubled())
    const downloadStarted = deferred<void>()
    const downloaded = deferred<string>()
    network.downloadInvoiceXml.mockImplementation(async () => {
      downloadStarted.resolve()
      return downloaded.promise
    })
    const pendingSync = SYNC()
    await downloadStarted.promise
    let approved: Awaited<ReturnType<typeof approveInvoiceDraft>>
    let beforeSyncWrite: Awaited<ReturnType<typeof money>>
    try {
      // A transaction held across the external download would prevent this
      // independent writer from finishing before downloaded.resolve().
      approved = await approveInvoiceDraft(other, 'admin', draft.id, mutation(draft.version))
      beforeSyncWrite = await money()
    } finally { downloaded.resolve('<Faktura />') }
    const response = await pendingSync
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ linked: 1, conflicts: 1, imported: 0, updated: 0 })
    expect(await money()).toEqual(beforeSyncWrite)
    expect(await currentDraft(draft.id)).toMatchObject({
      state: 'APPROVED', invoiceId: approved.invoiceId, version: approved.version + 1,
    })
    expect(await state.db.ksefInvoice.count()).toBe(1)
    expect(await state.db.costEvent.count()).toBe(1)
  }, 15_000)

  it('sync winning first makes a second client approval stale, including a matching observation', async () => {
    const { draft } = await uploadDraft()
    expect(await sync()).toMatchObject({ status: 200, body: { linked: 1, conflicts: 0 } })
    const before = await fullSnapshot()
    await expect(approveInvoiceDraft(other, 'admin', draft.id, mutation(draft.version)))
      .rejects.toMatchObject({ code: 'STALE_VERSION', status: 409 })
    expect(await fullSnapshot()).toEqual(before)
    await expect(approveInvoiceDraft(other, 'admin', draft.id, mutation((await currentDraft(draft.id)).version)))
      .resolves.toMatchObject({ outcome: 'APPROVED' })
    expect(await state.db.ksefInvoice.count()).toBe(1)
    expect(await state.db.costEvent.count()).toBe(1)
  })

  it('repeated sync reuses cached XML and keeps one observation audit, version, invoice and expense', async () => {
    const { draft } = await uploadDraft()
    await approveInvoiceDraft(state.db, 'admin', draft.id, mutation(draft.version))
    expect(await sync(metadata(), PAID_XML)).toMatchObject({ status: 200, body: {
      linked: 1, conflicts: 1, imported: 0, updated: 0, xmlDetailsFetched: 1,
    } })
    const before = await fullSnapshot()
    network.downloadInvoiceXml.mockClear()
    expect(await sync()).toMatchObject({ status: 200, body: {
      linked: 1, conflicts: 1, imported: 0, updated: 0, xmlDetailsFetched: 0,
    } })
    expect(network.downloadInvoiceXml).not.toHaveBeenCalled()
    expect(await fullSnapshot()).toEqual(before)
    expect(await state.db.invoiceDraftAudit.count({ where: { action: 'KSEF_OBSERVED' } })).toBe(1)
  })

  it('ambiguous imported identities return 409 without falling through to legacy writes or supplier rules', async () => {
    await uploadDraft()
    await uploadDraft()
    const before = await fullSnapshot()
    expect(await sync(doubled())).toMatchObject({ status: 409, body: { code: 'KSEF_AMBIGUOUS_MATCH' } })
    expect(await fullSnapshot()).toEqual(before)
  })

  it('checks a role downgrade after external XML work before beginning any reconciliation write', async () => {
    await uploadDraft()
    incoming(doubled())
    const downloadStarted = deferred<void>()
    const downloaded = deferred<string>()
    network.downloadInvoiceXml.mockImplementation(async () => {
      downloadStarted.resolve()
      return downloaded.promise
    })
    const pendingSync = SYNC()
    await downloadStarted.promise
    const before = await fullSnapshot()
    try { await other.user.update({ where: { id: 'admin' }, data: { role: 'MANAGER' } }) }
    finally { downloaded.resolve('<Faktura />') }
    const response = await pendingSync
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN' })
    expect(await fullSnapshot()).toEqual(before)
  })

  it('an observation audit failure rolls back link, version and all financial effects', async () => {
    const { draft } = await uploadDraft()
    await approveInvoiceDraft(state.db, 'admin', draft.id, mutation(draft.version))
    await state.db.$executeRawUnsafe(`CREATE TRIGGER "test_ksef_observation_audit_failure"
      BEFORE INSERT ON "InvoiceDraftAudit" WHEN NEW."action" = 'KSEF_OBSERVED'
      BEGIN SELECT RAISE(ABORT, 'test observation audit abort'); END`)
    const before = await fullSnapshot()
    const result = await sync(doubled())
    expect(result.status).toBe(502)
    expect(JSON.stringify(result.body)).not.toContain('test observation audit abort')
    expect(await fullSnapshot()).toEqual(before)
  })

  it('an approval audit failure after resolved KEEP rolls back cost, invoice, receipt and closed-period invalidation', async () => {
    const { draft } = await uploadDraft()
    await sync(doubled())
    const kept = await resolveDraftKsefReconciliation(state.db, 'admin', draft.id, await resolution(draft.id))
    const closed = await state.db.financePeriodClose.create({ data: { year: 2026, month: 9, closedById: 'admin' } })
    await state.db.$executeRawUnsafe(`CREATE TRIGGER "test_ksef_approval_audit_failure"
      BEFORE INSERT ON "InvoiceDraftAudit" WHEN NEW."action" = 'APPROVED'
      BEGIN SELECT RAISE(ABORT, 'test approval audit abort'); END`)
    const before = await fullSnapshot()
    await expect(approveInvoiceDraft(state.db, 'admin', draft.id, mutation(kept.version, [closed.id])))
      .rejects.toBeDefined()
    expect(await fullSnapshot()).toEqual(before)
  })

  it('a non-ACTIVE KSeF correction remains blocked even after an explicit KEEP decision', async () => {
    const { draft } = await uploadDraft()
    expect(await sync(metadata({ documentType: 'KOR_ZAL' })))
      .toMatchObject({ status: 200, body: { linked: 1, conflicts: 1, imported: 0, updated: 0 } })
    const kept = await resolveDraftKsefReconciliation(state.db, 'admin', draft.id, await resolution(draft.id))
    const before = await fullSnapshot()
    expect((await detail(draft.id)).links[0]).toMatchObject({
      approvalBlocked: true, snapshot: { documentStatus: 'CORRECTION' },
    })
    await expect(approveInvoiceDraft(state.db, 'admin', draft.id, mutation(kept.version)))
      .rejects.toMatchObject({ code: 'KSEF_CONFLICT', status: 409 })
    expect(await fullSnapshot()).toEqual(before)
  })

  it.each(['UNPAID', 'PARTIAL', 'UNKNOWN'] as const)(
    'an XML payment method with no explicit payment marker preserves local %s and never fabricates paidAt',
    async (paymentStatus) => {
      const { draft } = await uploadDraft({ paymentStatus })
      await approveInvoiceDraft(state.db, 'admin', draft.id, mutation(draft.version))
      const before = await money()
      expect(await sync(metadata(), '<Faktura><Fa><Platnosc><FormaPlatnosci>6</FormaPlatnosci></Platnosc></Fa></Faktura>'))
        .toMatchObject({ status: 200, body: { linked: 1, conflicts: 0, imported: 0, updated: 0 } })
      expect(await money()).toEqual(before)
      expect((await detail(draft.id)).links[0].snapshot.data).toMatchObject({ paymentStatus: 'UNKNOWN', paidAt: null })
      expect(await state.db.ksefInvoice.findMany()).toMatchObject([{ paymentStatus, paidAt: null }])
    },
  )

  it.each([['1', 'PARTIAL'], ['2', 'PAID']] as const)(
    'an explicit partial-payment marker %s records %s without inventing a payment date or changing the expense',
    async (marker, paymentStatus) => {
      const { draft } = await uploadDraft()
      await approveInvoiceDraft(state.db, 'admin', draft.id, mutation(draft.version))
      const before = await money()
      expect(await sync(metadata(), `<Faktura><Fa><Platnosc><ZnacznikZaplatyCzesciowej>${marker}</ZnacznikZaplatyCzesciowej></Platnosc></Fa></Faktura>`))
        .toMatchObject({ status: 200, body: { linked: 1, conflicts: 1, imported: 0, updated: 0 } })
      expect(await money()).toEqual(before)
      expect((await detail(draft.id)).links[0].snapshot.data).toMatchObject({ paymentStatus, paidAt: null })
    },
  )

  it('a fresh database role takes precedence over a historical successful approval receipt', async () => {
    const { draft } = await uploadDraft()
    const input = mutation(draft.version)
    await approveInvoiceDraft(state.db, 'admin', draft.id, input)
    await sync(doubled())
    await other.user.update({ where: { id: 'admin' }, data: { role: 'MANAGER' } })
    const before = await fullSnapshot()
    await expect(approveInvoiceDraft(state.db, 'admin', draft.id, input))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(await fullSnapshot()).toEqual(before)
  })

  it('malformed incoming XML returns 422 before recording links, drafts or legacy invoices', async () => {
    await uploadDraft()
    const before = await fullSnapshot()
    expect(await sync(metadata(), '<Faktura><Fa><Platnosc><Zaplacono garbage>1</Zaplacono></Platnosc></Fa></Faktura>'))
      .toMatchObject({ status: 422, body: { code: 'INVALID_KSEF_SNAPSHOT' } })
    expect(await fullSnapshot()).toEqual(before)
  })

  it.each(['MANUAL', 'KSEF'] as const)('keeps the legacy %s update path working for invoices with no import draft', async (source) => {
    const invoice = await state.db.ksefInvoice.create({ data: {
      source, supplierName: 'Dostawca Sp. z o.o.', supplierNip: 'PL1234567890',
      invoiceNumber: 'FV/9/2026', issueDate: new Date('2026-09-10T00:00:00Z'),
      grossAmount: 123, netAmount: 100, vatAmount: 23, currency: 'PLN',
      status: 'NEW', documentStatus: 'ACTIVE', paymentStatus: 'UNPAID',
    } })
    expect(await sync(doubled())).toMatchObject({ status: 200, body: {
      linked: 0, conflicts: 0, imported: 0, updated: 1,
    } })
    expect(await state.db.ksefInvoice.findMany()).toMatchObject([{
      id: invoice.id, source, externalId: 'KSEF-FLOW-ONE', grossAmount: 246,
    }])
    expect(await state.db.invoiceKsefReconciliation.count()).toBe(0)
    expect(await state.db.costEvent.count()).toBe(0)
  })

  it('new legacy KSeF invoices still receive rule classification and explicit payment without creating an expense', async () => {
    await state.db.ksefSupplierRule.create({ data: {
      supplierNamePattern: 'Dostawca', costCenterId: 'PUL', tags: { create: { tagId: 'tag-fixed' } },
    } })
    expect(await sync(metadata(), PAID_XML)).toMatchObject({ status: 200, body: {
      linked: 0, conflicts: 0, imported: 1, updated: 0,
    } })
    const invoices = await state.db.ksefInvoice.findMany({ include: { parts: { include: { tags: true, allocations: true } } } })
    expect(invoices).toHaveLength(1)
    expect(invoices[0]).toMatchObject({ source: 'KSEF', externalId: 'KSEF-FLOW-ONE', grossAmount: 123,
      paymentStatus: 'PAID', paidAt: new Date('2026-09-11T00:00:00Z'), status: 'MAPPED', costCenterId: 'PUL',
      parts: [{ grossAmount: 123, tags: [{ tagId: 'tag-fixed' }], allocations: [{ costCenterId: 'PUL', percent: 100 }] }],
    })
    expect(await state.db.invoiceKsefReconciliation.count()).toBe(0)
    expect(await state.db.costEvent.count()).toBe(0)
  })
})
