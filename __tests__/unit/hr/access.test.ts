import { describe, expect, it } from 'vitest'
import {
  canViewConfidentialHrData,
  canViewEmployeeRecord,
  getScopedEmployeeWhere,
  HR_NO_EMPLOYEE_ACCESS_WHERE,
} from '@/lib/hr/access'

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'INSTALLER', employeeId: string | null = null) {
  return {
    user: {
      id: `${role.toLowerCase()}-user`,
      role,
      employeeId,
    },
  }
}

describe('HR access policy', () => {
  it('allows only admins to view confidential HR data', () => {
    expect(canViewConfidentialHrData(session('ADMIN'))).toBe(true)
    expect(canViewConfidentialHrData(session('MANAGER', 'manager-1'))).toBe(false)
    expect(canViewConfidentialHrData(session('EMPLOYEE', 'employee-1'))).toBe(false)
  })

  it('scopes admin employee lists to all records', () => {
    expect(getScopedEmployeeWhere(session('ADMIN'))).toEqual({})
  })

  it('scopes employee lists to their own linked employee record', () => {
    expect(getScopedEmployeeWhere(session('EMPLOYEE', 'employee-1'))).toEqual({ id: 'employee-1' })
    expect(getScopedEmployeeWhere(session('EMPLOYEE'))).toEqual(HR_NO_EMPLOYEE_ACCESS_WHERE)
  })

  it('scopes manager lists to the linked manager division only', () => {
    expect(getScopedEmployeeWhere(session('MANAGER', 'manager-1'), { id: 'manager-1', divisionId: 'JAG' })).toEqual({
      active: true,
      divisionId: 'JAG',
    })
    expect(getScopedEmployeeWhere(session('MANAGER', 'manager-1'))).toEqual(HR_NO_EMPLOYEE_ACCESS_WHERE)
  })

  it('allows employees to open only their own profile', () => {
    expect(canViewEmployeeRecord(session('EMPLOYEE', 'employee-1'), { id: 'employee-1', divisionId: 'JAG' })).toBe(true)
    expect(canViewEmployeeRecord(session('EMPLOYEE', 'employee-1'), { id: 'employee-2', divisionId: 'JAG' })).toBe(false)
  })

  it('allows managers to open only employees in their division', () => {
    const manager = { id: 'manager-1', divisionId: 'JAG' }

    expect(canViewEmployeeRecord(session('MANAGER', 'manager-1'), { id: 'employee-1', divisionId: 'JAG' }, manager)).toBe(true)
    expect(canViewEmployeeRecord(session('MANAGER', 'manager-1'), { id: 'employee-2', divisionId: 'PUL' }, manager)).toBe(false)
    expect(canViewEmployeeRecord(session('MANAGER', 'manager-1'), { id: 'employee-3', divisionId: 'JAG', active: false }, manager)).toBe(false)
  })

  it('fails closed for installers even if a caller supplies a privileged employee record', () => {
    const suppliedViewer = { id: 'installer-1', divisionId: 'JAG' }
    const installer = session('INSTALLER', 'installer-1')

    expect(getScopedEmployeeWhere(installer, suppliedViewer)).toEqual(HR_NO_EMPLOYEE_ACCESS_WHERE)
    expect(canViewEmployeeRecord(installer, { id: 'employee-1', divisionId: 'JAG' }, suppliedViewer)).toBe(false)
  })
})
