import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH, DELETE } from '@/app/api/cash/accounts/[id]/route'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findAccount: vi.fn(), updateAccount: vi.fn(), history: vi.fn(), settings: vi.fn(), deposits: vi.fn(), transaction: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  cashAccount: { findUnique: mocks.findAccount, update: mocks.updateAccount },
  cashBalanceHistory: { create: mocks.history },
  salonCashSettings: { findUnique: mocks.settings },
  cashDeposit: { count: mocks.deposits },
  $transaction: mocks.transaction,
} }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', name: 'Admin' } })
  mocks.findAccount.mockResolvedValue({ id: 'cash-1', balance: 270, name: 'Kasa', isActive: true })
  mocks.updateAccount.mockResolvedValue({ id: 'cash-1', balance: 270, name: 'Kasa' })
  mocks.settings.mockResolvedValue({ costCenterId: 'PUL' })
  mocks.deposits.mockResolvedValue(0)
  mocks.transaction.mockImplementation((callback) => callback({
    cashAccount: { findUnique: mocks.findAccount, update: mocks.updateAccount },
    cashBalanceHistory: { create: mocks.history },
    salonCashSettings: { findUnique: mocks.settings },
    cashDeposit: { count: mocks.deposits },
  }))
})
const context = () => ({ params: Promise.resolve({ id: 'cash-1' }) })
const patch = (data: object) => PATCH(new NextRequest('http://localhost/api/cash/accounts/cash-1', { method: 'PATCH', body: JSON.stringify(data) }), context())

describe('legacy cash account guard', () => {
  it('blocks a manual balance change on a cashier-managed account with an actionable conflict', async () => {
    const response = await patch({ balance: 999 })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('Kasa salonu')
    expect(mocks.updateAccount).not.toHaveBeenCalled()
    expect(mocks.history).not.toHaveBeenCalled()
  })

  it('blocks deactivation of a managed account', async () => {
    const response = await DELETE(new NextRequest('http://localhost/api/cash/accounts/cash-1', { method: 'DELETE' }), context())
    expect(response.status).toBe(409)
    expect(mocks.updateAccount).not.toHaveBeenCalled()
  })

  it('blocks deactivation of an unmanaged account until all received deposits are counted', async () => {
    mocks.settings.mockResolvedValue(null)
    mocks.deposits.mockResolvedValue(1)
    const request = () => DELETE(new NextRequest('http://localhost/api/cash/accounts/cash-1', { method: 'DELETE' }), context())
    const response = await request()
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('Najpierw przelicz odebrane depozyty')
    expect(mocks.deposits).toHaveBeenCalledWith({ where: { destinationAccountId: 'cash-1', status: 'RECEIVED' } })
    expect(mocks.updateAccount).not.toHaveBeenCalled()
    mocks.deposits.mockResolvedValue(0)
    expect((await request()).status).toBe(200)
    expect(mocks.updateAccount).toHaveBeenCalledWith({ where: { id: 'cash-1' }, data: { isActive: false } })
  })

  it('still allows renaming a managed account without changing its balance', async () => {
    expect((await patch({ name: 'Kasa Puławska' })).status).toBe(200)
    expect(mocks.updateAccount).toHaveBeenCalledWith({ where: { id: 'cash-1' }, data: { name: 'Kasa Puławska' } })
    expect(mocks.history).not.toHaveBeenCalled()
  })

  it('updates an unmanaged balance and history inside the same transaction', async () => {
    mocks.settings.mockResolvedValue(null)
    expect((await patch({ balance: 300 })).status).toBe(200)
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.history).toHaveBeenCalledWith({ data: { accountId: 'cash-1', previousBalance: 270, newBalance: 300, changedBy: 'Admin' } })
  })

  it.each(['EMPLOYEE', 'MANAGER'])('does not widen old account API access for %s', async (role) => {
    mocks.session.mockResolvedValue({ user: { id: 'user', role } })
    expect((await patch({ balance: 300 })).status).toBe(403)
    expect(mocks.findAccount).not.toHaveBeenCalled()
  })
})
