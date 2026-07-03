import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PasswordResetRequestForm } from '@/components/shared/password-reset-request-form'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PasswordResetRequestForm', () => {
  it('submits an email address and shows the accepted message', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'Sprawdź skrzynkę email.' }),
    } as Response)

    render(<PasswordResetRequestForm />)

    await userEvent.type(screen.getByLabelText('Email'), 'jan.kowalski@walldecor.pl')
    await userEvent.click(screen.getByRole('button', { name: 'Wyślij hasło tymczasowe' }))

    await waitFor(() => {
      expect(screen.getByText('Sprawdź skrzynkę email.')).toBeTruthy()
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/account/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jan.kowalski@walldecor.pl' }),
    })
  })
})
