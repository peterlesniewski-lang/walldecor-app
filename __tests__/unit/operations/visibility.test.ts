import { describe, expect, it } from 'vitest'
import {
  canBypassOperationVisibility,
  canManageOperationVisibility,
  isOperationResourceType,
} from '@/lib/operations/visibility'

describe('operation visibility roles', () => {
  it('only lets ADMIN manage grants', () => {
    expect(canManageOperationVisibility({ id: 'admin-1', role: 'ADMIN' })).toBe(true)
    expect(canManageOperationVisibility({ id: 'manager-1', role: 'MANAGER' })).toBe(false)
    expect(canManageOperationVisibility({ id: 'employee-1', role: 'EMPLOYEE' })).toBe(false)
  })

  it('lets ADMIN and MANAGER bypass read filtering', () => {
    expect(canBypassOperationVisibility({ id: 'admin-1', role: 'ADMIN' })).toBe(true)
    expect(canBypassOperationVisibility({ id: 'manager-1', role: 'MANAGER' })).toBe(true)
    expect(canBypassOperationVisibility({ id: 'employee-1', role: 'EMPLOYEE' })).toBe(false)
  })

  it('accepts only supported operation resource types', () => {
    expect(isOperationResourceType('procedure')).toBe(true)
    expect(isOperationResourceType('template')).toBe(true)
    expect(isOperationResourceType('run')).toBe(true)
    expect(isOperationResourceType('employee-document')).toBe(false)
  })
})
