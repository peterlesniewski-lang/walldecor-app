export type BalancePolicyLeaveType = {
  id: string
  code: string
  tracksBalance: boolean
  parentId: string | null
}

interface LeaveRequestBalancePolicy {
  isRemoteWork?: boolean
  isDelegation?: boolean
}

type LegacyBalancePolicyLeaveType = {
  tracksBalance: boolean
  id?: string
  code?: string
  parentId?: string | null
}

export class LeaveBalancePolicyConfigurationError extends Error {}

export function resolveLeaveBalancePoolId(
  leaveType: BalancePolicyLeaveType,
  request: LeaveRequestBalancePolicy = {}
): string | null {
  if (leaveType.code === 'VLD' && !leaveType.parentId) {
    throw new LeaveBalancePolicyConfigurationError(
      'Typ urlopu VLD nie ma skonfigurowanej nadrzędnej puli VL'
    )
  }
  if (request.isRemoteWork || request.isDelegation) return null
  if (leaveType.code === 'SL' || leaveType.code === 'UB') return null
  if (leaveType.code === 'VLD') return leaveType.parentId
  return leaveType.tracksBalance ? leaveType.id : null
}

export function shouldTrackLeaveBalance(
  leaveType: BalancePolicyLeaveType,
  request?: LeaveRequestBalancePolicy
): boolean
export function shouldTrackLeaveBalance(
  leaveType: LegacyBalancePolicyLeaveType,
  request?: LeaveRequestBalancePolicy
): boolean
export function shouldTrackLeaveBalance(
  leaveType: LegacyBalancePolicyLeaveType,
  request: LeaveRequestBalancePolicy = {}
): boolean {
  if (leaveType.id && leaveType.code && 'parentId' in leaveType) {
    return resolveLeaveBalancePoolId({
      id: leaveType.id,
      code: leaveType.code,
      tracksBalance: leaveType.tracksBalance,
      parentId: leaveType.parentId ?? null,
    }, request) !== null
  }
  return leaveType.tracksBalance && !request.isRemoteWork && !request.isDelegation
}

export function isOnDemandLeave(
  leaveType: Pick<BalancePolicyLeaveType, 'code'>,
  request: { isOnDemand?: boolean } = {}
): boolean {
  return leaveType.code === 'VLD' || request.isOnDemand === true
}
