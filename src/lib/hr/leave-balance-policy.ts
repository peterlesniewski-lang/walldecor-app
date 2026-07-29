interface LeaveTypeBalancePolicy {
  tracksBalance: boolean
}

interface LeaveRequestBalancePolicy {
  isRemoteWork?: boolean
  isDelegation?: boolean
}

export function shouldTrackLeaveBalance(
  leaveType: LeaveTypeBalancePolicy,
  request: LeaveRequestBalancePolicy = {}
) {
  return leaveType.tracksBalance && !request.isRemoteWork && !request.isDelegation
}
