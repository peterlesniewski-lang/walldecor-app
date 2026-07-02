import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AreaProfitabilityView } from '@/components/shared/area-profitability-view'
import type { AreaProfitabilityReport } from '@/lib/finance/area-profitability'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const report: AreaProfitabilityReport = {
  year: 2026,
  costCenterId: 'COMPANY',
  rows: [],
  totals: { revenue: 0, costs: 0, margin: 0, marginRate: null },
  unassignedCosts: 0,
}

const props = {
  year: 2026,
  selectedCostCenterId: 'COMPANY' as const,
  report,
  areaTags: [
    { id: 'tag-wallpapers', slug: 'wallpapers', name: 'Tapety', active: true },
    { id: 'tag-fabrics', slug: 'fabrics', name: 'Tkaniny', active: false },
  ],
  costCenters: [{ id: 'JAG', name: 'Jagiellońska' }, { id: 'PUL', name: 'Puławska' }],
  revenueEntries: [],
}

describe('AreaProfitabilityView area management', () => {
  it('shows area CRUD controls to admins', () => {
    render(<AreaProfitabilityView {...props} role="ADMIN" />)

    expect(screen.getByText('Zarządzanie obszarami')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dodaj obszar' })).toBeTruthy()
    expect(screen.getByDisplayValue('Tapety')).toBeTruthy()
    expect(screen.getByDisplayValue('Tkaniny')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ukryj' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Aktywuj' })).toBeTruthy()
  })

  it('does not show area CRUD controls to managers', () => {
    render(<AreaProfitabilityView {...props} role="MANAGER" />)

    expect(screen.queryByText('Zarządzanie obszarami')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dodaj obszar' })).toBeNull()
  })

  it('does not allow managers to edit area revenue', () => {
    render(<AreaProfitabilityView {...props} selectedCostCenterId="JAG" role="MANAGER" />)

    expect((screen.getByLabelText('Tapety 1') as HTMLInputElement).disabled).toBe(true)
  })
})
