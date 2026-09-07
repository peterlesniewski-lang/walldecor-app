import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallationFilesPanel } from '@/components/installations/installation-files-panel'

const readyFile = {
  id: 'file-1', formSubmissionId: null, purpose: 'INTERNAL_PROJECT', questionKey: null, roomId: null, scopeId: null,
  originalFilename: 'rzut.pdf', status: 'READY', byteSize: 3, softDeletedAt: null,
  remoteDeleteStatus: 'NOT_REQUESTED', remoteDeleteAttemptCount: 0,
  remoteDeleteLastError: null, remoteDeleteNextAttemptAt: null, remoteDeletedAt: null,
}

describe('installation files panel', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

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

    await user.click(screen.getByRole('button', { name: 'Dodaj załącznik' }))
    const attachmentInput = screen.getByLabelText('Wybierz prywatny plik') as HTMLInputElement
    const attachment = new File(['pdf'], 'projekt.pdf', { type: 'application/pdf' })
    await user.upload(attachmentInput, attachment)
    expect(screen.getByRole('button', { name: 'Dokumentacja zgłoszonych problemów' }).getAttribute('aria-expanded')).toBe('false')
    await user.click(screen.getByRole('button', { name: 'Dokumentacja zgłoszonych problemów' }))
    expect(screen.queryByLabelText('ID niezgodności')).toBeNull()
    expect(screen.getByText('Ukryte drzwi nie były zgłoszone')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Dodaj zdjęcie problemu: Ukryte drzwi nie były zgłoszone' }))
    const evidenceInput = screen.getByLabelText('Wybierz plik dokumentacji problemu') as HTMLInputElement
    const evidence = new File([new Uint8Array([1, 2, 3])], 'dowod.png', { type: 'image/png' })
    await user.upload(evidenceInput, evidence)
    await user.click(screen.getByRole('button', { name: 'Dokumentacja zgłoszonych problemów' }))
    await user.click(screen.getByRole('button', { name: 'Dokumentacja zgłoszonych problemów' }))
    expect(evidenceInput.files?.[0]).toBe(evidence)
    await user.click(screen.getByRole('button', { name: 'Zapisz dokumentację problemu' }))

    await waitFor(() => expect(requests).toHaveLength(2))
    const body = requests[0].init?.body as FormData
    expect(body.get('mismatchId')).toBe('mismatch-1')
    expect(body.get('purpose')).toBeNull()
    expect((body.get('file') as File).name).toBe('dowod.png')
    expect(screen.queryByRole('button', { name: 'Dodaj zdjęcie problemu: Ukryte drzwi nie były zgłoszone' })).toBeNull()
    expect(attachmentInput.files?.[0]).toBe(attachment)
  })

  it('starts with attachments, then progressively assigns a room and scope with readable labels', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ file: readyFile }, { status: 201 })).mockResolvedValueOnce(Response.json({ files: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<InstallationFilesPanel orderId="order-1" initialFiles={[{ ...readyFile, roomId: 'room-1', scopeId: 'scope-1' }]} rooms={[{ id: 'room-1', name: 'Salon', scopes: [{ id: 'scope-1', name: 'Tapeta' }] }]} canEdit mismatches={[]} />)
    expect(screen.getByRole('heading', { name: 'Załączniki' })).toBeTruthy()
    expect(screen.getByText('Projekty, rzuty i zdjęcia pomocne przy montażu.')).toBeTruthy()
    expect(screen.getByText('Salon · Tapeta')).toBeTruthy()
    expect(screen.getByText(/Gotowy/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Dokumentacja zgłoszonych problemów' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Zapisz załącznik' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Dodaj załącznik' }))
    expect(screen.getByText('Całe zlecenie', { selector: 'p' })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Pomieszczenie pliku' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Przypisz do pomieszczenia lub zakresu' }))
    expect(screen.queryByRole('combobox', { name: 'Zakres pliku' })).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Pomieszczenie pliku' }), 'room-1')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Zakres pliku' }), 'scope-1')
    expect((screen.getByRole('combobox', { name: 'Zakres pliku' }) as HTMLSelectElement).value).toBe('scope-1')
    await user.click(screen.getByRole('button', { name: 'Przypisz do pomieszczenia lub zakresu' }))
    await user.click(screen.getByRole('button', { name: 'Przypisz do pomieszczenia lub zakresu' }))
    expect((screen.getByRole('combobox', { name: 'Zakres pliku' }) as HTMLSelectElement).value).toBe('scope-1')
    await user.upload(screen.getByLabelText('Wybierz prywatny plik'), new File(['pdf'], 'plan.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Zapisz załącznik' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get('purpose')).toBe('INTERNAL_PROJECT')
    expect(body.get('roomId')).toBe('room-1')
    expect(body.get('scopeId')).toBe('scope-1')
  })

  it('keeps the selected file through collapse and a failed upload, then clears it after success', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Brak połączenia.'))
      .mockResolvedValueOnce(Response.json({ file: readyFile }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ files: [readyFile] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<InstallationFilesPanel orderId="order-1" initialFiles={[]} rooms={[]} canEdit mismatches={[]} />)
    await user.click(screen.getByRole('button', { name: 'Dodaj załącznik' }))
    const input = screen.getByLabelText('Wybierz prywatny plik') as HTMLInputElement
    const file = new File(['pdf'], 'rzut.pdf', { type: 'application/pdf' })
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: 'Zwiń dodawanie załącznika' }))
    await user.click(screen.getByRole('button', { name: 'Dodaj załącznik' }))
    expect(input.files?.[0]).toBe(file)
    await user.click(screen.getByRole('button', { name: 'Zapisz załącznik' }))
    expect(await screen.findByText('Brak połączenia.')).toBeTruthy()
    expect(input.files?.[0]).toBe(file)
    await user.click(screen.getByRole('button', { name: 'Zapisz załącznik' }))
    await waitFor(() => expect(input.files?.length).toBe(0))
    const body = fetchMock.mock.calls[1][1].body as FormData
    expect(body.get('purpose')).toBe('INTERNAL_PROJECT')
    expect(body.get('roomId')).toBeNull()
    expect(body.get('scopeId')).toBeNull()
    expect(screen.getByRole('link', { name: /Pobierz/ }).getAttribute('href')).toBe('/api/installations/order-1/files/file-1')
  })

  it('requires explicit confirmation to discard a selected attachment', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<InstallationFilesPanel orderId="order-1" initialFiles={[]} rooms={[]} canEdit mismatches={[]} />)
    await user.click(screen.getByRole('button', { name: 'Dodaj załącznik' }))
    const input = screen.getByLabelText('Wybierz prywatny plik') as HTMLInputElement
    await user.upload(input, new File(['pdf'], 'rzut.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Anuluj dodawanie załącznika' }))
    expect(input.files?.length).toBe(1)
    expect(screen.getByRole('button', { name: 'Zapisz załącznik' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Anuluj dodawanie załącznika' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Dodaj załącznik' }))
    expect(input.files?.length).toBe(0)
  })

  it('shows files refreshed by the parent without losing an unsaved attachment draft', async () => {
    const user = userEvent.setup()
    const props = { orderId: 'order-1', rooms: [], canEdit: true, mismatches: [] }
    const { rerender } = render(<InstallationFilesPanel {...props} initialFiles={[]} />)
    await user.click(screen.getByRole('button', { name: 'Dodaj załącznik' }))
    const input = screen.getByLabelText('Wybierz prywatny plik') as HTMLInputElement
    const pendingFile = new File(['pdf'], 'moj-projekt.pdf', { type: 'application/pdf' })
    await user.upload(input, pendingFile)
    rerender(<InstallationFilesPanel {...props} initialFiles={[{ ...readyFile, purpose: 'CLIENT_QUESTION', originalFilename: 'zdjecie-klienta.jpg' }]} />)
    expect(screen.getByText('zdjecie-klienta.jpg')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Pobierz/ }).getAttribute('href')).toBe('/api/installations/order-1/files/file-1')
    expect(input.files?.[0]).toBe(pendingFile)
    expect(screen.getByRole('button', { name: 'Zapisz załącznik' })).toHaveProperty('disabled', false)
    rerender(<InstallationFilesPanel {...props} initialFiles={[]} />)
    expect(screen.queryByText('zdjecie-klienta.jpg')).toBeNull()
    expect(input.files?.[0]).toBe(pendingFile)
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
