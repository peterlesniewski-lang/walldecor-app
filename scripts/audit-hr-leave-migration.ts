import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PrismaClient } from '../src/generated/prisma'
import { getWarsawBusinessDate } from '../src/lib/hr/business-date'

const VLD_TRANSFER_CORRECTION_PREFIX = 'migration:vld-to-vl:v1:'
const EPSILON = 1e-9

export type HrLeaveMigrationAuditClient = {
  employee: Pick<PrismaClient['employee'], 'count'>
  leaveBalanceNew: Pick<PrismaClient['leaveBalanceNew'], 'findMany'>
  leaveRequestNew: Pick<PrismaClient['leaveRequestNew'], 'count' | 'findMany'>
  leaveBalanceCorrection: Pick<
    PrismaClient['leaveBalanceCorrection'],
    'findMany'
  >
  leaveType: Pick<PrismaClient['leaveType'], 'findMany'>
}

type HrLeaveMigrationAuditRuntimeClient = HrLeaveMigrationAuditClient &
  Pick<PrismaClient, '$disconnect'>

export type HrLeaveMigrationAuditRunnerDependencies = {
  createClient: () => HrLeaveMigrationAuditRuntimeClient
  writeJson: (json: string) => void
  writeError: (message: string) => void
  setExitCode: (code: number) => void
}

type BalanceRow = {
  id: string
  employeeId: string
  year: number
  totalDays: number
  usedDays: number
  pendingDays: number
  leaveType: { code: string }
}

type RequestRow = {
  id: string
  employeeId: string
  startDate: Date
  days: number
  status: string
  isOnDemand: boolean
  leaveType: { code: string }
}

type CorrectionRow = { id: string }
type LeaveTypeRow = { id: string; code: string; parentId: string | null }

type CountAndDays = {
  count: number
  days: number
}

const EMPTY_COUNT_AND_DAYS: CountAndDays = { count: 0, days: 0 }

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function balanceKey(employeeId: string, year: number) {
  return `${employeeId}:${year}`
}

function requestStatusSummary(requests: RequestRow[]) {
  const summary = {
    pending: { ...EMPTY_COUNT_AND_DAYS },
    approved: { ...EMPTY_COUNT_AND_DAYS },
    rejected: { ...EMPTY_COUNT_AND_DAYS },
    cancelled: { ...EMPTY_COUNT_AND_DAYS },
    other: { ...EMPTY_COUNT_AND_DAYS },
  }

  for (const request of requests) {
    const status =
      request.status === 'pending' ||
      request.status === 'approved' ||
      request.status === 'rejected' ||
      request.status === 'cancelled'
        ? request.status
        : 'other'
    summary[status].count++
    summary[status].days += request.days
  }

  return summary
}

function pendingRequestProcessability(
  requests: RequestRow[],
  vlBalances: Map<string, BalanceRow>
) {
  const grouped = new Map<
    string,
    {
      employeeId: string
      year: number
      requestCount: number
      requestDays: number
    }
  >()

  for (const request of requests) {
    if (request.status !== 'pending') continue
    const year = getWarsawBusinessDate(request.startDate).year
    const key = balanceKey(request.employeeId, year)
    const current = grouped.get(key) ?? {
      employeeId: request.employeeId,
      year,
      requestCount: 0,
      requestDays: 0,
    }
    current.requestCount++
    current.requestDays += request.days
    grouped.set(key, current)
  }

  const groups = [...grouped.values()]
    .sort((left, right) =>
      left.employeeId.localeCompare(right.employeeId) ||
      left.year - right.year
    )
    .flatMap((group) => {
      const balance = vlBalances.get(balanceKey(group.employeeId, group.year))
      if (!balance) {
        return [{ ...group, reasons: ['MISSING_VL_BALANCE'] }]
      }

      const reasons: string[] = []
      if (balance.pendingDays + EPSILON < group.requestDays) {
        reasons.push('INSUFFICIENT_PENDING_DAYS')
      }
      if (
        balance.totalDays - balance.usedDays + EPSILON <
        group.requestDays
      ) {
        reasons.push('INSUFFICIENT_AVAILABLE_DAYS')
      }

      return reasons.length > 0 ? [{ ...group, reasons }] : []
    })

  return {
    count: sum(groups.map((group) => group.requestCount)),
    days: sum(groups.map((group) => group.requestDays)),
    groups,
  }
}

export async function buildHrLeaveMigrationReport(
  prisma: HrLeaveMigrationAuditClient
) {
  const settled = await Promise.allSettled([
    prisma.employee.count({ where: { active: true } }),
    prisma.employee.count({
      where: {
        active: true,
        leaveEntitlementConfigs: { some: {} },
      },
    }),
    prisma.leaveBalanceNew.findMany({
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
    }),
    prisma.leaveRequestNew.count(),
    prisma.leaveRequestNew.findMany({
      where: {
        OR: [
          { isOnDemand: true },
          { leaveType: { code: 'VLD' } },
        ],
      },
      select: {
        id: true,
        employeeId: true,
        startDate: true,
        days: true,
        status: true,
        isOnDemand: true,
        leaveType: { select: { code: true } },
      },
    }),
    prisma.leaveBalanceCorrection.findMany({
      where: { id: { startsWith: VLD_TRANSFER_CORRECTION_PREFIX } },
      select: { id: true },
    }),
    prisma.leaveType.findMany({
      where: { code: { in: ['VL', 'VLD'] } },
      select: { id: true, code: true, parentId: true },
    }),
  ])

  const values = settled.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })

  const [
    employees,
    employeesWithConfig,
    balances,
    existingRequests,
    vldRequests,
    transferCorrections,
    leaveTypes,
  ] = values as [
    number,
    number,
    BalanceRow[],
    number,
    RequestRow[],
    CorrectionRow[],
    LeaveTypeRow[],
  ]

  const vlBalances = balances.filter(
    (balance) => balance.leaveType.code === 'VL'
  )
  const vldBalances = balances.filter(
    (balance) => balance.leaveType.code === 'VLD'
  )
  const vlBalanceMap = new Map(
    vlBalances.map((balance) => [
      balanceKey(balance.employeeId, balance.year),
      balance,
    ])
  )
  const transferredSourceIds = new Set(
    transferCorrections.map((correction) =>
      correction.id.slice(VLD_TRANSFER_CORRECTION_PREFIX.length)
    )
  )
  const transferredBalances = vldBalances.filter((balance) =>
    transferredSourceIds.has(balance.id)
  )
  const balancesWithoutVl = vldBalances.filter(
    (balance) =>
      !vlBalanceMap.has(balanceKey(balance.employeeId, balance.year))
  )
  const balancesNotTransferred = vldBalances.filter(
    (balance) =>
      vlBalanceMap.has(balanceKey(balance.employeeId, balance.year)) &&
      !transferredSourceIds.has(balance.id)
  )
  const pendingRequestsNotProcessable = pendingRequestProcessability(
    vldRequests,
    vlBalanceMap
  )
  const vlType = leaveTypes.find((leaveType) => leaveType.code === 'VL')
  const vldType = leaveTypes.find((leaveType) => leaveType.code === 'VLD')
  const vldParentConfigured =
    Boolean(vlType) &&
    Boolean(vldType) &&
    vldType?.parentId === vlType?.id

  const blockers: Array<Record<string, string | number>> = []
  const employeesWithoutConfig = Math.max(0, employees - employeesWithConfig)
  if (employeesWithoutConfig > 0) {
    blockers.push({
      code: 'ACTIVE_EMPLOYEE_WITHOUT_ENTITLEMENT_CONFIG',
      count: employeesWithoutConfig,
    })
  }
  if (!vldParentConfigured) {
    blockers.push({
      code: 'VLD_PARENT_NOT_CONFIGURED',
      count: 1,
    })
  }
  if (balancesWithoutVl.length > 0) {
    blockers.push({
      code: 'VLD_BALANCE_WITHOUT_VL',
      count: balancesWithoutVl.length,
      totalDays: sum(balancesWithoutVl.map((balance) => balance.totalDays)),
      usedDays: sum(balancesWithoutVl.map((balance) => balance.usedDays)),
      pendingDays: sum(
        balancesWithoutVl.map((balance) => balance.pendingDays)
      ),
    })
  }
  if (balancesNotTransferred.length > 0) {
    blockers.push({
      code: 'VLD_BALANCE_NOT_TRANSFERRED',
      count: balancesNotTransferred.length,
      usedDays: sum(
        balancesNotTransferred.map((balance) => balance.usedDays)
      ),
      pendingDays: sum(
        balancesNotTransferred.map((balance) => balance.pendingDays)
      ),
    })
  }
  if (pendingRequestsNotProcessable.count > 0) {
    blockers.push({
      code: 'PENDING_VLD_REQUEST_NOT_PROCESSABLE',
      count: pendingRequestsNotProcessable.count,
      days: pendingRequestsNotProcessable.days,
    })
  }

  return {
    employees,
    employeesWithConfig,
    vacationBalances: vlBalances.length,
    existingRequests,
    vld: {
      balances: {
        count: vldBalances.length,
        totalDays: sum(vldBalances.map((balance) => balance.totalDays)),
        usedDays: sum(vldBalances.map((balance) => balance.usedDays)),
        pendingDays: sum(vldBalances.map((balance) => balance.pendingDays)),
        transferredCount: transferredBalances.length,
        transferredUsedDays: sum(
          transferredBalances.map((balance) => balance.usedDays)
        ),
        transferredPendingDays: sum(
          transferredBalances.map((balance) => balance.pendingDays)
        ),
      },
      balancesWithoutVl: {
        count: balancesWithoutVl.length,
        totalDays: sum(
          balancesWithoutVl.map((balance) => balance.totalDays)
        ),
        usedDays: sum(
          balancesWithoutVl.map((balance) => balance.usedDays)
        ),
        pendingDays: sum(
          balancesWithoutVl.map((balance) => balance.pendingDays)
        ),
      },
      requests: {
        count: vldRequests.length,
        days: sum(vldRequests.map((request) => request.days)),
        byStatus: requestStatusSummary(vldRequests),
      },
      pendingRequestsNotProcessable,
    },
    blockers,
    readyForProduction: blockers.length === 0,
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
