import { describe, expect, it, vi } from 'vitest'
import { buildHrLeaveMigrationReport } from '../../../scripts/audit-hr-leave-migration'

describe('HR leave migration audit', () => {
  it('runs the exact read-only count queries and returns the report shape', async () => {
    const employeeCount = vi.fn()
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(9)
    const leaveBalanceCount = vi.fn()
      .mockResolvedValueOnce(15)
      .mockResolvedValueOnce(2)
    const leaveRequestCount = vi.fn()
      .mockResolvedValueOnce(31)
      .mockResolvedValueOnce(4)
    const prisma = {
      employee: { count: employeeCount },
      leaveBalanceNew: { count: leaveBalanceCount },
      leaveRequestNew: { count: leaveRequestCount },
    }

    const report = await buildHrLeaveMigrationReport(prisma)

    expect(employeeCount.mock.calls).toEqual([
      [{ where: { active: true } }],
      [{
        where: {
          active: true,
          leaveEntitlementConfigs: { some: {} },
        },
      }],
    ])
    expect(leaveBalanceCount.mock.calls).toEqual([
      [{ where: { leaveType: { code: 'VL' } } }],
      [{ where: { leaveType: { code: 'VLD' } } }],
    ])
    expect(leaveRequestCount.mock.calls).toEqual([
      [],
      [{
        where: {
          OR: [
            { isOnDemand: true },
            { leaveType: { code: 'VLD' } },
          ],
        },
      }],
    ])
    expect(report).toEqual({
      employees: 12,
      employeesWithConfig: 9,
      vacationBalances: 15,
      vldBalancesIgnoredByNewPolicy: 2,
      existingRequests: 31,
      existingVldRequests: 4,
    })
  })
})
