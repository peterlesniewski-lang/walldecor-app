import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallationFilesPanel } from '@/components/installations/installation-files-panel'

const readyFile = {
  id: 'file-1', purpose: 'INTERNAL_PROJECT', questionKey: null, roomId: null, scopeId: null,
  originalFilename: 'rzut.pdf', status: 'READY', byteSize: 3, softDeletedAt: null,
  remoteDeleteStatus: 'NOT_REQUESTED', remoteDeleteAttemptCount: 0,
  remoteDeleteLastError: null, remoteDeleteNextAttemptAt: null, remoteDeletedAt: null,
}

describe('installation files panel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('attaches evidence by choosing a readable open mismatch instead of entering a technical id', async () => {
    const user = userEvent.setup()
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      if (init?.method === 'POST') return Response.json({ id: 'evidence-1' }, { status: 201 })
      return Response.json({ files: [] })
    }))
    render(<InstallationFilesPanel orderId="order-1" initialFiles={[]} rooms={[]} canEdit mismatches={[
      { id: 'mismatch-1', reason: 'CANNOT_PERFORM', description: 'Ukryte drzwi nie były zgłoszone' },
    ]} />)

    await user.click(screen.getByRole('button', { name: 'Dowód niezgodności' }))
    expect(screen.queryByLabelText('ID niezgodności')).toBeNull()
    expect(screen.getByRole('option', { name: 'Brak możliwości wykonania — Ukryte drzwi nie były zgłoszone' })).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Niezgodność dla dowodu' }), 'mismatch-1')
    await user.upload(screen.getByLabelText('Wybierz prywatny plik'), new File([new Uint8Array([1, 2, 3])], 'dowod.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: 'Dodaj prywatny plik' }))

    await waitFor(() => expect(requests).toHaveLength(2))
    const body = requests[0].init?.body as FormData
    expect(body.get('mismatchId')).toBe('mismatch-1')
    expect(screen.queryByRole('option', { name: 'Brak możliwości wykonania — Ukryte drzwi nie były zgłoszone' })).toBeNull()
  })

  it('shows durable remote cleanup failure without a download and lets the coordinator retry it', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, remoteDeleteStatus: 'SUCCEEDED' }))
      .mockResolvedValueOnce(Response.json({ files: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<InstallationFilesPanel orderId="order-1" initialFiles={[{
      ...readyFile,
      softDeletedAt: '2026-08-23T12:00:00.000Z',
      remoteDeleteStatus: 'RETRY',
      remoteDeleteAttemptCount: 1,
      remoteDeleteLastError: 'Serwer plików jest chwilowo niedostępny.',
      remoteDeleteNextAttemptAt: '2026-08-23T12:01:00.000Z',
    }]} rooms={[]} canEdit mismatches={[]} />)

    expect(screen.getByText(/Nie udało się usunąć z serwera/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Pobierz/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ponów usuwanie pliku rzut.pdf' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/installations/order-1/files/file-1', { method: 'DELETE' })
    expect(screen.getByText('Brak dodanych plików.')).toBeTruthy()
  })

  it('lets the coordinator recover a PENDING cleanup left by an interrupted app process', () => {
    render(<InstallationFilesPanel orderId="order-1" initialFiles={[{
      ...readyFile,
      softDeletedAt: '2026-08-23T12:00:00.000Z',
      remoteDeleteStatus: 'PENDING',
    }]} rooms={[]} canEdit mismatches={[]} />)

    expect(screen.getByText('Usuwanie z serwera w toku')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Ponów usuwanie pliku rzut.pdf' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
