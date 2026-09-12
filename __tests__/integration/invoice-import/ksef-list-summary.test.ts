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
import { approveInvoiceDraft, revokeInvoiceDraft } from '@/lib/invoice-import/approval-service'
import { editDraft, getDraft, listDrafts } from '@/lib/invoice-import/draft-service'
import { reconcileImportedKsefInvoice, getDraftKsefReconciliations, resolveDraftKsefReconciliation } from '@/lib/invoice-import/ksef-reconciliation-service'
import { GET as invoicesGET } from '@/app/api/finance/ksef/invoices/route'
import KsefInboxPage from '@/app/(dashboard)/finance/ksef/page'

const state = vi.hoisted(() => ({ db: null as unknown as PrismaClient }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.db } }))
vi.mock('@/lib/finance/finance-access', () => ({ requireFinanceAdmin: async () => ({ session: { user: { id: 'admin', role: 'ADMIN' } } }) }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'admin', role: 'ADMIN' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const directory = mkdtempSync(join(tmpdir(), 'invoice-ksef-list-'))
const template = join(directory, 'template.db')
let draftId: string
const initial = { documentType: 'INVOICE', supplierName: 'Dostawca', taxId: 'PL1234567890',
  invoiceNumber: 'LIST/1', issueDate: '2026-09-10', currency: 'PLN', gross: 123, net: 100, vat: 23,
  paymentStatus: 'UNPAID', costCenterId: 'JAG', tagIds: ['fixed'], notes: 'Private draft note' }
const version = async () => (await state.db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draftId } })).version
const input = async () => ({ expectedVersion: await version(), idempotencyKey: randomUUID() })
async function observe(grossAmount = 123) {
  return withAiQueueMutation(state.db, () => new Date(), (tx, _lease, now) => reconcileImportedKsefInvoice(tx, 'admin', {
    ksefNumber: 'KSEF-LIST', seller: { nip: 'PL1234567890', name: 'Dostawca' }, invoiceNumber: 'LIST/1',
    issueDate: '2026-09-10', currency: 'PLN', grossAmount, netAmount: 100, vatAmount: 23,
  }, '<Faktura><Fa/></Faktura>', now))
}
async function keep() {
  const current = await getDraftKsefReconciliations(state.db, 'admin', draftId)
  return resolveDraftKsefReconciliation(state.db, 'admin', draftId, { action: 'KEEP_LOCAL', idempotencyKey: randomUUID(),
    reconciliationId: current.links[0].id, expectedDraftVersion: current.draftVersion, expectedLinkVersion: current.links[0].version })
}
beforeAll(async () => {
  execFileSync('/usr/bin/sqlite3', [template, 'VACUUM;'])
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${template}`, RUST_LOG: 'debug' }, stdio: 'pipe', timeout: 60_000,
  })
})
beforeEach(async () => {
  await state.db?.$disconnect()
  const path = join(directory, `${randomUUID()}.db`)
  cpSync(template, path)
  state.db = new PrismaClient({ datasources: { db: { url: `file:${path}` } } })
  await state.db.user.create({ data: { id: 'admin', role: 'ADMIN', name: 'Admin', email: 'admin@list.test', passwordHash: 'test-only' } })
  await state.db.costCenter.create({ data: { id: 'JAG', name: 'Jagiellońska' } })
  await state.db.costTagGroup.create({ data: { id: 'behavior', slug: 'behavior', name: 'Charakter' } })
  await state.db.costTag.create({ data: { id: 'fixed', groupId: 'behavior', slug: 'fixed', name: 'Stały' } })
  const batch = await state.db.invoiceImportBatch.create({ data: { ownerUserId: 'admin' } })
  const attachment = await state.db.invoiceAttachment.create({ data: { storageKey: `${randomUUID()}.bin`, sha256: 'a'.repeat(64),
    originalName: 'List.png', mimeType: 'image/png', byteSize: 10, state: 'READY', createdById: 'admin' } })
  draftId = (await state.db.invoiceImportDraft.create({ data: { batchId: batch.id, attachmentId: attachment.id,
    dataJson: JSON.stringify(initial) } })).id
})
afterAll(async () => {
  await state.db?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('current compact KSeF state across draft and common invoice lists', () => {
  it.each(['drafts', 'detail', 'api', 'ssr'] as const)('%s shows matching, conflict, explicit KEEP and reopened conflict without leaking reconciliation internals', async (surface) => {
    await approveInvoiceDraft(state.db, 'admin', draftId, await input())
    async function read() {
      if (surface === 'drafts') return (await listDrafts(state.db, 'admin'))[0]
      if (surface === 'detail') return getDraft(state.db, 'admin', draftId)
      if (surface === 'api') {
        const response = await invoicesGET(new NextRequest('http://localhost/api/finance/ksef/invoices'))
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.grossAmountTotal).toBe(123)
        expect(JSON.stringify(body.invoices)).not.toMatch(/snapshotJson|snapshotHash|resolvedDataHash|ksefReconciliations|dataJson|manualFieldsJson/)
        return body.invoices[0].invoiceImportDraft
      }
      const page = await KsefInboxPage()
      expect(page.props.initialGrossAmountTotal).toBe(123)
      expect(JSON.stringify(page.props.initialInvoices)).not.toMatch(/snapshotJson|snapshotHash|resolvedDataHash|ksefReconciliations|dataJson|manualFieldsJson/)
      return page.props.initialInvoices[0].invoiceImportDraft
    }
    expect((await read()).ksef).toEqual({ linkedCount: 0, conflictCount: 0 })
    await observe()
    expect((await read()).ksef).toEqual({ linkedCount: 1, conflictCount: 0 })
    await observe(124)
    expect((await read()).ksef).toEqual({ linkedCount: 1, conflictCount: 1 })
    await keep()
    expect((await read()).ksef).toEqual({ linkedCount: 1, conflictCount: 0 })
    await observe(125)
    expect((await read()).ksef).toEqual({ linkedCount: 1, conflictCount: 1 })
    expect(await state.db.costEvent.count({ where: { status: 'APPROVED' } })).toBe(1)
    expect((await state.db.ksefInvoice.findFirstOrThrow()).externalId).toBeNull()
  })

  it('OPEN list, GET and edit response recompute conflicts after manual edits without creating money', async () => {
    await observe()
    expect((await listDrafts(state.db, 'admin'))[0].ksef).toEqual({ linkedCount: 1, conflictCount: 0 })
    const edited = await editDraft(state.db, 'admin', draftId, await version(), { gross: 129 })
    expect(edited.ksef).toEqual({ linkedCount: 1, conflictCount: 1 })
    expect((await getDraft(state.db, 'admin', draftId)).ksef).toEqual(edited.ksef)
    expect(await state.db.ksefInvoice.count()).toBe(0)
    expect(await state.db.costEvent.count()).toBe(0)
  })

  it('revoked invoice retains KSeF badges but remains outside common list money totals', async () => {
    await approveInvoiceDraft(state.db, 'admin', draftId, await input())
    await observe(124)
    await revokeInvoiceDraft(state.db, 'admin', draftId, await input())
    const response = await invoicesGET(new NextRequest('http://localhost/api/finance/ksef/invoices'))
    const body = await response.json()
    expect(body.invoices[0].invoiceImportDraft).toMatchObject({ state: 'OPEN', ksef: { linkedCount: 1, conflictCount: 1 } })
    expect(body.grossAmountTotal).toBe(0)
    expect(body.unpaidAmountTotal).toBe(0)
    expect(body.unpaidCount).toBe(0)
  })
})
