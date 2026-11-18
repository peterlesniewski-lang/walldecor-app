// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from 'next-auth'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@/generated/prisma'
import type { FetchLike, PurchaseDocument } from '@/lib/finance/subiekt-bridge-client'

// Import of foreign (EU) purchase invoices from Subiekt GT on a FRESH database built from the real migration chain. Synthetic data only.

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, session: null as Session | null }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client } }))
vi.mock('next-auth', () => ({ getServerSession: async () => state.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { importSubiektForeignPurchases, reconcileSubiektPayments, warsawToday } from '@/lib/finance/subiekt-purchases'
import { GET as reconciliationRoute } from '@/app/api/finance/subiekt-purchases/reconciliation/route'
import { POST as importRoute } from '@/app/api/finance/subiekt-purchases/import/route'
import { POST as approveRoute } from '@/app/api/finance/ksef/invoices/[id]/approve/route'

let directory = ''
let db: PrismaClient
const NOW = new Date('2026-10-31T10:00:00Z')
const env: Record<string, string | undefined> = {
  SUBIEKT_BRIDGE_URL: 'https://bridge.test', SUBIEKT_BRIDGE_TOKEN: 'tok', SUBIEKT_PURCHASES_IMPORT_FROM: '2026-01-01',
}

const doc = (over: Partial<PurchaseDocument> = {}): PurchaseDocument => ({
  id: 30, type: 'FZ', number: 'FZ 1/MAG/10/2026', original_number: 'RE-2026-0042', issued_at: '2026-10-03', parent_id: null,
  supplier_name: 'Tapeten Fabrik GmbH', supplier_tax_id: 'DE123456789', currency: 'EUR', exchange_rate: 4.25,
  net_total: 4250, gross_total: 4250, ksef_number: null, payable: 4250, remaining: 4250, is_paid: false, due_date: '2026-10-17', ...over,
})

const bridgeWith = (rowsByMonth: Record<string, PurchaseDocument[]>): FetchLike => async (url) => {
  const from = new URL(url).searchParams.get('from') ?? ''
  const rows = rowsByMonth[from.slice(0, 7)] ?? []
  return new Response(JSON.stringify({ from, to: new URL(url).searchParams.get('to'), limit: 500, rows, truncated: false, total: { documents: rows.length } }), { status: 200 })
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'walldecor-subiekt-purchases-'))
  // Prisma 5 on Windows may fail to create a new SQLite file in migrate deploy.
  await writeFile(join(directory, 'subiekt.db'), '', { flag: 'wx' })
  const url = `file:${join(directory, 'subiekt.db')}`
  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('prisma/schema.prisma')], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 60_000,
  })
  db = new PrismaClient({ datasources: { db: { url } } })
  state.client = db
  await db.user.create({ data: {
    id: 'admin', email: 'admin@test.pl', name: 'Admin', passwordHash: 'x', role: 'ADMIN', isActive: true, mustChangePassword: false,
  } })
  await db.user.createMany({ data: [
    { id: 'employee', email: 'employee@test.pl', name: 'Pracownik', passwordHash: 'x', role: 'EMPLOYEE', isActive: true, mustChangePassword: false },
    { id: 'admin-pending', email: 'pending@test.pl', name: 'Nowy admin', passwordHash: 'x', role: 'ADMIN', isActive: true, mustChangePassword: true },
  ] })
  await db.costCenter.createMany({ data: [{ id: 'JAG', name: 'Jagiellońska' }, { id: 'PUL', name: 'Puławska' }, { id: 'GLOBAL', name: 'Firma' }] })
  await db.costTagGroup.create({ data: { id: 'grp', name: 'Grupa', slug: 'grupa', tags: { create: { id: 'tag-tapety', name: 'Tapety', slug: 'tapety' } } } })
}, 90_000)

beforeEach(async () => {
  await db.costAuditLog.deleteMany()
  await db.costEventPartAllocation.deleteMany()
  await db.costEventPartTag.deleteMany()
  await db.costEventPart.deleteMany()
  await db.costEvent.deleteMany()
  await db.ksefInvoicePartAllocation.deleteMany()
  await db.ksefInvoicePartTag.deleteMany()
  await db.ksefInvoicePart.deleteMany()
  await db.ksefInvoice.updateMany({ data: { correctsInvoiceId: null } })
  await db.ksefInvoice.deleteMany()
  await db.ksefSupplierRuleTag.deleteMany()
  await db.ksefSupplierRule.deleteMany()
  await db.appSetting.deleteMany()
})

afterEach(() => { vi.restoreAllMocks() })

afterAll(async () => {
  await db?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('importSubiektForeignPurchases', () => {
  it('should create an unpaid foreign invoice with source SUBIEKT and PLN amounts', async () => {
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    expect(result).toMatchObject({ ok: true, created: 1, alreadyInApp: 0, skippedDomestic: 0 })
    const invoice = await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:30' } })
    expect(invoice).toMatchObject({
      source: 'SUBIEKT', supplierName: 'Tapeten Fabrik GmbH', supplierNip: 'DE123456789', invoiceNumber: 'RE-2026-0042',
      currency: 'PLN', grossAmount: 4250, netAmount: 4250, vatAmount: 0, paymentStatus: 'UNPAID', status: 'NEW', documentStatus: 'ACTIVE',
    })
    expect(invoice.currencyConversionNote).toBe('Przeliczone w Subiekcie GT: EUR po kursie 4,2500 (FZ 1/MAG/10/2026).')
    expect(invoice.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-17')
  })

  it('should record the outcome in AppSetting', async () => {
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    const settings = await db.appSetting.findMany({ orderBy: { key: 'asc' } })
    expect(settings.map((s) => [s.key, s.value])).toEqual([
      ['subiekt_purchases.backfill_done', 'true'],
      ['subiekt_purchases.last_import_at', NOW.toISOString()],
      ['subiekt_purchases.last_import_message', 'Faktury UE z Subiekta: dodano 1, już w aplikacji 0, niejednoznaczne 0, krajowe pominięte 0.'],
    ])
  })

  it('should be idempotent on a second run', async () => {
    const fetchImpl = bridgeWith({ '2026-10': [doc()] })
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl })
    const second = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl })
    expect([second.ok && second.created, second.ok && second.alreadyInApp, await db.ksefInvoice.count()]).toEqual([0, 1, 1])
  })

  it('should not duplicate an EU invoice already entered manually and must not modify it', async () => {
    const manual = await db.ksefInvoice.create({ data: { supplierName: 'Tapeten', supplierNip: '123456789', invoiceNumber: 're-2026-0042', issueDate: new Date('2026-10-03'), grossAmount: 4249.9, currency: 'PLN' } })
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    expect(result).toMatchObject({ ok: true, created: 0, alreadyInApp: 1 })
    expect(await db.ksefInvoice.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({ externalId: null, grossAmount: 4249.9, source: 'MANUAL' })
  })

  it('should not create anything for an ambiguous document', async () => {
    await db.ksefInvoice.createMany({ data: [
      { supplierName: 'Tapeten', supplierNip: '123456789', invoiceNumber: 'RE-2026-0042', issueDate: new Date('2026-10-03'), grossAmount: 4250 },
      { supplierName: 'Tapeten', supplierNip: 'DE123456789', invoiceNumber: 'RE-2026-0042', issueDate: new Date('2026-10-03'), grossAmount: 4250 },
    ] })
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    expect([result.ok && result.ambiguous, result.ok && result.created, await db.ksefInvoice.count()]).toEqual([1, 0, 2])
  })

  it('should not duplicate a manual invoice entered without NIP and report the document as ambiguous', async () => {
    await db.ksefInvoice.create({ data: { supplierName: 'Tapeten', supplierNip: null, invoiceNumber: 'RE-2026-0042', issueDate: new Date('2026-10-06'), grossAmount: 4250 } })
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    expect([result.ok && result.created, result.ok && result.ambiguous, await db.ksefInvoice.count()]).toEqual([0, 1, 1])
  })

  it('should skip domestic PLN invoices', async () => {
    const domestic = doc({ id: 32, currency: 'PLN', supplier_tax_id: '5260000000', original_number: 'FV 10/10/2026' })
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [domestic] }) })
    expect([result.ok && result.skippedDomestic, await db.ksefInvoice.count()]).toEqual([1, 0])
  })

  it('should import a paid invoice as PAID and a KFZ as a correction linked to its FZ', async () => {
    const kfz = doc({ id: 33, type: 'KFZ', number: 'KFZ 1/MAG/10/2026', original_number: 'RE-2026-0042-K', parent_id: 30, net_total: -425, gross_total: -425, payable: null, remaining: null, is_paid: null, due_date: null })
    // KFZ listed before its FZ: the service must still create the FZ first.
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [kfz, doc({ remaining: 0, is_paid: true })] }) })
    const fz = await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:30' } })
    const correction = await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:33' } })
    expect([fz.paymentStatus, fz.paidAt, correction.documentStatus, correction.correctsInvoiceId]).toEqual(['PAID', null, 'CORRECTION', fz.id])
  })

  it('should apply a matching supplier rule', async () => {
    await db.ksefSupplierRule.create({ data: { supplierNip: '123456789', costCenterId: 'PUL', active: true } })
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    expect(await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:30' } })).toMatchObject({ status: 'MAPPED', ruleMatchStatus: 'MATCHED', costCenterId: 'PUL' })
  })

  it('should create a tagged part when the matching supplier rule has tags', async () => {
    await db.ksefSupplierRule.create({ data: { supplierNip: '123456789', costCenterId: 'PUL', active: true, tags: { create: { tagId: 'tag-tapety' } } } })
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    const invoice = await db.ksefInvoice.findUniqueOrThrow({
      where: { externalId: 'subiekt:30' }, include: { parts: { include: { tags: true, allocations: true } } },
    })
    expect(invoice.parts.map((part) => ({
      label: part.label, grossAmount: part.grossAmount, tags: part.tags.map((t) => t.tagId), allocations: part.allocations.map((a) => [a.costCenterId, a.percent]),
    }))).toEqual([{ label: 'RE-2026-0042', grossAmount: 4250, tags: ['tag-tapety'], allocations: [['PUL', 100]] }])
  })

  it('should skip invoices issued before SUBIEKT_PURCHASES_IMPORT_FROM', async () => {
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env: { ...env, SUBIEKT_PURCHASES_IMPORT_FROM: '2026-10-05' }, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    // first run asks the bridge for 2026-10-05..2026-10-31 only; the fake ignores `from`, so the service must also filter rows
    expect([result.ok && result.created, await db.ksefInvoice.count()]).toEqual([0, 0])
  })

  it('should refuse to import without SUBIEKT_PURCHASES_IMPORT_FROM', async () => {
    const { SUBIEKT_PURCHASES_IMPORT_FROM: _omit, ...withoutFloor } = env
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env: withoutFloor, fetchImpl: bridgeWith({}) })
    expect(result.ok ? null : result.kind).toBe('not_configured')
  })

  it('should report not_configured when the bridge URL is missing', async () => {
    const { SUBIEKT_BRIDGE_URL: _omit, ...withoutUrl } = env
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env: withoutUrl, fetchImpl: bridgeWith({}) })
    expect(result.ok ? null : result.kind).toBe('not_configured')
  })

  it('should backfill from IMPORT_FROM on the first run and read only 60 days back afterwards', async () => {
    const requested: string[] = []
    const spy: FetchLike = async (url) => {
      const params = new URL(url).searchParams
      requested.push(`${params.get('from')}..${params.get('to')}`)
      return new Response(JSON.stringify({ from: params.get('from'), to: params.get('to'), limit: 500, rows: [], truncated: false, total: { documents: 0 } }), { status: 200 })
    }
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: spy })
    expect([requested[0], requested.at(-1), requested.length]).toEqual(['2026-01-01..2026-01-31', '2026-10-01..2026-10-31', 10])
    requested.length = 0
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: spy })
    // 2026-10-31 − 60 days = 2026-09-01
    expect(requested).toEqual(['2026-09-01..2026-09-30', '2026-10-01..2026-10-31'])
  })

  it('should not mark the backfill done when the first run fails', async () => {
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: async () => new Response('{}', { status: 503 }) })
    expect(await db.appSetting.findUnique({ where: { key: 'subiekt_purchases.backfill_done' } })).toBeNull()
  })

  it('should write nothing when any month fails', async () => {
    const failing: FetchLike = async (url) => new URL(url).searchParams.get('from')?.startsWith('2026-10')
      ? new Response('{}', { status: 503 })
      : new Response(JSON.stringify({ from: '2026-01-01', to: '2026-01-31', limit: 500, rows: [doc({ id: 40, issued_at: '2026-01-10', original_number: 'RE-2026-0001' })], truncated: false, total: { documents: 1 } }), { status: 200 })
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: failing })
    expect([result.ok, result.ok ? null : result.kind, await db.ksefInvoice.count()]).toEqual([false, 'unavailable', 0])
  })
  it('should never auto-classify a KFZ correction, even when a tagged rule matches', async () => {
    await db.ksefSupplierRule.create({ data: { supplierNip: '123456789', costCenterId: 'PUL', active: true, tags: { create: { tagId: 'tag-tapety' } } } })
    const kfz = doc({ id: 33, type: 'KFZ', number: 'KFZ 1/MAG/10/2026', original_number: 'RE-2026-0042-K', parent_id: 30, net_total: -425, gross_total: -425 })
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc(), kfz] }) })
    const correction = await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:33' }, include: { parts: true } })
    expect({ status: correction.status, rule: correction.ruleMatchStatus, costCenterId: correction.costCenterId, supplierRuleId: correction.supplierRuleId, parts: correction.parts.length })
      .toEqual({ status: 'NEW', rule: 'NO_RULE', costCenterId: null, supplierRuleId: null, parts: 0 })
  })

  it('should link a KFZ to the manual invoice its FZ was matched with', async () => {
    const manual = await db.ksefInvoice.create({ data: { supplierName: 'Tapeten', supplierNip: '123456789', invoiceNumber: 'RE-2026-0042', issueDate: new Date('2026-10-03'), grossAmount: 4250 } })
    const kfz = doc({ id: 33, type: 'KFZ', number: 'KFZ 1/MAG/10/2026', original_number: 'RE-2026-0042-K', parent_id: 30, net_total: -425, gross_total: -425 })
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc(), kfz] }) })
    expect((await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:33' } })).correctsInvoiceId).toBe(manual.id)
  })

  it('should match a manual invoice dated just before the fetched range', async () => {
    await db.ksefInvoice.create({ data: { supplierName: 'Tapeten', supplierNip: '123456789', invoiceNumber: 'RE-2026-0042', issueDate: new Date('2026-09-30'), grossAmount: 4250 } })
    const result = await importSubiektForeignPurchases(db, {
      actorId: 'admin', now: NOW, env: { ...env, SUBIEKT_PURCHASES_IMPORT_FROM: '2026-10-01' }, fetchImpl: bridgeWith({ '2026-10': [doc({ issued_at: '2026-10-01' })] }),
    })
    expect([result.ok && result.alreadyInApp, await db.ksefInvoice.count()]).toEqual([1, 1])
  })

  it('should not create a duplicate inserted concurrently after matching', async () => {
    const original = db.$transaction.bind(db)
    let raced = false
    // The first write transaction starts after the match snapshot: simulate a manual entry racing the import.
    vi.spyOn(db, '$transaction').mockImplementation((async (...args: Parameters<typeof original>) => {
      if (!raced) {
        raced = true
        await db.ksefInvoice.create({ data: { supplierName: 'Tapeten', supplierNip: 'DE 123 456 789', invoiceNumber: 're-2026-0042 ', issueDate: new Date('2026-10-04'), grossAmount: 4250 } })
      }
      return original(...args)
    }) as typeof db.$transaction)
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    expect([result.ok && result.created, await db.ksefInvoice.count()]).toEqual([0, 1])
  })

  it('should use the tax id as the supplier name when Subiekt has no name', async () => {
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc({ supplier_name: null })] }) })
    expect((await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:30' } })).supplierName).toBe('DE123456789')
  })

  it('should fall back to a generic supplier name without name and tax id', async () => {
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc({ supplier_name: null, supplier_tax_id: null })] }) })
    expect((await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:30' } })).supplierName).toBe('Nieznany dostawca')
  })

  it('should refuse a non-admin actor before contacting the bridge', async () => {
    const fetchImpl = vi.fn(bridgeWith({ '2026-10': [doc()] }))
    const result = await importSubiektForeignPurchases(db, { actorId: 'employee', now: NOW, env, fetchImpl })
    expect([result.ok ? null : result.kind, result.ok ? null : result.error, fetchImpl.mock.calls.length, await db.ksefInvoice.count()])
      .toEqual(['forbidden', 'Brak uprawnień administratora.', 0, 0])
  })

  it('should refuse an admin who must change the password', async () => {
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin-pending', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    expect(result.ok ? null : result.kind).toBe('forbidden')
  })

  it('should stop writing when the actor loses admin rights during the import', async () => {
    await db.user.update({ where: { id: 'employee' }, data: { role: 'ADMIN' } })
    const fetchImpl: FetchLike = async (url) => {
      // Demote after the up-front check, while the documents are being fetched.
      await db.user.update({ where: { id: 'employee' }, data: { role: 'EMPLOYEE' } })
      return bridgeWith({ '2026-10': [doc()] })(url, {})
    }
    const result = await importSubiektForeignPurchases(db, { actorId: 'employee', now: NOW, env, fetchImpl })
    expect([result.ok ? null : result.kind, await db.ksefInvoice.count()]).toEqual(['forbidden', 0])
  })

  it('should report an unexpected write error without internals and keep invoices created before it', async () => {
    const original = db.$transaction.bind(db)
    let calls = 0
    vi.spyOn(db, '$transaction').mockImplementation(((...args: Parameters<typeof original>) => {
      calls += 1
      return calls === 2 ? Promise.reject(new Error('SQLITE internal detail')) : original(...args)
    }) as typeof db.$transaction)
    const second = doc({ id: 31, number: 'FZ 2/MAG/10/2026', original_number: 'RE-2026-0043' })
    const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc(), second] }) })
    const message = await db.appSetting.findUniqueOrThrow({ where: { key: 'subiekt_purchases.last_import_message' } })
    expect({
      kind: result.ok ? null : result.kind,
      leaks: result.ok ? null : result.error.includes('SQLITE'),
      count: await db.ksefInvoice.count(),
      message: message.value,
      backfill: await db.appSetting.findUnique({ where: { key: 'subiekt_purchases.backfill_done' } }),
    }).toEqual({
      kind: 'unavailable', leaks: false, count: 1,
      message: 'Błąd: Import faktur UE przerwany nieoczekiwanym błędem po dodaniu 1 faktur. Ponowne uruchomienie dokończy import bez duplikatów.',
      backfill: null,
    })
  })
})

describe('payment reconciliation and import routes', () => {
  // requireFinanceAdmin's return type makes handlers `Response | undefined`; at runtime they always respond.
  const call = async (handler: () => Promise<Response | undefined>) => (await handler()) as Response
  const asRole = (id: string, role: 'ADMIN' | 'MANAGER') => { state.session = { user: { id, role, name: id, email: `${id}@test.pl` }, expires: '' } as Session }
  const stubBridge = (rowsByMonth: Record<string, PurchaseDocument[]>) => {
    vi.stubEnv('SUBIEKT_BRIDGE_URL', 'https://bridge.test'); vi.stubEnv('SUBIEKT_BRIDGE_TOKEN', 'tok')
    vi.stubGlobal('fetch', (url: string) => bridgeWith(rowsByMonth)(url, {}))
  }
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); state.session = null })

  it('should list an invoice paid in the app and open in Subiekt', async () => {
    await db.ksefInvoice.create({ data: { supplierName: 'Hurt', supplierNip: '5260000000', invoiceNumber: 'FV 10/10/2026', externalId: 'K-3', issueDate: new Date('2026-10-10'), grossAmount: 123, paymentStatus: 'PAID', paidAt: new Date('2026-10-20') } })
    const domestic = doc({ id: 32, currency: 'PLN', supplier_tax_id: '5260000000', original_number: 'FV 10/10/2026', ksef_number: 'K-3', gross_total: 123, payable: 123, remaining: 123 })
    const result = await reconcileSubiektPayments(db, { now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [domestic] }) })
    expect(result.ok && result.settleInSubiekt.map((r) => [r.subiektNumber, r.originalNumber, r.remaining, r.paidAt])).toEqual([['FZ 1/MAG/10/2026', 'FV 10/10/2026', 123, '2026-10-20']])
  })

  it('should return 403 for MANAGER', async () => {
    asRole('manager', 'MANAGER')
    expect((await call(reconciliationRoute)).status).toBe(403)
  })

  it('should return 200 with the settlement list for ADMIN', async () => {
    asRole('admin', 'ADMIN'); stubBridge({})
    const response = await call(reconciliationRoute)
    expect([response.status, (await response.json()).settleInSubiekt]).toEqual([200, []])
  })

  it('should return 503 with a Polish message when the bridge is down', async () => {
    asRole('admin', 'ADMIN')
    vi.stubEnv('SUBIEKT_BRIDGE_URL', 'https://bridge.test'); vi.stubEnv('SUBIEKT_BRIDGE_TOKEN', 'tok')
    vi.stubGlobal('fetch', async () => { throw new TypeError('down') })
    const response = await call(reconciliationRoute)
    expect([response.status, (await response.json()).error]).toEqual([503, 'Mostek Subiekt jest niedostępny. Sprawdź, czy komputer z bazą Subiekta jest włączony i połączony z siecią.'])
  })

  it('should return 409 from reconciliation when the bridge is not configured', async () => {
    asRole('admin', 'ADMIN')
    vi.stubEnv('SUBIEKT_BRIDGE_URL', ''); vi.stubEnv('SUBIEKT_BRIDGE_TOKEN', '')
    expect((await call(reconciliationRoute)).status).toBe(409)
  })

  it('should import foreign invoices through the route for ADMIN', async () => {
    const today = warsawToday(new Date())
    asRole('admin', 'ADMIN'); stubBridge({ [today.slice(0, 7)]: [doc({ issued_at: `${today.slice(0, 7)}-01` })] })
    vi.stubEnv('SUBIEKT_PURCHASES_IMPORT_FROM', '2026-01-01')
    const response = await call(importRoute)
    const body = await response.json()
    expect([response.status, body.created, await db.ksefInvoice.count()]).toEqual([200, 1, 1])
  })

  it('should return 409 from import when import is not configured', async () => {
    asRole('admin', 'ADMIN'); stubBridge({})
    vi.stubEnv('SUBIEKT_PURCHASES_IMPORT_FROM', '')
    expect((await call(importRoute)).status).toBe(409)
  })

  it('should approve an imported Subiekt invoice into a PLN cost event', async () => {
    await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
    const invoice = await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:30' } })
    asRole('admin', 'ADMIN')
    const response = await approveRoute(new NextRequest(`http://localhost/api/finance/ksef/invoices/${invoice.id}/approve`, { method: 'POST' }), { params: Promise.resolve({ id: invoice.id }) })
    const event = await db.costEvent.findFirst({ where: { sourceInvoiceId: invoice.id } })
    expect({ status: response.status, event: event && { source: event.source, currency: event.currency, grossAmount: event.grossAmount } })
      .toEqual({ status: 200, event: { source: 'SUBIEKT', currency: 'PLN', grossAmount: 4250 } })
  })

  it('should return 403 from import for MANAGER', async () => {
    asRole('manager', 'MANAGER')
    expect((await call(importRoute)).status).toBe(403)
  })
})
