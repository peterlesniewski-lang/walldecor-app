import { describe, expect, it, vi } from 'vitest'
import {
  buildHrLeaveMigrationReport,
  runHrLeaveMigrationAudit,
} from '../../../scripts/audit-hr-leave-migration'

const balances = [
  ...Array.from({ length: 15 }, (_, index) => ({
    id: `vl-${index + 1}`,
    employeeId: `employee-${index + 1}`,
    year: 2026,
    totalDays: 20,
    usedDays: index < 2 ? 2 : 0,
    pendingDays: index < 2 ? 1 : 0,
    leaveType: { code: 'VL' },
  })),
  {
    id: 'vld-1',
    employeeId: 'employee-1',
    year: 2026,
    totalDays: 4,
    usedDays: 2,
    pendingDays: 1,
    leaveType: { code: 'VLD' },
  },
  {
    id: 'vld-2',
    employeeId: 'employee-2',
    year: 2026,
    totalDays: 4,
    usedDays: 1,
    pendingDays: 1,
    leaveType: { code: 'VLD' },
  },
]

const requests = [
  {
    id: 'request-pending',
    employeeId: 'employee-1',
    startDate: new Date('2026-07-01T00:00:00.000Z'),
    days: 1,
    status: 'pending',
    isOnDemand: false,
    leaveType: { code: 'VLD' },
  },
  {
    id: 'request-approved',
    employeeId: 'employee-2',
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    days: 1,
    status: 'approved',
    isOnDemand: true,
    leaveType: { code: 'VL' },
  },
  {
    id: 'request-rejected',
    employeeId: 'employee-2',
    startDate: new Date('2026-05-01T00:00:00.000Z'),
    days: 1,
    status: 'rejected',
    isOnDemand: false,
    leaveType: { code: 'VLD' },
  },
  {
    id: 'request-cancelled',
    employeeId: 'employee-1',
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    days: 1,
    status: 'cancelled',
    isOnDemand: true,
    leaveType: { code: 'VL' },
  },
]

function createAuditClient() {
  const employeeCount = vi.fn()
    .mockResolvedValueOnce(12)
    .mockResolvedValueOnce(9)
  const leaveBalanceFindMany = vi.fn().mockResolvedValue(balances)
  const leaveRequestCount = vi.fn().mockResolvedValue(31)
  const leaveRequestFindMany = vi.fn().mockResolvedValue(requests)
  const correctionFindMany = vi.fn().mockResolvedValue([
    { id: 'migration:vld-to-vl:v1:vld-1' },
    { id: 'migration:vld-to-vl:v1:vld-2' },
  ])
  const leaveTypeFindMany = vi.fn().mockResolvedValue([
    { id: 'leave-type-vl', code: 'VL', parentId: null },
    {
      id: 'leave-type-vld',
      code: 'VLD',
      parentId: 'leave-type-vl',
    },
  ])
  const disconnect = vi.fn().mockResolvedValue(undefined)
  const client = {
    employee: { count: employeeCount },
    leaveBalanceNew: { findMany: leaveBalanceFindMany },
    leaveRequestNew: {
      count: leaveRequestCount,
      findMany: leaveRequestFindMany,
    },
    leaveBalanceCorrection: { findMany: correctionFindMany },
    leaveType: { findMany: leaveTypeFindMany },
    $disconnect: disconnect,
  }

  return {
    client,
    disconnect,
    employeeCount,
    leaveBalanceFindMany,
    leaveRequestCount,
    leaveRequestFindMany,
    correctionFindMany,
    leaveTypeFindMany,
  }
}

function createRunnerDependencies(
  client: ReturnType<typeof createAuditClient>['client']
) {
  return {
    createClient: vi.fn(() => client),
    writeJson: vi.fn(),
    writeError: vi.fn(),
    setExitCode: vi.fn(),
  }
}

function createDeferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return { promise, resolve: resolvePromise }
}

const expectedReport = {
  employees: 12,
  employeesWithConfig: 9,
  vacationBalances: 15,
  existingRequests: 31,
  vld: {
    balances: {
      count: 2,
      totalDays: 8,
      usedDays: 3,
      pendingDays: 2,
      transferredCount: 2,
      transferredUsedDays: 3,
      transferredPendingDays: 2,
    },
    balancesWithoutVl: {
      count: 0,
      totalDays: 0,
      usedDays: 0,
      pendingDays: 0,
    },
    requests: {
      count: 4,
      days: 4,
      byStatus: {
        pending: { count: 1, days: 1 },
        approved: { count: 1, days: 1 },
        rejected: { count: 1, days: 1 },
        cancelled: { count: 1, days: 1 },
        other: { count: 0, days: 0 },
      },
    },
    pendingRequestsNotProcessable: {
      count: 0,
      days: 0,
      groups: [],
    },
  },
  blockers: [
    {
      code: 'ACTIVE_EMPLOYEE_WITHOUT_ENTITLEMENT_CONFIG',
      count: 3,
    },
  ],
  readyForProduction: false,
}

describe('HR leave migration audit', () => {
  it('creates the client through the injected factory when the runner starts', async () => {
    const { client } = createAuditClient()
    const dependencies = createRunnerDependencies(client)

    await runHrLeaveMigrationAudit(dependencies)

    expect(dependencies.createClient).toHaveBeenCalledOnce()
  })

  it('returns the exact migration report shape', async () => {
    const { client } = createAuditClient()

    const report = await buildHrLeaveMigrationReport(client)

    expect(report).toEqual(expectedReport)
  })

  it('runs exact queries, writes pretty JSON, and disconnects once', async () => {
    const {
      client,
      disconnect,
      employeeCount,
      leaveBalanceFindMany,
      leaveRequestCount,
      leaveRequestFindMany,
      correctionFindMany,
      leaveTypeFindMany,
    } = createAuditClient()
    const dependencies = createRunnerDependencies(client)

    await runHrLeaveMigrationAudit(dependencies)

    expect(employeeCount.mock.calls).toEqual([
      [{ where: { active: true } }],
      [{
        where: {
          active: true,
          leaveEntitlementConfigs: { some: {} },
        },
      }],
    ])
    expect(leaveBalanceFindMany).toHaveBeenCalledWith({
      where: { leaveType: { code: { in: ['VL', 'VLD'] } } },
      select: {
        id: true,
        employeeId: true,
        year: true,
        totalDays: true,
        usedDays: true,
        pendingDays: true,
        leaveType: { select: { code: true } },
      },
    })
    expect(leaveRequestCount).toHaveBeenCalledWith()
    expect(leaveRequestFindMany).toHaveBeenCalledOnce()
    expect(correctionFindMany).toHaveBeenCalledOnce()
    expect(leaveTypeFindMany).toHaveBeenCalledOnce()
    expect(dependencies.writeJson).toHaveBeenCalledWith(
      JSON.stringify(expectedReport, null, 2)
    )
    expect(disconnect).toHaveBeenCalledOnce()
    expect(dependencies.writeError).not.toHaveBeenCalled()
    expect(dependencies.setExitCode).not.toHaveBeenCalled()
  })

  it('reports a query failure, sets exit code, and still disconnects', async () => {
    const auditClient = createAuditClient()
    auditClient.employeeCount.mockReset()
      .mockRejectedValueOnce(new Error('sensitive query detail'))
      .mockResolvedValueOnce(9)
    const dependencies = createRunnerDependencies(auditClient.client)

    await runHrLeaveMigrationAudit(dependencies)

    expect(dependencies.writeJson).not.toHaveBeenCalled()
    expect(dependencies.writeError).toHaveBeenCalledWith(
      'HR leave migration audit failed.'
    )
    expect(dependencies.writeError).not.toHaveBeenCalledWith(
      expect.stringContaining('sensitive query detail')
    )
    expect(dependencies.setExitCode).toHaveBeenCalledWith(1)
    expect(auditClient.disconnect).toHaveBeenCalledOnce()
  })

  it('waits for every query to settle before reporting a failure', async () => {
    const auditClient = createAuditClient()
    const pendingBalances = createDeferred<typeof balances>()
    auditClient.employeeCount.mockReset()
      .mockRejectedValueOnce(new Error('sensitive query detail'))
      .mockResolvedValueOnce(9)
    auditClient.leaveBalanceFindMany.mockReset()
      .mockReturnValueOnce(pendingBalances.promise)
    const dependencies = createRunnerDependencies(auditClient.client)
    let completed = false

    const runPromise = runHrLeaveMigrationAudit(dependencies).then(() => {
      completed = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(completed).toBe(false)
    expect(auditClient.disconnect).not.toHaveBeenCalled()
    expect(dependencies.writeError).not.toHaveBeenCalled()
    expect(dependencies.setExitCode).not.toHaveBeenCalled()

    pendingBalances.resolve(balances)
    await runPromise

    expect(dependencies.writeJson).not.toHaveBeenCalled()
    expect(dependencies.writeError).toHaveBeenCalledWith(
      'HR leave migration audit failed.'
    )
    expect(dependencies.setExitCode).toHaveBeenCalledWith(1)
    expect(auditClient.disconnect).toHaveBeenCalledOnce()
  })

  it('reports a client creation failure without writing JSON', async () => {
    const dependencies = {
      createClient: vi.fn(() => {
        throw new Error('sensitive client detail')
      }),
      writeJson: vi.fn(),
      writeError: vi.fn(),
      setExitCode: vi.fn(),
    }

    await runHrLeaveMigrationAudit(dependencies)

    expect(dependencies.writeJson).not.toHaveBeenCalled()
    expect(dependencies.writeError).toHaveBeenCalledWith(
      'HR leave migration audit failed.'
    )
    expect(dependencies.setExitCode).toHaveBeenCalledWith(1)
  })

  it('keeps success JSON but reports a disconnect failure', async () => {
    const auditClient = createAuditClient()
    auditClient.disconnect.mockReset()
      .mockRejectedValueOnce(new Error('sensitive disconnect detail'))
    const dependencies = createRunnerDependencies(auditClient.client)

    await runHrLeaveMigrationAudit(dependencies)

    expect(dependencies.writeJson).toHaveBeenCalledWith(
      JSON.stringify(expectedReport, null, 2)
    )
    expect(dependencies.writeError).toHaveBeenCalledWith(
      'Failed to disconnect the HR leave migration audit client.'
    )
    expect(dependencies.writeError).not.toHaveBeenCalledWith(
      expect.stringContaining('sensitive disconnect detail')
    )
    expect(dependencies.setExitCode).toHaveBeenCalledWith(1)
    expect(auditClient.disconnect).toHaveBeenCalledOnce()
  })
})
