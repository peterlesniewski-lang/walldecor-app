// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { PrismaClient } from '@/generated/prisma'

// Cost contracts on a FRESH database built from the real migration chain. Synthetic data only.

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const mockSession = vi.mocked(getServerSession)

const workspace = process.cwd()
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-contracts-'))
const databaseUrl = `file:${path.join(directory, 'contracts.db')}`

let prisma: PrismaClient
let routes: typeof import('@/app/api/finance/cost-contracts/route')
let contractRoute: typeof import('@/app/api/finance/cost-contracts/[id]/route')
let data: typeof import('@/lib/finance/cost-contracts-data')
let contracts: typeof import('@/lib/finance/cost-contracts')
let contractId: string

const as = (role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE') => mockSession.mockResolvedValue({ user: { id: 'admin-1', role } } as Session)
const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const patch = (body: unknown) => contractRoute.PATCH(req(`/api/finance/cost-contracts/${contractId}`, 'PATCH', body), ctx(contractId))

beforeAll(async () => {
  const result = spawnSync(process.execPath, [path.join(workspace, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: workspace, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', timeout: 120_000,
  })
  expect(result.status, result.stderr || result.stdout).toBe(0)
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  vi.resetModules()
  vi.doMock('@/lib/prisma', () => ({ prisma }))
  routes = await import('@/app/api/finance/cost-contracts/route')
  contractRoute = await import('@/app/api/finance/cost-contracts/[id]/route')
  data = await import('@/lib/finance/cost-contracts-data')
  contracts = await import('@/lib/finance/cost-contracts')
  as('ADMIN')
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('cost contracts — admin flow', () => {
  it('should create a contract with its first amount and split', async () => {
    const res = await routes.POST(req('/api/finance/cost-contracts', 'POST', {
      counterparty: 'Test Wynajmujący', description: 'najem placu', startMonth: '2026-04', amount: '3.000,00', jagPercent: 50, isConfidential: true,
    }))
    const json = await res.json()
    contractId = json.id
    expect(res.status).toBe(201)
  })

  it('should recognise the contract in every month from its start, split between salons', async () => {
    const rows = await data.loadContractCostsForMonths(prisma, 2026, [3, 4, 9])
    expect(rows.map((row) => [row.month, row.costCenterId, row.amount])).toEqual([[4, 'JAG', 1500], [4, 'PUL', 1500], [9, 'JAG', 1500], [9, 'PUL', 1500]])
  })

  it('should apply an indexed amount from its month only', async () => {
    const res = await patch({ action: 'amount.add', effectiveFrom: '2026-09', amount: '3200' })
    const rows = await data.loadContractCostsForMonths(prisma, 2026, [8, 9])
    expect([res.status, rows.filter((row) => row.month === 8).reduce((s, r) => s + r.amount, 0), rows.filter((row) => row.month === 9).reduce((s, r) => s + r.amount, 0)])
      .toEqual([200, 3000, 3200])
  })

  it('should stop counting after the end month', async () => {
    await patch({ action: 'update', counterparty: 'Test Wynajmujący', description: 'najem placu', endMonth: '2026-08', isConfidential: true })
    expect((await data.loadContractCostsForMonths(prisma, 2026, [9])).length).toBe(0)
  })

  it('should reject an amount effective before the contract starts', async () => {
    expect((await patch({ action: 'amount.add', effectiveFrom: '2026-01', amount: '1' })).status).toBe(400)
  })

  it('should hide the confidential contract from MANAGER results', async () => {
    const rows = await data.loadContractCostsForMonths(prisma, 2026, [4])
    expect([contracts.visibleContractCosts(rows, 'ADMIN').length, contracts.visibleContractCosts(rows, 'MANAGER').length]).toEqual([2, 0])
  })

  it('should keep a change history', async () => {
    const events = await prisma.costContractAuditEvent.findMany({ where: { contractId } })
    expect(events.map((event) => event.action).sort()).toEqual(['amount.add', 'contract.create', 'contract.update'])
  })

  it('should not let a contract be deleted in the database', async () => {
    await expect(prisma.costContract.delete({ where: { id: contractId } })).rejects.toThrow()
  })

  it.each(['MANAGER', 'EMPLOYEE'] as const)('should deny %s access to cost contracts', async (role) => {
    as(role)
    const statuses = [(await routes.GET()).status, (await patch({ action: 'split.add', effectiveFrom: '2026-05', jagPercent: 10 })).status]
    as('ADMIN')
    expect(statuses).toEqual([403, 403])
  })
})
