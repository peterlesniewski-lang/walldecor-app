// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET, POST } from '@/app/api/finance/break-even/settings/route'

const { db, auth } = vi.hoisted(() => {
  const model = () => Object.fromEntries(['findMany', 'findUnique', 'findFirst', 'create', 'update', 'upsert', 'delete'].map((method) => [method, vi.fn()]))
  const db = { breakEvenMarginSetting: model(), breakEvenFixedCost: model(), breakEvenFixedCostMatch: model(), breakEvenRevenueBasis: model(), costEventPart: model(), costCenter: model(), revenue: model(), costAuditLog: model(), $transaction: vi.fn() }
  return { db, auth: vi.fn() }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/finance/finance-access', () => ({ requireFinanceAdmin: auth }))

function request(body: unknown) {
  return new NextRequest('http://localhost/api/finance/break-even/settings', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}
const period = { year: 2026, month: 9 }
const fixed = { id: 'fixed-1', costCenterId: 'JAG', name: 'Czynsz', expectedNetAmount: 2000, supplierNip: null, supplierName: null, effectiveFrom: '2026-01', effectiveTo: null, active: true }
const source = { tags: [], id: 'part-1', eventId: 'event-1', grossAmount: 2460, allocations: [{ costCenterId: 'JAG', percent: 100 }], event: { id: 'event-1', source: 'KSEF', sourceInvoiceId: 'invoice-1', sourceInvoice: { status: 'APPROVED', documentStatus: 'ACTIVE', invoiceImportDraft: null }, status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'PLN', eventDate: new Date('2026-09-08T00:00:00Z'), netAmount: 2000, grossAmount: 2460, parts: [{ id: 'part-1', label: 'Czynsz', grossAmount: 2460, tags: [], allocations: [{ costCenterId: 'JAG', percent: 100 }] }], supplierNip: null } }

beforeEach(() => {
  vi.resetAllMocks()
  auth.mockResolvedValue({ session: { user: { id: 'admin-1', role: 'ADMIN' } } })
  db.$transaction.mockImplementation(async (fn) => fn(db))
  db.costCenter.findUnique.mockResolvedValue({ id: 'JAG' })
  db.breakEvenFixedCost.findUnique.mockResolvedValue(fixed)
  db.breakEvenFixedCostMatch.findUnique.mockResolvedValue(null)
  db.breakEvenFixedCostMatch.findMany.mockResolvedValue([])
  db.costEventPart.findUnique.mockResolvedValue(source)
  db.costAuditLog.create.mockResolvedValue({ id: 'audit-1' })
  db.breakEvenFixedCostMatch.create.mockImplementation(async ({ data }) => ({ id: 'match-1', ...data }))
  db.breakEvenFixedCost.create.mockImplementation(async ({ data }) => ({ id: 'fixed-1', ...data }))
  db.breakEvenFixedCost.update.mockImplementation(async ({ data }) => ({ ...fixed, ...data }))
})

describe('break-even settings access and input', () => {
  it.each([401, 403])('rejects GET and POST with auth status %s before reading or writing', async (status) => {
    auth.mockResolvedValue({ error: NextResponse.json({ error: 'Odmowa' }, { status }) })
    expect((await GET(new NextRequest('http://localhost/api/finance/break-even/settings?year=2026&month=9'))).status).toBe(status)
    expect((await POST(request({ action: 'margin.delete', id: 'x' }))).status).toBe(status)
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.breakEvenMarginSetting.findMany).not.toHaveBeenCalled()
  })
  it('rejects malformed JSON and invalid query months without writes', async () => {
    expect((await POST(new NextRequest('http://localhost/api', { method: 'POST', body: '{' }))).status).toBe(400)
    expect((await GET(new NextRequest('http://localhost/api/finance/break-even/settings?year=2026&month=13'))).status).toBe(400)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it.each([
    { action: 'margin.save', margin: 0, effectiveFrom: '2026-09' },
    { action: 'margin.save', margin: 1.01, effectiveFrom: '2026-09' },
    { action: 'margin.save', margin: .3, effectiveFrom: '2026-13' },
    { action: 'fixed.save', ...fixed, expectedNetAmount: -1 },
    { action: 'fixed.save', ...fixed, expectedNetAmount: 1.001 },
    { action: 'fixed.save', ...fixed, costCenterId: 'GLOBAL' },
    { action: 'fixed.save', ...fixed, effectiveTo: '2025-12' },
    { action: 'revenue.save', ...period, costCenterId: 'JAG', netAmount: null },
    { action: 'revenue.save', ...period, costCenterId: 'JAG', netAmount: 123, grossAmountSnapshot: 123 },
    { action: 'match.save', ...period, fixedCostId: 'fixed-1', costEventPartId: 'part-1', actualNetAmount: 1.001 },
  ])('rejects invalid action data %#', async (body) => {
    expect((await POST(request(body))).status).toBe(400)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('serializes margin effective month for the month editor contract', async () => {
    db.breakEvenMarginSetting.findMany.mockResolvedValue([{ id: 'margin-1', margin: .3, effectiveFrom: new Date('2026-09-01T00:00:00Z'), note: null }])
    db.breakEvenFixedCost.findMany.mockResolvedValue([])
    db.breakEvenRevenueBasis.findMany.mockResolvedValue([])
    const response = await GET(new NextRequest('http://localhost/api/finance/break-even/settings?year=2026&month=9'))
    expect((await response.json()).margins[0].effectiveFrom).toBe('2026-09')
  })
  it('reads every configuration type with selected-period scope', async () => {
    for (const name of ['breakEvenMarginSetting', 'breakEvenFixedCost', 'breakEvenRevenueBasis', 'breakEvenFixedCostMatch'] as const) db[name].findMany.mockResolvedValue([])
    const response = await GET(new NextRequest('http://localhost/api/finance/break-even/settings?year=2026&month=9'))
    expect(await response.json()).toEqual({ margins: [], fixedCosts: [], revenueBases: [], matches: [] })
    expect(db.breakEvenRevenueBasis.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: period }))
  })
})

describe('audited margin and fixed-cost CRUD', () => {
  it('creates a company margin at the first UTC day and audits within the transaction', async () => {
    db.breakEvenMarginSetting.findUnique.mockResolvedValue(null)
    db.breakEvenMarginSetting.create.mockImplementation(async ({ data }) => ({ id: 'margin-1', ...data }))
    expect((await POST(request({ action: 'margin.save', margin: .35, effectiveFrom: '2026-09', note: 'Nowa marża' }))).status).toBe(200)
    expect(db.breakEvenMarginSetting.create).toHaveBeenCalledWith({ data: { margin: .35, effectiveFrom: new Date('2026-09-01T00:00:00Z'), note: 'Nowa marża', createdById: 'admin-1' } })
    expect(db.costAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'break-even.margin.save', actorId: 'admin-1', afterJson: expect.stringContaining('margin-1') }) })
  })
  it('updates and deletes an existing margin, rejecting a missing ID', async () => {
    db.breakEvenMarginSetting.findUnique.mockResolvedValue({ id: 'margin-1', margin: .3, effectiveFrom: new Date('2026-09-01') })
    db.breakEvenMarginSetting.update.mockResolvedValue({ id: 'margin-1', margin: .4 })
    expect((await POST(request({ action: 'margin.save', id: 'margin-1', margin: .4, effectiveFrom: '2026-09' }))).status).toBe(200)
    expect((await POST(request({ action: 'margin.delete', id: 'margin-1' }))).status).toBe(200)
    expect(db.breakEvenMarginSetting.delete).toHaveBeenCalledWith({ where: { id: 'margin-1' } })
    db.breakEvenMarginSetting.findUnique.mockResolvedValue(null)
    expect((await POST(request({ action: 'margin.delete', id: 'missing' }))).status).toBe(404)
  })
  it('creates, edits and archives a fixed cost', async () => {
    const body = { action: 'fixed.save', name: 'Czynsz', costCenterId: 'JAG', expectedNetAmount: 2000, effectiveFrom: '2026-01', supplierNip: 'PL 123-456-78-90' }
    expect((await POST(request(body))).status).toBe(200)
    expect(db.breakEvenFixedCost.create).toHaveBeenCalledWith({ data: expect.objectContaining({ supplierNip: 'PL1234567890', createdById: 'admin-1', active: true }) })
    expect((await POST(request({ ...body, id: 'fixed-1', expectedNetAmount: 2200 }))).status).toBe(200)
    expect((await POST(request({ action: 'fixed.archive', id: 'fixed-1' }))).status).toBe(200)
    expect(db.breakEvenFixedCost.update).toHaveBeenLastCalledWith({ where: { id: 'fixed-1' }, data: { active: false } })
  })
  it('prevents salon or period edits that invalidate existing matches', async () => {
    db.breakEvenFixedCostMatch.findMany.mockResolvedValue([{ year: 2026, month: 9, costCenterId: 'JAG' }])
    const response = await POST(request({ action: 'fixed.save', id: fixed.id, name: fixed.name, costCenterId: 'PUL', expectedNetAmount: 2000, effectiveFrom: '2026-01' }))
    expect(response.status).toBe(409)
    expect(db.breakEvenFixedCost.update).not.toHaveBeenCalled()
  })
})

describe('net revenue companion', () => {
  it('snapshots existing gross revenue, upserts explicit net, then allows deletion', async () => {
    db.revenue.findMany.mockResolvedValue([{ amount: 1230 }, { amount: 246 }])
    db.breakEvenRevenueBasis.findUnique.mockResolvedValue(null)
    db.breakEvenRevenueBasis.upsert.mockResolvedValue({ id: 'basis-1', netAmount: 1200, grossAmountSnapshot: 1476 })
    expect((await POST(request({ action: 'revenue.save', ...period, costCenterId: 'JAG', netAmount: 1200 }))).status).toBe(200)
    expect(db.breakEvenRevenueBasis.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ grossAmountSnapshot: 1476, netAmount: 1200 }) }))
    db.breakEvenRevenueBasis.findUnique.mockResolvedValue({ id: 'basis-1' })
    expect((await POST(request({ action: 'revenue.delete', id: 'basis-1' }))).status).toBe(200)
    expect(db.breakEvenRevenueBasis.delete).toHaveBeenCalledWith({ where: { id: 'basis-1' } })
  })
  it('rejects zero net against positive gross, accepts explicit zero gross and net', async () => {
    db.revenue.findMany.mockResolvedValue([{ amount: 123 }])
    expect((await POST(request({ action: 'revenue.save', ...period, costCenterId: 'JAG', netAmount: 0 }))).status).toBe(400)
    db.revenue.findMany.mockResolvedValue([{ amount: 0 }])
    db.breakEvenRevenueBasis.findUnique.mockResolvedValue(null)
    db.breakEvenRevenueBasis.upsert.mockResolvedValue({ id: 'basis-zero' })
    expect((await POST(request({ action: 'revenue.save', ...period, costCenterId: 'JAG', netAmount: 0 }))).status).toBe(200)
  })
  it.each([{ rows: [] }, { rows: [{ amount: 100 }] }])('rejects absent gross or net above gross', async ({ rows }) => {
    db.revenue.findMany.mockResolvedValue(rows)
    expect((await POST(request({ action: 'revenue.save', ...period, costCenterId: 'JAG', netAmount: 101 }))).status).toBe(400)
    expect(db.breakEvenRevenueBasis.upsert).not.toHaveBeenCalled()
  })
})

describe('explicit invoice replacement', () => {
  const body = { action: 'match.save', ...period, fixedCostId: 'fixed-1', costEventPartId: 'part-1' }
  it('creates one explicit salon part link and supports override update and unlink', async () => {
    expect((await POST(request(body))).status).toBe(200)
    expect(db.breakEvenFixedCostMatch.create).toHaveBeenCalledWith({ data: expect.objectContaining({ costCenterId: 'JAG', actualNetAmount: null, fixedCostId: 'fixed-1' }) })
    db.breakEvenFixedCostMatch.findUnique.mockResolvedValue({ id: 'match-1', fixedCostId: 'fixed-1', ...period })
    db.breakEvenFixedCostMatch.update.mockResolvedValue({ id: 'match-1', actualNetAmount: 1900 })
    expect((await POST(request({ ...body, actualNetAmount: 1900 }))).status).toBe(200)
    expect(db.breakEvenFixedCostMatch.update).toHaveBeenCalled()
    expect((await POST(request({ action: 'match.delete', id: 'match-1' }))).status).toBe(200)
    expect(db.breakEvenFixedCostMatch.delete).toHaveBeenCalledWith({ where: { id: 'match-1' } })
  })
  it.each([
    { ...source, event: { ...source.event, status: 'VOID' } },
    { ...source, event: { ...source.event, documentStatus: 'VOID' } },
    { ...source, event: { ...source.event, currency: 'EUR' } },
    { ...source, event: { ...source.event, eventDate: new Date('2026-08-08') } },
    { ...source, event: { ...source.event, sourceInvoiceId: null, sourceInvoice: null } },
    { ...source, allocations: [{ costCenterId: 'PUL', percent: 100 }] },
    { ...source, event: { ...source.event, netAmount: null } },
  ])('rejects ineligible source %#', async (part) => {
    db.costEventPart.findUnique.mockResolvedValue(part)
    expect((await POST(request(body))).status).toBe(400)
    expect(db.breakEvenFixedCostMatch.create).not.toHaveBeenCalled()
  })
  it.each([
    { ...source.event, parts: [{ ...source.event.parts[0], grossAmount: 2000 }] },
    { ...source.event, parts: [{ ...source.event.parts[0], allocations: [{ costCenterId: 'JAG', percent: 50 }] }] },
    { ...source.event, netAmount: 2461 },
    { ...source.event, netAmount: -2000 },
  ])('rejects invalid invoice amounts or allocation without persisting a hidden match %#', async (event) => {
    db.costEventPart.findUnique.mockResolvedValue({ ...source, event })
    expect((await POST(request(body))).status).toBe(400)
    expect(db.breakEvenFixedCostMatch.create).not.toHaveBeenCalled()
  })
  it('derives net from known VAT consistently with the source list', async () => {
    db.costEventPart.findUnique.mockResolvedValue({ ...source, event: { ...source.event, netAmount: null, vatAmount: 460 } })
    expect((await POST(request(body))).status).toBe(200)
  })
  it('allows explicit net override when invoice net is unknown', async () => {
    db.costEventPart.findUnique.mockResolvedValue({ ...source, event: { ...source.event, netAmount: null } })
    expect((await POST(request({ ...body, actualNetAmount: 2000 }))).status).toBe(200)
  })
  it('accepts signed correction overrides and rejects an opposite sign', async () => {
    db.costEventPart.findUnique.mockResolvedValue({ ...source, grossAmount: -123, event: { ...source.event, grossAmount: -123, netAmount: -100, parts: [{ ...source.event.parts[0], grossAmount: -123 }], documentStatus: 'CORRECTION', sourceInvoice: { ...source.event.sourceInvoice, documentStatus: 'CORRECTION' } } })
    expect((await POST(request({ ...body, actualNetAmount: -100 }))).status).toBe(200)
    expect((await POST(request({ ...body, actualNetAmount: 100 }))).status).toBe(400)
    expect((await POST(request({ ...body, actualNetAmount: -124 }))).status).toBe(400)
  })
  it.each(['goods', 'cogs', 'variable', 'payroll', 'one-off'])('rejects the %s category as recurring fixed overhead', async (slug) => {
    db.costEventPart.findUnique.mockResolvedValue({ ...source, tags: [{ tag: { slug } }] })
    expect((await POST(request(body))).status).toBe(400)
    expect(db.breakEvenFixedCostMatch.create).not.toHaveBeenCalled()
  })
  it('maps a concurrent unique conflict to 409', async () => {
    db.breakEvenFixedCostMatch.create.mockRejectedValue({ code: 'P2002' })
    expect((await POST(request(body))).status).toBe(409)
    expect(db.costAuditLog.create).not.toHaveBeenCalled()
  })
  it('rejects a duplicate link assigned to another template', async () => {
    db.breakEvenFixedCostMatch.findUnique.mockResolvedValue({ id: 'other', fixedCostId: 'other', ...period })
    expect((await POST(request(body))).status).toBe(409)
    expect(db.breakEvenFixedCostMatch.create).not.toHaveBeenCalled()
  })
  it('rejects an inactive template, mismatched NIP, and net greater than allocated gross', async () => {
    db.breakEvenFixedCost.findUnique.mockResolvedValue({ ...fixed, active: false })
    expect((await POST(request(body))).status).toBe(400)
    db.breakEvenFixedCost.findUnique.mockResolvedValue({ ...fixed, supplierNip: '9876543210' })
    expect((await POST(request(body))).status).toBe(400)
    db.breakEvenFixedCost.findUnique.mockResolvedValue(fixed)
    expect((await POST(request({ ...body, actualNetAmount: 2461 }))).status).toBe(400)
  })
})
