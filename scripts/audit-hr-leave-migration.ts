import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PrismaClient } from '../src/generated/prisma'

export type HrLeaveMigrationAuditClient = {
  employee: Pick<PrismaClient['employee'], 'count'>
  leaveBalanceNew: Pick<PrismaClient['leaveBalanceNew'], 'count'>
  leaveRequestNew: Pick<PrismaClient['leaveRequestNew'], 'count'>
}

type HrLeaveMigrationAuditRuntimeClient = HrLeaveMigrationAuditClient &
  Pick<PrismaClient, '$disconnect'>

export type HrLeaveMigrationAuditRunnerDependencies = {
  createClient: () => HrLeaveMigrationAuditRuntimeClient
  writeJson: (json: string) => void
  writeError: (message: string) => void
  setExitCode: (code: number) => void
}

export async function buildHrLeaveMigrationReport(
  prisma: HrLeaveMigrationAuditClient
) {
  const [
    employees,
    employeesWithConfig,
    vacationBalances,
    vldBalancesIgnoredByNewPolicy,
    existingRequests,
    existingVldRequests,
  ] = await Promise.all([
    prisma.employee.count({ where: { active: true } }),
    prisma.employee.count({
      where: {
        active: true,
        leaveEntitlementConfigs: { some: {} },
      },
    }),
    prisma.leaveBalanceNew.count({
      where: { leaveType: { code: 'VL' } },
    }),
    prisma.leaveBalanceNew.count({
      where: { leaveType: { code: 'VLD' } },
    }),
    prisma.leaveRequestNew.count(),
    prisma.leaveRequestNew.count({
      where: {
        OR: [
          { isOnDemand: true },
          { leaveType: { code: 'VLD' } },
        ],
      },
    }),
  ])

  return {
    employees,
    employeesWithConfig,
    vacationBalances,
    vldBalancesIgnoredByNewPolicy,
    existingRequests,
    existingVldRequests,
  }
}

export async function runHrLeaveMigrationAudit({
  createClient,
  writeJson,
  writeError,
  setExitCode,
}: HrLeaveMigrationAuditRunnerDependencies) {
  let prisma: HrLeaveMigrationAuditRuntimeClient | undefined

  try {
    prisma = createClient()
    const report = await buildHrLeaveMigrationReport(prisma)
    writeJson(JSON.stringify(report, null, 2))
  } catch {
    writeError('HR leave migration audit failed.')
    setExitCode(1)
  } finally {
    if (prisma) {
      try {
        await prisma.$disconnect()
      } catch {
        writeError('Failed to disconnect the HR leave migration audit client.')
        setExitCode(1)
      }
    }
  }
}

const entrypoint = process.argv[1]

if (
  entrypoint &&
  import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
  void runHrLeaveMigrationAudit({
    createClient: () => new PrismaClient(),
    writeJson: (json) => console.log(json),
    writeError: (message) => console.error(message),
    setExitCode: (code) => {
      process.exitCode = code
    },
  })
}
