import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PrismaClient } from '../src/generated/prisma'

export type HrLeaveMigrationAuditClient = {
  employee: Pick<PrismaClient['employee'], 'count'>
  leaveBalanceNew: Pick<PrismaClient['leaveBalanceNew'], 'count'>
  leaveRequestNew: Pick<PrismaClient['leaveRequestNew'], 'count'>
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

async function main() {
  let prisma: PrismaClient | undefined

  try {
    prisma = new PrismaClient()
    const report = await buildHrLeaveMigrationReport(prisma)
    console.log(JSON.stringify(report, null, 2))
  } catch {
    console.error('HR leave migration audit failed.')
    process.exitCode = 1
  } finally {
    if (prisma) {
      try {
        await prisma.$disconnect()
      } catch {
        console.error('Failed to disconnect the HR leave migration audit client.')
        process.exitCode = 1
      }
    }
  }
}

const entrypoint = process.argv[1]

if (
  entrypoint &&
  import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
  void main()
}
