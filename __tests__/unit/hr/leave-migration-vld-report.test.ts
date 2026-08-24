import { describe, expect, it, vi } from 'vitest'
import { buildHrLeaveMigrationReport } from '../../../scripts/audit-hr-leave-migration'

function createDetailedAuditClient() {
  return {
    employee: {
      count: vi.fn()
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2),
    },
    leaveBalanceNew: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'vl-ready',
          employeeId: 'employee-ready',
          year: 2026,
          totalDays: 20,
          usedDays: 8,
          pendingDays: 3,
          leaveType: { code: 'VL' },
        },
        {
          id: 'vld-ready',
          employeeId: 'employee-ready',
          year: 2026,
          totalDays: 4,
          usedDays: 3,
          pendingDays: 1,
          leaveType: { code: 'VLD' },
        },
        {
          id: 'vld-orphan',
          employeeId: 'employee-orphan',
          year: 2026,
          totalDays: 4,
          usedDays: 2,
          pendingDays: 1,
          leaveType: { code: 'VLD' },
        },
      ]),
    },
    leaveRequestNew: {
      count: vi.fn().mockResolvedValue(5),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'request-ready',
          employeeId: 'employee-ready',
          startDate: new Date('2026-07-06T00:00:00.000Z'),
          days: 1,
          status: 'pending',
          isOnDemand: false,
          leaveType: { code: 'VLD' },
        },
        {
          id: 'request-orphan',
          employeeId: 'employee-orphan',
          startDate: new Date('2026-07-07T00:00:00.000Z'),
          days: 1,
          status: 'pending',
          isOnDemand: false,
          leaveType: { code: 'VLD' },
        },
        {
          id: 'request-approved',
          employeeId: 'employee-ready',
          startDate: new Date('2026-06-05T00:00:00.000Z'),
          days: 2,
          status: 'approved',
          isOnDemand: true,
          leaveType: { code: 'VL' },
        },
      ]),
    },
    leaveBalanceCorrection: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'migration:vld-to-vl:v1:vld-ready' },
      ]),
    },
    leaveType: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'leave-type-vl', code: 'VL', parentId: null },
        {
          id: 'leave-type-vld',
          code: 'VLD',
          parentId: 'leave-type-vl',
        },
      ]),
    },
  }
}

describe('historical VLD migration report', () => {
  it('reports balance and request totals, statuses, transfers, and blockers', async () => {
    const report = await buildHrLeaveMigrationReport(
      createDetailedAuditClient() as never
    )

    expect(report).toEqual({
      employees: 3,
      employeesWithConfig: 2,
      vacationBalances: 1,
      existingRequests: 5,
      vld: {
        balances: {
          count: 2,
          totalDays: 8,
          usedDays: 5,
          pendingDays: 2,
          transferredCount: 1,
          transferredUsedDays: 3,
          transferredPendingDays: 1,
        },
        balancesWithoutVl: {
          count: 1,
          totalDays: 4,
          usedDays: 2,
          pendingDays: 1,
        },
        requests: {
          count: 3,
          days: 4,
          byStatus: {
            pending: { count: 2, days: 2 },
            approved: { count: 1, days: 2 },
            rejected: { count: 0, days: 0 },
            cancelled: { count: 0, days: 0 },
            other: { count: 0, days: 0 },
          },
        },
        pendingRequestsNotProcessable: {
          count: 1,
          days: 1,
          groups: [
            {
              employeeId: 'employee-orphan',
              year: 2026,
              requestCount: 1,
              requestDays: 1,
              reasons: ['MISSING_VL_BALANCE'],
            },
          ],
        },
      },
      blockers: [
        {
          code: 'ACTIVE_EMPLOYEE_WITHOUT_ENTITLEMENT_CONFIG',
          count: 1,
        },
        {
          code: 'VLD_BALANCE_WITHOUT_VL',
          count: 1,
          totalDays: 4,
          usedDays: 2,
          pendingDays: 1,
        },
        {
          code: 'PENDING_VLD_REQUEST_NOT_PROCESSABLE',
          count: 1,
          days: 1,
        },
      ],
      readyForProduction: false,
    })
  })

  it('blocks an underfunded pending VLD request even when VL exists', async () => {
    const client = createDetailedAuditClient()
    client.leaveBalanceNew.findMany.mockResolvedValue([
      {
        id: 'vl-ready',
        employeeId: 'employee-ready',
        year: 2026,
        totalDays: 20,
        usedDays: 20,
        pendingDays: 0,
        leaveType: { code: 'VL' },
      },
      {
        id: 'vld-ready',
        employeeId: 'employee-ready',
        year: 2026,
        totalDays: 4,
        usedDays: 3,
        pendingDays: 1,
        leaveType: { code: 'VLD' },
      },
    ])
    client.leaveRequestNew.findMany.mockResolvedValue([
      {
        id: 'request-ready',
        employeeId: 'employee-ready',
        startDate: new Date('2026-07-06T00:00:00.000Z'),
        days: 1,
        status: 'pending',
        isOnDemand: false,
        leaveType: { code: 'VLD' },
      },
    ])

    const report = await buildHrLeaveMigrationReport(client as never)

    expect(report.vld.pendingRequestsNotProcessable).toEqual({
      count: 1,
      days: 1,
      groups: [
        {
          employeeId: 'employee-ready',
          year: 2026,
          requestCount: 1,
          requestDays: 1,
          reasons: ['INSUFFICIENT_PENDING_DAYS', 'INSUFFICIENT_AVAILABLE_DAYS'],
        },
      ],
    })
    expect(report.readyForProduction).toBe(false)
  })
})
