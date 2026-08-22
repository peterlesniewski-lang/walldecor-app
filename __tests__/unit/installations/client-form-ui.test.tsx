import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ClientInstallationForm } from '@/components/installations/client-form/client-installation-form'

const projection = {
  brand: 'WallDecor' as const,
  number: 'MON-20260822-0001',
  clientName: 'Marta',
  coordinator: 'Anna Opiekun',
  rooms: [{ name: 'Salon', scopes: [{ name: 'Ściana z glifem', products: [{ name: 'Listwa L-10', code: 'L-10', manufacturer: 'WallDecor', collection: null }] }] }],
  form: {
    templateVersion: 1,
    questions: [
      { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', required: true, riskLevel: 'HIGH' },
      { key: 'glify-cm', type: 'DIMENSION', label: 'Ile cm ma glif?', required: true, condition: { questionKey: 'glify', equals: 'YES' } },
      { key: 'referencja', type: 'FILE', label: 'Zdjęcie referencyjne', required: true },
    ],
  },
  submission: { id: 'draft-1', status: 'DRAFT' as const, revisionNumber: 1, draftVersion: 0, submittedAt: null, answers: [] },
  canStartCorrection: false,
}

describe('client installation form', () => {
  it('uses the job map and reveals cm only for YES while UNKNOWN is a clear nonblocking state', async () => {
    const user = userEvent.setup()
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={projection} />)

    expect(screen.getByRole('heading', { name: 'Mapa zlecenia' })).not.toBeNull()
    expect(screen.getByText('Salon')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Wszystko zapisane')
    expect(screen.queryByLabelText(/Ile cm ma glif/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Tak' }))
    expect(screen.getByLabelText(/Ile cm ma glif/)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Nie wiem' }))
    expect(screen.queryByLabelText(/Ile cm ma glif/)).toBeNull()
    expect(screen.getByText(/Ustalimy przed montażem/)).not.toBeNull()
  })

  it('does not render a fake FILE upload before Task 5', () => {
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={projection} />)

    expect(screen.getByText(/Dokumenty i zdjęcia dodamy w kroku plików/i)).not.toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeNull()
    expect(screen.getByTestId('task5-file-step').getAttribute('data-task5-replace')).toBe('private-upload-handoff')
  })
})
