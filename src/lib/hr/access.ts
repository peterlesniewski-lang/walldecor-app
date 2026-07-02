export type HrRole = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'

export type HrSessionLike = {
  user: {
    role: HrRole
    employeeId?: string | null
  }
}

export type HrEmployeeAccessRecord = {
  id: string
  divisionId?: string | null
  active?: boolean | null
}

export const HR_NO_EMPLOYEE_ACCESS_ID = '__hr_no_employee_access__'
export const HR_NO_EMPLOYEE_ACCESS_WHERE = { id: HR_NO_EMPLOYEE_ACCESS_ID }

export function canViewConfidentialHrData(session: HrSessionLike) {
  return session.user.role === 'ADMIN'
}

export function getScopedEmployeeWhere(
  session: HrSessionLike,
  viewerEmployee?: HrEmployeeAccessRecord | null
): Record<string, unknown> {
  if (session.user.role === 'ADMIN') return {}

  if (session.user.role === 'EMPLOYEE') {
    return session.user.employeeId ? { id: session.user.employeeId } : HR_NO_EMPLOYEE_ACCESS_WHERE
  }

  if (viewerEmployee?.divisionId) {
    return { active: true, divisionId: viewerEmployee.divisionId }
  }

  return HR_NO_EMPLOYEE_ACCESS_WHERE
}

export function canViewEmployeeRecord(
  session: HrSessionLike,
  employee: HrEmployeeAccessRecord,
  viewerEmployee?: HrEmployeeAccessRecord | null
) {
  if (session.user.role === 'ADMIN') return true

  if (session.user.role === 'EMPLOYEE') {
    return Boolean(session.user.employeeId) && employee.id === session.user.employeeId
  }

  return Boolean(
    viewerEmployee?.divisionId &&
      employee.active !== false &&
      employee.divisionId === viewerEmployee.divisionId
  )
}

export function stripConfidentialEmployeeRelations<T extends Record<string, unknown>>(employee: T) {
  const {
    contracts: _contracts,
    additionalContracts: _additionalContracts,
    salaryHistory: _salaryHistory,
    ...safeEmployee
  } = employee

  return safeEmployee
}
