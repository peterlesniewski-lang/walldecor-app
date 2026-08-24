import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; employeeId?: string | null } },
  viewer: { role: 'EMPLOYEE', employeeId: 'employee-1', employeeActive: true, authorized: true },
  viewerFromSession: vi.fn(),
  listFeePolicies: vi.fn(),
  createFeePolicy: vi.fn(),
  calendarReadiness: vi.fn(),
  redirect: vi.fn(),
  VisitFeeSettingsPanel: vi.fn(() => null),
  CalendarSettingsPanel: vi.fn(() => null),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('next/link', () => ({ default: () => null }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/http-access', () => ({ installationViewerFromSession: mocks.viewerFromSession }))
vi.mock('@/lib/installations/delegation-service', () => ({
  listInstallationVisitFeePolicies: mocks.listFeePolicies,
  createInstallationVisitFeePolicy: mocks.createFeePolicy,
  InstallationGovernanceValidationError: class InstallationGovernanceValidationError extends Error {},
}))
vi.mock('@/lib/installations/calendar-server-config', () => ({ getInstallationCalendarReadiness: mocks.calendarReadiness }))
vi.mock('@/components/installations/visit-fee-settings-panel', () => ({ VisitFeeSettingsPanel: mocks.VisitFeeSettingsPanel }))
vi.mock('@/components/installations/calendar-settings-panel', () => ({ CalendarSettingsPanel: mocks.CalendarSettingsPanel }))
vi.mock('@/components/shared/csv-costs-panel', () => ({ CsvCostsPanel: () => null }))
vi.mock('@/components/shared/csv-revenue-panel', () => ({ CsvRevenuePanel: () => null }))
vi.mock('@/components/shared/csv-column-mapper', () => ({ CsvColumnMapper: () => null }))
vi.mock('@/components/shared/cash-thresholds-form', () => ({ CashThresholdsForm: () => null }))
vi.mock('@/components/shared/ksef-settings-form', () => ({ KsefSettingsForm: () => null }))
vi.mock('@/components/shared/ksef-cutover-maintenance', () => ({ KsefCutoverMaintenance: () => null }))

import { GET as getFeePolicies } from '@/app/api/settings/installation-visit-fee/route'
import { POST as createFeePolicy } from '@/app/api/settings/installation-visit-fee/route'
import { GET as getCalendarReadiness } from '@/app/api/settings/installation-calendar/route'
import SettingsPage from '@/app/(dashboard)/settings/page'

function includesElementType(value: unknown, type: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const element = value as { type?: unknown; props?: { children?: unknown } }
  if (element.type === type) return true
  const children = element.props?.children
  return Array.isArray(children)
    ? children.some((child) => includesElementType(child, type))
    : includesElementType(children, type)
}

describe('fresh viewer for installation settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session = { user: { id: 'user-1', role: 'ADMIN' } }
    mocks.viewer = { role: 'EMPLOYEE', employeeId: 'employee-1', employeeActive: true, authorized: true }
    mocks.viewerFromSession.mockImplementation(async () => mocks.viewer)
    mocks.listFeePolicies.mockResolvedValue([{ version: 1 }])
    mocks.calendarReadiness.mockReturnValue({ ready: true })
    mocks.redirect.mockImplementation(() => { throw new Error('redirected') })
  })

  it('rejects stale ADMIN claims after demotion before fee or Calendar readiness reads', async () => {
    expect((await getFeePolicies()).status).toBe(403)
    expect((await createFeePolicy(new Request('http://test/api/settings/installation-visit-fee', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grossAmount: '199.00', clauseText: 'Klauzula' }),
    }))).status).toBe(403)
    expect((await getCalendarReadiness()).status).toBe(403)

    expect(mocks.listFeePolicies).not.toHaveBeenCalled()
    expect(mocks.createFeePolicy).not.toHaveBeenCalled()
    expect(mocks.calendarReadiness).not.toHaveBeenCalled()
  })

  it('redirects a disabled or deleted fresh viewer before rendering the settings panels', async () => {
    mocks.viewer = { role: 'EMPLOYEE', employeeId: null, employeeActive: false, authorized: false }

    expect((await getFeePolicies()).status).toBe(403)
    expect((await getCalendarReadiness()).status).toBe(403)
    await expect(SettingsPage()).rejects.toThrow('redirected')

    expect(mocks.listFeePolicies).not.toHaveBeenCalled()
    expect(mocks.calendarReadiness).not.toHaveBeenCalled()
    expect(mocks.VisitFeeSettingsPanel).not.toHaveBeenCalled()
    expect(mocks.CalendarSettingsPanel).not.toHaveBeenCalled()
  })

  it('uses a current MANAGER role for the fee panel only, regardless of a stale employee session', async () => {
    mocks.session = { user: { id: 'user-1', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    mocks.viewer = { role: 'MANAGER', employeeId: null, authorized: true }

    expect((await getFeePolicies()).status).toBe(200)
    expect((await getCalendarReadiness()).status).toBe(403)
    const page = await SettingsPage()

    expect(mocks.listFeePolicies).toHaveBeenCalledTimes(1)
    expect(mocks.calendarReadiness).not.toHaveBeenCalled()
    expect(includesElementType(page, mocks.VisitFeeSettingsPanel)).toBe(true)
    expect(includesElementType(page, mocks.CalendarSettingsPanel)).toBe(false)
  })

  it('uses a current ADMIN role for both installation settings, regardless of a stale employee session', async () => {
    mocks.session = { user: { id: 'user-1', role: 'EMPLOYEE', employeeId: 'employee-1' } }
    mocks.viewer = { role: 'ADMIN', employeeId: null, authorized: true }

    expect((await getFeePolicies()).status).toBe(200)
    expect((await getCalendarReadiness()).status).toBe(200)
    const page = await SettingsPage()

    expect(includesElementType(page, mocks.VisitFeeSettingsPanel)).toBe(true)
    expect(includesElementType(page, mocks.CalendarSettingsPanel)).toBe(true)
  })
})
