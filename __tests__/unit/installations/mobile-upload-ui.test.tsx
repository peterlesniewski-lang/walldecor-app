import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileUpload } from '@/components/installations/client-form/mobile-upload'

describe('mobile QR upload UI', () => {
  it('offers a camera and an ordinary device picker without exposing a file list or download control', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ questionKey: 'zdjecie' }), { status: 200 })))
    render(<MobileUpload code={'a'.repeat(43)} />)
    const camera = await screen.findByLabelText('Zrób zdjęcie') as HTMLInputElement
    const library = screen.getByLabelText('Wybierz z urządzenia') as HTMLInputElement
    expect(camera.type).toBe('file')
    expect(camera.getAttribute('capture')).toBe('environment')
    expect(library.type).toBe('file')
    expect(library.hasAttribute('capture')).toBe(false)
    expect(screen.queryByRole('link', { name: /pobierz/i })).toBeNull()
  })
})
