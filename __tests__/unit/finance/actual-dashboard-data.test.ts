// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@/generated/prisma'
import { loadActualDashboardData } from '@/lib/finance/actual-dashboard-data'
import { loadActualDashboardModel } from '@/lib/finance/actual-dashboard-model-data'
import { approveInvoiceDraft, revokeInvoiceDraft } from '@/lib/invoice-import/approval-service'
import { archiveDraft, editDraft } from '@/lib/invoice-import/draft-service'

const state = vi.hoisted(() => ({ db: null as unknown as PrismaClient }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.db } }))
const directory = mkdtempSync(join(tmpdir(), 'actual-dashboard-'))
const databaseUrl = `file:${join(directory, 'test.db')}`
beforeAll(async () => {
  execFileSync('sqlite3', [join(directory, 'test.db'), 'VACUUM;'])
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' })
  state.db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await state.db.costCenter.createMany({ data: ['JAG', 'PUL', 'GLOBAL'].map((id) => ({ id, name: id })) })
  await state.db.revenueBudget.create({ data: { year: 2024, month: 8, amount: 1000000, channel: 'SALON', costCenterId: 'PUL' } })
  await state.db.revenue.createMany({ data: [
    { year: 2026, month: 8, amount: 0, channel: 'SALON', costCenterId: 'PUL', asOfDate: null },
    { year: 2026, month: 9, amount: 900, channel: 'SALON', costCenterId: 'PUL', asOfDate: '2026-09-10' },
  ] })
  await state.db.costEvent.create({ data: { source: 'MANUAL', status: 'APPROVED', eventDate: new Date('2026-08-12T00:00:00Z'), grossAmount: 50, parts: { create: { label: 'Koszt', grossAmount: 50, allocations: { create: { costCenterId: 'GLOBAL', percent: 100 } } } } } })
  await state.db.ksefInvoice.createMany({ data: [
    { supplierName: 'Test', invoiceNumber: 'WAIT', issueDate: new Date('2026-08-31T23:59:59Z'), grossAmount: 100, currency: 'EUR', status: 'NEW' },
    { supplierName: 'Test', invoiceNumber: 'NEXT', issueDate: new Date('2026-09-01T00:00:00Z'), grossAmount: 999, status: 'NEW' },
    { supplierName: 'Test', invoiceNumber: 'APPROVED', issueDate: new Date('2026-08-01T00:00:00Z'), grossAmount: 888, status: 'APPROVED' },
  ] })
  await state.db.cashAccount.create({ data: { name: 'Rachunek bieżący', balance: 321.45 } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
}, 60_000)
afterAll(async () => {
  vi.unstubAllGlobals()
  await state.db?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('shared dashboard data on SQLite', () => {
  it('returns the identical financial model through the dashboard and standalone financial loader', async () => {
    const period = { year: 2026, month: 8 }
    const now = new Date('2026-09-10T12:00:00Z')
    const dashboard = await loadActualDashboardData(period, 'test-admin', now)
    expect(await loadActualDashboardModel(period, now)).toEqual(dashboard.model)
  })
  it('ignores historical sales budgets even when there is no actual revenue', async () => {
    const data = await loadActualDashboardData({ year: 2024, month: 8 }, 'test-admin', new Date('2026-09-10T12:00:00Z'))
    expect(data.model.selected.revenue).toBeNull()
    expect(data.model.selected.result).toBeNull()
    expect(await state.db.revenueBudget.count()).toBe(1)
  })
  it('loads only the chosen actual period and current accounts independently of that period', async () => {
    const data = await loadActualDashboardData({ year: 2026, month: 8 }, 'test-admin', new Date('2026-09-10T12:00:00Z'))
    expect(data.model.selected).toMatchObject({ revenue: 0, result: -50 })
    expect(data.model.ytd.revenue).toBe(0)
    expect(data.model.waiting).toEqual({ count: 1, plnAmount: 0, unconverted: [{ currency: 'EUR', amount: 100 }] })
    expect(data.cashAccounts.map((account) => account.balance)).toEqual([321.45])
    expect(data.eurRate).toBeNull()
  })

  it('loads explicit closes and pending invoice periods for both years before permitting r/r', async () => {
    const channels = [['JAG', 'SALON'], ['JAG', 'MONTAZ'], ['PUL', 'SALON'], ['PUL', 'MONTAZ'], ['PUL', 'ECOMMERCE']]
    await state.db.revenue.createMany({ data: [2022, 2023].flatMap((year) => channels.map(([costCenterId, channel]) => ({ year, month: 8, amount: 100, costCenterId, channel, asOfDate: `${year}-08-31` }))) })
    await state.db.financePeriodClose.createMany({ data: [{ year: 2022, month: 8 }, { year: 2023, month: 8 }] })
    const pending = await state.db.ksefInvoice.create({ data: { supplierName: 'Prior-year cost', invoiceNumber: 'PRIOR-WAIT', issueDate: new Date('2022-08-15T00:00:00Z'), grossAmount: 100000, currency: 'PLN', status: 'MAPPED' } })
    const load = () => loadActualDashboardData({ year: 2023, month: 8 }, 'test-admin', new Date('2026-09-10T12:00:00Z'))
    const before = await load()
    expect(before.model.selected).toMatchObject({ costs: 0, complete: true, costsConfirmed: true })
    expect(before.model.yoy).toBeNull()
    expect(before.model.waiting.count).toBe(0)
    await state.db.ksefInvoice.update({ where: { id: pending.id }, data: { status: 'IGNORED' } })
    const after = await load()
    expect(after.model.yoy).toMatchObject({ revenueDelta: 0, resultDelta: 0, previous: { costsConfirmed: true } })
    const draft = await state.db.costEvent.create({ data: { source: 'MANUAL', status: 'DRAFT', documentStatus: 'ACTIVE', eventDate: new Date('2023-08-10T00:00:00Z'), grossAmount: 200 } })
    await state.db.costEvent.create({ data: { source: 'MANUAL', status: 'DRAFT', documentStatus: 'CANCELLED', eventDate: new Date('2023-08-10T00:00:00Z'), grossAmount: 999 } })
    const awaitingCost = await load()
    expect(awaitingCost.model.selected).toMatchObject({ complete: false, pendingDocumentCount: 1, costsConfirmed: false })
    expect(awaitingCost.model.waiting.count).toBe(0)
    const invoice = await state.db.ksefInvoice.create({ data: { supplierName: 'Current cost', invoiceNumber: 'CURRENT-WAIT', issueDate: new Date('2023-08-15T00:00:00Z'), grossAmount: 100000, currency: 'PLN', status: 'MAPPED' } })
    await state.db.costEvent.create({ data: { source: 'KSEF', sourceInvoiceId: invoice.id, status: 'DRAFT', documentStatus: 'ACTIVE', eventDate: new Date('2023-08-15T00:00:00Z'), grossAmount: 100000 } })
    const linked = await load()
    expect(linked.model.selected.pendingDocumentCount).toBe(2)
    expect(linked.model.waiting).toMatchObject({ count: 1, plnAmount: 100000 })
    await state.db.costEvent.update({ where: { id: draft.id }, data: { status: 'APPROVED' } })
    expect(await state.db.financePeriodClose.count({ where: { year: { in: [2022, 2023] } } })).toBe(2)
  })

  it('includes pending corrections while excluding cancelled invoices and cost documents', async () => {
    const period = { year: 2021, month: 8 }
    await state.db.financePeriodClose.create({ data: period })
    const invoice = await state.db.ksefInvoice.create({ data: { supplierName: 'Correction', invoiceNumber: 'CORRECTION-WAIT', issueDate: new Date('2021-08-15T00:00:00Z'), grossAmount: -100, currency: 'PLN', status: 'MAPPED', documentStatus: 'CORRECTION' } })
    await state.db.ksefInvoice.create({ data: { supplierName: 'Cancelled', invoiceNumber: 'CANCELLED-WAIT', issueDate: new Date('2021-08-15T00:00:00Z'), grossAmount: 999, currency: 'PLN', status: 'NEW', documentStatus: 'CANCELLED' } })
    const load = () => loadActualDashboardData(period, 'test-admin', new Date('2026-09-10T12:00:00Z'))
    const waitingCorrection = await load()
    expect(waitingCorrection.model.selected).toMatchObject({ costsConfirmed: false, pendingDocumentCount: 1 })
    expect(waitingCorrection.model.waiting).toMatchObject({ count: 1, plnAmount: -100 })
    await state.db.ksefInvoice.update({ where: { id: invoice.id }, data: { status: 'APPROVED' } })
    const event = await state.db.costEvent.create({ data: { source: 'MANUAL', status: 'DRAFT', documentStatus: 'CORRECTION', eventDate: new Date('2021-08-15T00:00:00Z'), grossAmount: -100 } })
    expect((await load()).model.selected).toMatchObject({ costsConfirmed: false, pendingDocumentCount: 1 })
    await state.db.costEvent.update({ where: { id: event.id }, data: { documentStatus: 'CANCELLED' } })
    expect((await load()).model.selected).toMatchObject({ costsConfirmed: true, pendingDocumentCount: 0 })
  })

  it('keeps VOID audit history after invoice reapproval without permanently blocking the closed period', async () => {
    const period = { year: 2026, month: 7 }
    await state.db.financePeriodClose.create({ data: period })
    await state.db.revenue.createMany({ data: [['JAG', 'SALON'], ['JAG', 'MONTAZ'], ['PUL', 'SALON'], ['PUL', 'MONTAZ'], ['PUL', 'ECOMMERCE']].map(([costCenterId, channel]) => ({ ...period, costCenterId, channel, amount: 100, asOfDate: '2026-07-31' })) })
    const invoice = await state.db.ksefInvoice.create({ data: { supplierName: 'Reapproved', invoiceNumber: 'REAPPROVED', issueDate: new Date('2026-07-15T00:00:00Z'), grossAmount: 100, currency: 'PLN', status: 'APPROVED' } })
    const eventData = { source: 'KSEF', sourceInvoiceId: invoice.id, status: 'APPROVED', documentStatus: 'ACTIVE', eventDate: new Date('2026-07-15T00:00:00Z'), grossAmount: 100,
      parts: { create: { label: 'Cost', grossAmount: 100, allocations: { create: { costCenterId: 'PUL', percent: 100 } } } } }
    const old = await state.db.costEvent.create({ data: eventData })
    // Preserve the lifecycle performed by DELETE /ksef/invoices/[id]/approve.
    await state.db.$transaction([
      state.db.costEvent.update({ where: { id: old.id }, data: { status: 'VOID', sourceInvoiceId: null } }),
      state.db.ksefInvoice.update({ where: { id: invoice.id }, data: { status: 'MAPPED' } }),
    ])
    const load = () => loadActualDashboardData(period, 'test-admin', new Date('2026-09-10T12:00:00Z'))
    expect((await load()).model.selected).toMatchObject({ costsConfirmed: false, pendingDocumentCount: 1 })
    await state.db.$transaction([
      state.db.costEvent.create({ data: eventData }),
      state.db.ksefInvoice.update({ where: { id: invoice.id }, data: { status: 'APPROVED' } }),
    ])
    expect((await load()).model.selected).toMatchObject({ costs: 100, result: 400, complete: true, costsConfirmed: true, pendingDocumentCount: 0 })
    expect((await state.db.costEvent.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('VOID')
  })

  it('keeps revoked import snapshots out of waiting money through editing and archiving', async () => {
    const period = { year: 2026, month: 6 }
    const now = new Date('2026-09-10T12:00:00Z')
    const actor = await state.db.user.create({ data: {
      id: 'import-dashboard-admin', name: 'Import dashboard admin', email: 'import-dashboard@example.test',
      role: 'ADMIN', passwordHash: 'test', isActive: true, mustChangePassword: false,
    } })
    const behavior = await state.db.costTagGroup.create({ data: { name: 'Charakter', slug: 'behavior' } })
    const fixed = await state.db.costTag.create({ data: { groupId: behavior.id, name: 'Stały', slug: 'fixed' } })
    const batch = await state.db.invoiceImportBatch.create({ data: { ownerUserId: actor.id } })
    const attachment = await state.db.invoiceAttachment.create({ data: {
      storageKey: 'dashboard-june-import.bin', sha256: 'a'.repeat(64), originalName: 'june-invoice.pdf',
      mimeType: 'application/pdf', byteSize: 100, pageCount: 1, state: 'READY', createdById: actor.id,
    } })
    const draft = await state.db.invoiceImportDraft.create({ data: {
      batchId: batch.id, attachmentId: attachment.id,
      dataJson: JSON.stringify({
        documentType: 'INVOICE', supplierName: 'June imported supplier', taxId: 'PL1234567890',
        invoiceNumber: 'IMPORT/06/2026', issueDate: '2026-06-15', currency: 'PLN',
        gross: 123, net: 100, vat: 23, paymentStatus: 'UNPAID', costCenterId: 'PUL', tagIds: [fixed.id],
      }),
    } })
    const load = () => loadActualDashboardData(period, actor.id, now)
    const inboxCount = () => state.db.ksefInvoice.count({ where: {
      status: { in: ['NEW', 'MAPPED'] }, invoiceImportDraft: { is: null },
    } })
    const initialInboxCount = await inboxCount()

    const approved = await approveInvoiceDraft(state.db, actor.id, draft.id, {
      expectedVersion: draft.version, idempotencyKey: 'dashboard-june-approve',
    })
    expect(approved.outcome).toBe('APPROVED')
    const approvedDashboard = await load()
    expect(approvedDashboard.model.selected).toMatchObject({ costs: 123, pendingDocumentCount: 0 })
    expect(approvedDashboard.model.waiting).toEqual({ count: 0, plnAmount: 0, unconverted: [] })
    const originalParts = await state.db.costEventPart.findMany({
      where: { eventId: approved.costEventId! }, include: { tags: true, allocations: true },
    })
    const approvalReceipt = await state.db.invoiceDraftAudit.findFirstOrThrow({
      where: { draftId: draft.id, action: 'APPROVED' },
    })

    const revoked = await revokeInvoiceDraft(state.db, actor.id, draft.id, {
      expectedVersion: approved.version, idempotencyKey: 'dashboard-june-revoke',
    })
    expect(revoked).toMatchObject({ outcome: 'REVOKED', invoiceId: approved.invoiceId, costEventId: approved.costEventId })
    const revokedDashboard = await load()
    expect(revokedDashboard.model.selected).toMatchObject({ costs: 0, pendingDocumentCount: 0 })
    expect(revokedDashboard.model.waiting).toEqual({ count: 0, plnAmount: 0, unconverted: [] })
    expect(await inboxCount()).toBe(initialInboxCount)

    const edited = await editDraft(state.db, actor.id, draft.id, revoked.version, {
      issueDate: '2026-05-15', gross: 999, net: 999, vat: 0,
    })
    expect(edited).toMatchObject({ state: 'OPEN', invoiceId: approved.invoiceId, data: { issueDate: '2026-05-15', gross: 999 } })
    const editedDashboard = await load()
    expect(editedDashboard.model.selected).toMatchObject({ costs: 0, pendingDocumentCount: 0 })
    expect(editedDashboard.model.waiting).toEqual({ count: 0, plnAmount: 0, unconverted: [] })
    const may = await loadActualDashboardModel({ year: 2026, month: 5 }, now)
    expect(may.selected).toMatchObject({ costs: 0, pendingDocumentCount: 0 })
    expect(may.waiting).toEqual({ count: 0, plnAmount: 0, unconverted: [] })
    expect(await inboxCount()).toBe(initialInboxCount)

    const archived = await archiveDraft(state.db, actor.id, draft.id, edited.version)
    expect(archived).toMatchObject({ state: 'ARCHIVED', invoiceId: approved.invoiceId })
    const archivedDashboard = await load()
    expect(archivedDashboard.model.selected).toMatchObject({ costs: 0, pendingDocumentCount: 0 })
    expect(archivedDashboard.model.waiting).toEqual({ count: 0, plnAmount: 0, unconverted: [] })
    expect(await inboxCount()).toBe(initialInboxCount)
    expect(await state.db.ksefInvoice.findUniqueOrThrow({ where: { id: approved.invoiceId } })).toMatchObject({
      status: 'MAPPED', issueDate: new Date('2026-06-15T00:00:00Z'), grossAmount: 123,
    })
    expect(await state.db.costEvent.findUniqueOrThrow({ where: { id: approved.costEventId! } })).toMatchObject({
      status: 'VOID', sourceInvoiceId: null, grossAmount: 123,
    })
    expect(await state.db.costEventPart.findMany({
      where: { eventId: approved.costEventId! }, include: { tags: true, allocations: true },
    })).toEqual(originalParts)
    expect(await state.db.invoiceDraftAudit.findUniqueOrThrow({ where: { id: approvalReceipt.id } })).toEqual(approvalReceipt)
    const audits = await state.db.invoiceDraftAudit.findMany({ where: { draftId: draft.id } })
    expect(audits.map((audit) => audit.action).sort()).toEqual(['APPROVED', 'ARCHIVED', 'EDITED', 'REVOKED'])
    const costAudits = await state.db.costAuditLog.findMany({
      where: { invoiceId: approved.invoiceId, costEventId: approved.costEventId },
    })
    expect(costAudits.map((audit) => audit.action).sort()).toEqual(['invoice.approve', 'invoice.revoke'])

    await state.db.ksefInvoice.create({ data: {
      supplierName: 'Ordinary June supplier', invoiceNumber: 'ORDINARY/06/2026',
      issueDate: new Date('2026-06-20T00:00:00Z'), grossAmount: 50, currency: 'PLN', status: 'MAPPED',
    } })
    const ordinaryWaiting = await load()
    expect(ordinaryWaiting.model.selected).toMatchObject({ costs: 0, pendingDocumentCount: 1 })
    expect(ordinaryWaiting.model.waiting).toEqual({ count: 1, plnAmount: 50, unconverted: [] })
    expect(await inboxCount()).toBe(initialInboxCount + 1)
  })
})
