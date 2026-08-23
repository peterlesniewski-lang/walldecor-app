import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string } } | null,
  list: vi.fn(),
  create: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/delegation-service', () => ({
  listInstallationVisitFeePolicies: mocks.list,
  createInstallationVisitFeePolicy: mocks.create,
  InstallationGovernanceValidationError: class InstallationGovernanceValidationError extends Error { fieldErrors = { form: 'bad' } },
}))

import { GET, POST } from '@/app/api/settings/installation-visit-fee/route'

describe('company visit-fee setting route', () => {
  beforeEach(() => {
    mocks.session = { user: { id: 'admin-user', role: 'ADMIN' } }
    mocks.list.mockReset().mockResolvedValue([{ version: 1, grossAmount: '249.90' }])
    mocks.create.mockReset().mockResolvedValue({ id: 'policy-2', version: 2 })
  })

  it('lists and creates a versioned policy only for an administrator or manager', async () => {
    expect((await GET()).status).toBe(200)
    const create = await POST(new NextRequest('http://test/api/settings/installation-visit-fee', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        grossAmount: '249.90', clauseText: 'Tekst klauzuli do legalnego zatwierdzenia przed aktywacją.', legalApprovedAt: null,
      }),
    }))
    expect(create.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith({}, expect.objectContaining({ grossAmount: '249.90', legalApprovedAt: null }), 'admin-user')

    mocks.session = { user: { id: 'employee-user', role: 'EMPLOYEE' } }
    expect((await GET()).status).toBe(403)
  })

  it('rejects a legal approval date in the future before creating a policy', async () => {
    const response = await POST(new NextRequest('http://test/api/settings/installation-visit-fee', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        grossAmount: '249.90',
        clauseText: 'Pełny tekst klauzuli, którego zatwierdzenie nie może pochodzić z przyszłości.',
        legalApprovedAt: '2099-01-01T00:00:00.000Z',
      }),
    }))

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
