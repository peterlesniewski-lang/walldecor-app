// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@/generated/prisma'
import { PATCH as EDIT_INVOICE } from '@/app/api/finance/ksef/invoices/[id]/route'
import { DELETE as UNAPPROVE_INVOICE, POST as APPROVE_INVOICE } from '@/app/api/finance/ksef/invoices/[id]/approve/route'
import { PUT as REPLACE_PARTS } from '@/app/api/finance/ksef/invoices/[id]/parts/route'
import { PATCH as UPDATE_PAYMENT } from '@/app/api/finance/ksef/invoices/[id]/payment/route'
import { PATCH as CONVERT_CURRENCY } from '@/app/api/finance/ksef/invoices/[id]/currency-conversion/route'
import { POST as BULK_PAYMENT } from '@/app/api/finance/ksef/invoices/bulk-payment/route'
import {
  applySupplierRuleToNewInvoices,
  applySupplierRulesToNewInvoices,
} from '@/lib/finance/ksef-rule-application'
import { withAiQueueMutation } from '@/lib/ai/queue'

const state = vi.hoisted(() => ({ db: null as unknown as PrismaClient }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.db } }))
vi.mock('@/lib/finance/finance-access', () => ({
  requireFinanceAdmin: vi.fn(async () => ({
    session: { user: { id: 'admin', role: 'ADMIN' } },
  })),
}))

const directory = mkdtempSync(path.join(tmpdir(), 'invoice-legacy-guard-'))
const databaseUrl = `file:${path.join(directory, 'guard.db')}`
let other: PrismaClient

const invoiceData = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  source: 'MANUAL',
  supplierName: 'Dostawca Testowy',
  supplierNip: 'PL1234567890',
  invoiceNumber: `FV/${id}/2026`,
  issueDate: new Date('2026-09-10T00:00:00.000Z'),
  grossAmount: 123,
  netAmount: 100,
  vatAmount: 23,
  currency: 'PLN',
  reportingGrossAmount: 123,
  reportingNetAmount: 100,
  reportingVatAmount: 23,
  status: 'MAPPED',
  paymentStatus: 'UNPAID',
  documentStatus: 'ACTIVE',
  notes: 'Dane ręczne pozostają bez zmian',
  bankAccount: 'PL00112233445566778899001122',
  ...overrides,
})

async function createImportedInvoice(
  id: string,
  stateName: 'OPEN' | 'APPROVED' | 'ARCHIVED',
  overrides: Record<string, unknown> = {},
) {
  const invoice = await state.db.ksefInvoice.create({ data: invoiceData(id, overrides) })
  const batch = await state.db.invoiceImportBatch.create({ data: { ownerUserId: 'admin' } })
  const attachment = await state.db.invoiceAttachment.create({ data: {
    storageKey: `${randomUUID()}.bin`,
    sha256: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    originalName: `${id}.pdf`,
    mimeType: 'application/pdf',
    byteSize: 100,
    pageCount: 1,
    state: 'READY',
    createdById: 'admin',
  } })
  const draft = await state.db.invoiceImportDraft.create({ data: {
    batchId: batch.id,
    attachmentId: attachment.id,
    invoiceId: invoice.id,
    state: stateName,
    dataJson: JSON.stringify({ supplierName: invoice.supplierName, notes: invoice.notes }),
  } })
  return { invoice, draft }
}

const jsonRequest = (url: string, method: string, body?: unknown) => new NextRequest(url, {
  method,
  ...(body === undefined ? {} : {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }),
})

async function expectReviewConflict(response: Response, draftId: string) {
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({
    code: 'INVOICE_IMPORT_REVIEW_REQUIRED',
    draftId,
    error: expect.any(String),
  })
}

async function protectedDataSnapshot() {
  return {
    invoices: await state.db.ksefInvoice.findMany({ orderBy: { id: 'asc' } }),
    invoiceParts: await state.db.ksefInvoicePart.findMany({ orderBy: { id: 'asc' } }),
    invoicePartTags: await state.db.ksefInvoicePartTag.findMany({ orderBy: [{ partId: 'asc' }, { tagId: 'asc' }] }),
    invoicePartAllocations: await state.db.ksefInvoicePartAllocation.findMany({ orderBy: { id: 'asc' } }),
    costs: await state.db.costEvent.findMany({ orderBy: { id: 'asc' } }),
    costParts: await state.db.costEventPart.findMany({ orderBy: { id: 'asc' } }),
    audits: await state.db.costAuditLog.findMany({ orderBy: { id: 'asc' } }),
    rules: await state.db.ksefSupplierRule.findMany({ orderBy: { id: 'asc' } }),
    ruleTags: await state.db.ksefSupplierRuleTag.findMany({ orderBy: [{ ruleId: 'asc' }, { tagId: 'asc' }] }),
  }
}

beforeAll(async () => {
  const initialized = spawnSync('sqlite3', [path.join(directory, 'guard.db'), 'VACUUM;'], { encoding: 'utf8' })
  if (initialized.status !== 0) throw new Error(initialized.stderr || initialized.stdout)
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(migrated.stderr || migrated.stdout)
  state.db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  other = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
})

beforeEach(async () => {
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
    id: 'admin', name: 'Admin', email: 'admin@guard.test', passwordHash: 'test', role: 'ADMIN',
  } })
  await state.db.costCenter.createMany({ data: [
    { id: 'JAG', name: 'JAG' }, { id: 'PUL', name: 'PUL' }, { id: 'GLOBAL', name: 'GLOBAL' },
  ] })
  const group = await state.db.costTagGroup.create({ data: {
    id: 'group-behavior', slug: 'behavior', name: 'Charakter',
  } })
  await state.db.costTag.create({ data: {
    id: 'tag-fixed', groupId: group.id, slug: 'fixed', name: 'Stały',
  } })
})

afterAll(async () => {
  await state.db?.$disconnect()
  await other?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('legacy finance writers against imported invoices', () => {
  it.each(['OPEN', 'APPROVED', 'ARCHIVED'] as const)(
    'returns the stable review conflict for a permanently linked %s draft',
    async (draftState) => {
      const { draft } = await createImportedInvoice(`state-${draftState}`, draftState, {
        status: draftState === 'APPROVED' ? 'APPROVED' : 'MAPPED',
      })
      const before = await protectedDataSnapshot()

      const response = await UPDATE_PAYMENT(
        jsonRequest(`http://localhost/api/finance/ksef/invoices/state-${draftState}/payment`, 'PATCH', {
          paymentStatus: 'PAID',
        }),
        { params: Promise.resolve({ id: `state-${draftState}` }) },
      )

      await expectReviewConflict(response, draft.id)
      expect(await protectedDataSnapshot()).toEqual(before)
    },
  )

  it('blocks every direct legacy writer before invoice, cost, parts, audit or supplier-rule effects', async () => {
    const { invoice, draft } = await createImportedInvoice('imported', 'APPROVED', {
      status: 'APPROVED',
      currency: 'EUR',
      originalCurrency: 'EUR',
      originalGrossAmount: 30,
    })
    const part = await state.db.ksefInvoicePart.create({ data: {
      id: 'original-part', invoiceId: invoice.id, label: 'Oryginalna część', grossAmount: 123,
    } })
    await state.db.ksefInvoicePartTag.create({ data: { partId: part.id, tagId: 'tag-fixed' } })
    await state.db.ksefInvoicePartAllocation.create({ data: {
      id: 'original-allocation', partId: part.id, costCenterId: 'JAG', percent: 100,
    } })
    await state.db.costEvent.create({ data: {
      id: 'active-cost', source: 'MANUAL', sourceInvoiceId: invoice.id,
      eventDate: invoice.issueDate, supplierName: invoice.supplierName,
      supplierNip: invoice.supplierNip, reference: invoice.invoiceNumber,
      grossAmount: 123, currency: 'PLN', status: 'APPROVED', documentStatus: 'ACTIVE',
      createdById: 'admin',
    } })
    await state.db.ksefSupplierRule.create({ data: {
      id: 'existing-rule', supplierNamePattern: 'Dostawca', costCenterId: 'JAG', active: true,
    } })
    const before = await protectedDataSnapshot()
    const context = { params: Promise.resolve({ id: invoice.id }) }
    const calls = [
      () => EDIT_INVOICE(jsonRequest('http://localhost/api/finance/ksef/invoices/imported', 'PATCH', {
        costCenterId: 'GLOBAL', tagIds: ['tag-fixed'], notes: 'nie zapisuj',
      }), context),
      () => APPROVE_INVOICE(jsonRequest('http://localhost/api/finance/ksef/invoices/imported/approve', 'POST'), context),
      () => UNAPPROVE_INVOICE(jsonRequest('http://localhost/api/finance/ksef/invoices/imported/approve', 'DELETE'), context),
      () => REPLACE_PARTS(jsonRequest('http://localhost/api/finance/ksef/invoices/imported/parts', 'PUT', {
        parts: [{ label: 'Nowa', grossAmount: 123, tagIds: ['tag-fixed'], allocations: [{ costCenterId: 'GLOBAL', percent: 100 }] }],
      }), context),
      () => UPDATE_PAYMENT(jsonRequest('http://localhost/api/finance/ksef/invoices/imported/payment', 'PATCH', {
        paymentStatus: 'PAID', paidAt: '2026-09-11T10:00:00.000Z',
      }), context),
      () => CONVERT_CURRENCY(jsonRequest('http://localhost/api/finance/ksef/invoices/imported/currency-conversion', 'PATCH', {
        reportingGrossAmount: 130, reportingNetAmount: 105, reportingVatAmount: 25,
        currencyConversionNote: 'Nowy kurs testowy',
      }), context),
    ]

    for (const call of calls) await expectReviewConflict(await call(), draft.id)
    expect(await protectedDataSnapshot()).toEqual(before)
  })

  it('keeps a mixed bulk payment atomic when one selected invoice is imported', async () => {
    await state.db.ksefInvoice.create({ data: invoiceData('legacy', { status: 'APPROVED' }) })
    const { draft } = await createImportedInvoice('imported-bulk', 'APPROVED', { status: 'APPROVED' })
    const before = await protectedDataSnapshot()

    const response = await BULK_PAYMENT(jsonRequest(
      'http://localhost/api/finance/ksef/invoices/bulk-payment',
      'POST',
      { invoiceIds: ['legacy', 'imported-bulk'], paidDate: '2026-09-11' },
    ))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'INVOICE_IMPORT_REVIEW_REQUIRED',
      draftId: draft.id,
      error: expect.any(String),
      conflicts: [{ invoiceId: 'imported-bulk', draftId: draft.id }],
    })
    expect(await protectedDataSnapshot()).toEqual(before)
  })

  it('still lets a legacy invoice use the existing payment writer and response shape', async () => {
    await state.db.ksefInvoice.create({ data: invoiceData('legacy', { status: 'APPROVED' }) })

    const response = await UPDATE_PAYMENT(
      jsonRequest('http://localhost/api/finance/ksef/invoices/legacy/payment', 'PATCH', {
        paymentStatus: 'PAID', paidAt: '2026-09-11T10:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'legacy' }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ invoice: { id: 'legacy', paymentStatus: 'PAID' } })
    expect(await state.db.costAuditLog.findFirstOrThrow()).toMatchObject({
      invoiceId: 'legacy', action: 'payment.update', actorId: 'admin',
    })
  })

  it('rechecks the imported relation after waiting for an earlier SQLite writer', async () => {
    await state.db.ksefInvoice.create({ data: invoiceData('racing-legacy', { status: 'APPROVED' }) })
    const batch = await state.db.invoiceImportBatch.create({ data: { ownerUserId: 'admin' } })
    const attachment = await state.db.invoiceAttachment.create({ data: {
      storageKey: `${randomUUID()}.bin`,
      sha256: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      originalName: 'race.pdf', mimeType: 'application/pdf', byteSize: 100, pageCount: 1,
      state: 'READY', createdById: 'admin',
    } })
    const draft = await state.db.invoiceImportDraft.create({ data: {
      batchId: batch.id, attachmentId: attachment.id,
    } })
    let releaseWriter!: () => void
    let linked!: () => void
    const holdWriter = new Promise<void>((resolve) => { releaseWriter = resolve })
    const relationWritten = new Promise<void>((resolve) => { linked = resolve })
    const linking = withAiQueueMutation(other, () => new Date(), async (tx) => {
      await tx.invoiceImportDraft.update({ where: { id: draft.id }, data: { invoiceId: 'racing-legacy' } })
      linked()
      await holdWriter
    })
    await relationWritten

    const payment = UPDATE_PAYMENT(
      jsonRequest('http://localhost/api/finance/ksef/invoices/racing-legacy/payment', 'PATCH', {
        paymentStatus: 'PAID',
      }),
      { params: Promise.resolve({ id: 'racing-legacy' }) },
    )
    releaseWriter()
    await linking

    await expectReviewConflict(await payment, draft.id)
    expect(await state.db.ksefInvoice.findUniqueOrThrow({ where: { id: 'racing-legacy' } })).toMatchObject({
      paymentStatus: 'UNPAID', paidAt: null,
    })
    expect(await state.db.costAuditLog.count()).toBe(0)
  })
})

describe('supplier-rule legacy helpers', () => {
  async function seedRuleCandidates() {
    const imported = await createImportedInvoice('imported-new', 'ARCHIVED', { status: 'NEW' })
    const originalPart = await state.db.ksefInvoicePart.create({ data: {
      id: 'keep-imported-part', invoiceId: imported.invoice.id, label: 'Nie zmieniaj', grossAmount: 123,
    } })
    await state.db.ksefInvoicePartTag.create({ data: { partId: originalPart.id, tagId: 'tag-fixed' } })
    await state.db.ksefInvoicePartAllocation.create({ data: {
      id: 'keep-imported-allocation', partId: originalPart.id, costCenterId: 'JAG', percent: 100,
    } })
    await state.db.ksefInvoice.create({ data: invoiceData('legacy-new', { status: 'NEW' }) })
    const rule = await state.db.ksefSupplierRule.create({ data: {
      id: 'rule', supplierNamePattern: 'Dostawca', costCenterId: 'GLOBAL', active: true,
      tags: { create: { tagId: 'tag-fixed' } },
    }, include: { tags: true } })
    return { imported, rule }
  }

  it.each([
    ['single rule', async (rule: Awaited<ReturnType<typeof seedRuleCandidates>>['rule']) => applySupplierRuleToNewInvoices(state.db, rule)],
    ['rule set', async (rule: Awaited<ReturnType<typeof seedRuleCandidates>>['rule']) => applySupplierRulesToNewInvoices(state.db, [rule])],
  ] as const)('excludes imported NEW rows from %s selection and mutation', async (_label, applyRule) => {
    const { imported, rule } = await seedRuleCandidates()
    const importedBefore = await state.db.ksefInvoice.findUniqueOrThrow({ where: { id: imported.invoice.id } })

    expect(await applyRule(rule)).toBe(1)

    expect(await state.db.ksefInvoice.findUniqueOrThrow({ where: { id: 'legacy-new' } })).toMatchObject({
      status: 'MAPPED', costCenterId: 'GLOBAL', supplierRuleId: rule.id, ruleMatchStatus: 'MATCHED',
    })
    expect(await state.db.ksefInvoice.findUniqueOrThrow({ where: { id: imported.invoice.id } })).toEqual(importedBefore)
    expect(await state.db.ksefInvoicePart.findMany({ where: { invoiceId: imported.invoice.id } })).toEqual([
      expect.objectContaining({ id: 'keep-imported-part', label: 'Nie zmieniaj' }),
    ])
    expect(await state.db.ksefInvoicePartTag.findMany({ where: { partId: 'keep-imported-part' } })).toEqual([
      expect.objectContaining({ tagId: 'tag-fixed' }),
    ])
    expect(await state.db.ksefInvoicePartAllocation.findMany({ where: { partId: 'keep-imported-part' } })).toEqual([
      expect.objectContaining({ id: 'keep-imported-allocation', costCenterId: 'JAG', percent: 100 }),
    ])
  })
})
