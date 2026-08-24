import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/hr/employees/employee-select', () => ({
  EmployeeSelect: () => <select aria-label="Powiąż z pracownikiem"><option>Pracownik</option></select>,
}))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

import { UsersManagement } from '@/components/settings/users-management'

describe('installer account management UI', () => {
  it('labels an installer badge and exposes INSTALATOR in the account-creation role select', () => {
    render(<UsersManagement users={[{
      id: 'installer-user', username: 'installer', email: 'installer@example.com', name: 'Jan Instalator', role: 'INSTALLER', isActive: true,
      mustChangePassword: false, passwordChangedAt: null, createdAt: new Date(), employeeId: 'employee-1',
      employee: { firstName: 'Jan', lastName: 'Instalator', position: 'Monter', divisionId: null },
    }]} />)

    expect(screen.getByText('INSTALATOR')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj użytkownika' }))
    expect(screen.getByRole('option', { name: 'INSTALATOR' })).toBeTruthy()
  })
})
