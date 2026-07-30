import { describe, expect, it, vi } from 'vitest'
import {
  buildHrLeaveMigrationReport,
  runHrLeaveMigrationAudit,
} from '../../../scripts/audit-hr-leave-migration'

function createAuditClient() {
  const employeeCount = vi.fn()
    .mockResolvedValueOnce(12)
    .mockResolvedValueOnce(9)
  const leaveBalanceCount = vi.fn()
    .mockResolvedValueOnce(15)
    .mockResolvedValueOnce(2)
  const leaveRequestCount = vi.fn()
    .mockResolvedValueOnce(31)
    .mockResolvedValueOnce(4)
  const disconnect = vi.fn().mockResolvedValue(undefined)
  const client = {
    employee: { count: employeeCount },
    leaveBalanceNew: { count: leaveBalanceCount },
    leaveRequestNew: { count: leaveRequestCount },
    $disconnect: disconnect,
  }

  return {
    client,
    disconnect,
    employeeCount,
    leaveBalanceCount,
    leaveRequestCount,
  }
}

function createRunnerDependencies(client: ReturnType<typeof createAuditClient>['client']) {
  return {
    createClient: vi.fn(() => client),
    writeJson: vi.fn(),
    writeError: vi.fn(),
    setExitCode: vi.fn(),
  }
}

const expectedReport = {
  employees: 12,
  employeesWithConfig: 9,
  vacationBalances: 15,
  vldBalancesIgnoredByNewPolicy: 2,
  existingRequests: 31,
  existingVldRequests: 4,
}

describe('HR leave migration audit', () => {
  it('keeps client creation lazy until the injected runner is called', async () => {
    const { client } = createAuditClient()
    const dependencies = createRunnerDependencies(client)

    expect(dependencies.createClient).not.toHaveBeenCalled()

    await runHrLeaveMigrationAudit(dependencies)

    expect(dependencies.createClient).toHaveBeenCalledOnce()
  })

  it('returns the exact migration report shape', async () => {
    const { client } = createAuditClient()

    const report = await buildHrLeaveMigrationReport(client)

    expect(report).toEqual(expectedReport)
  })

  it('runs exact count queries, writes pretty JSON, and disconnects once', async () => {
    const {
      client,
      disconnect,
      employeeCount,
      leaveBalanceCount,
      leaveRequestCount,
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
    expect(dependencies.writeJson).toHaveBeenCalledOnce()
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
