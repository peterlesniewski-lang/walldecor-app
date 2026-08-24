import { describe, expect, it } from 'vitest'
import { canManageInstallationCatalog } from '@/lib/installations/access'

describe('installation catalog administration access', () => {
  it('allows only ADMIN and MANAGER to edit catalog entries and publish templates', () => {
    expect(canManageInstallationCatalog({ role: 'ADMIN', employeeId: null })).toBe(true)
    expect(canManageInstallationCatalog({ role: 'MANAGER', employeeId: null })).toBe(true)
    expect(canManageInstallationCatalog({ role: 'EMPLOYEE', employeeId: 'employee-1', employeeActive: true })).toBe(false)
    expect(canManageInstallationCatalog({ role: 'INSTALLER', employeeId: 'installer-1' })).toBe(false)
  })
})
