import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientInstallationForm } from '@/components/installations/client-form/client-installation-form'

const projection = {
  brand: 'WallDecor' as const,
  number: 'MON-20260822-0001',
  contact: { label: 'WallDecor', email: 'info@walldecor.pl' },
  rooms: [{ name: 'Salon', scopes: [{ name: 'Ściana z glifem', products: [{ name: 'Listwa L-10', code: 'L-10', manufacturer: 'WallDecor', collection: null }] }] }],
  form: {
    templateVersion: 1,
    questions: [
      { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', required: true, riskLevel: 'HIGH' },
      { key: 'glify-cm', type: 'DIMENSION', label: 'Ile cm ma glif?', required: true, condition: { questionKey: 'glify', equals: 'YES' } },
      { key: 'referencja', type: 'FILE', label: 'Zdjęcie referencyjne', required: true },
    ],
  },
  submission: { status: 'DRAFT' as const, revisionNumber: 1, draftVersion: 0, submittedAt: null, answers: [] },
  canStartCorrection: false,
}

describe('client installation form', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  it('uses the job map and reveals cm only for YES while UNKNOWN is a clear nonblocking state', async () => {
    const user = userEvent.setup()
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={projection} />)

    expect(screen.getByRole('heading', { name: 'Mapa zlecenia' })).not.toBeNull()
    expect(screen.getByText('Salon')).not.toBeNull()
    expect(screen.getByText(/Kontakt: WallDecor/i)).not.toBeNull()
    expect(screen.queryByText('Marta')).toBeNull()
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

  it('serializes rapid answer changes so an older delayed save cannot overwrite UNKNOWN', async () => {
    vi.useFakeTimers()
    const deferred: Array<{ resolve: (response: Response) => void }> = []
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => deferred.push({ resolve })))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={projection} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tak' }))
    expect(screen.getByRole('status').textContent).toContain('Zapisywanie…')
    act(() => { vi.advanceTimersByTime(550) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Nie wiem' }))
    act(() => { vi.advanceTimersByTime(550) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { deferred[0].resolve(new Response(JSON.stringify({ status: 'DRAFT', revisionNumber: 1, draftVersion: 1, submittedAt: null, answers: [{ questionKey: 'glify', value: 'YES', isUnknown: false }] }), { status: 200 })) })
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { deferred[1].resolve(new Response(JSON.stringify({ status: 'DRAFT', revisionNumber: 1, draftVersion: 2, submittedAt: null, answers: [{ questionKey: 'glify', value: 'UNKNOWN', isUnknown: true }] }), { status: 200 })) })
    await act(async () => {})

    expect(screen.getByRole('button', { name: 'Nie wiem' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Tak' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('status').textContent).toContain('Wszystko zapisane')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ revisionNumber: 1, draftVersion: 0 })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ revisionNumber: 1, draftVersion: 1 })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).clientMutationId)
      .not.toBe(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).clientMutationId)
  })

  it('retries the exact same autosave mutation after a transport failure instead of minting a duplicate', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline-readback'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'DRAFT', revisionNumber: 1, draftVersion: 1, submittedAt: null, answers: [{ questionKey: 'glify', value: 'UNKNOWN', isUnknown: true }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={projection} />)

    fireEvent.click(screen.getByRole('button', { name: 'Nie wiem' }))
    act(() => { vi.advanceTimersByTime(550) })
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toContain('Wystąpił błąd zapisu')
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const retry = JSON.parse(String(fetchMock.mock.calls[2][1]?.body))
    expect(retry).toEqual(first)
    expect(screen.getByRole('status').textContent).toContain('Wszystko zapisane')
  })

  it('reconciles a committed autosave when its HTTP response is lost without issuing a duplicate save', async () => {
    vi.useFakeTimers()
    const committedProjection = {
      ...projection,
      submission: { status: 'DRAFT' as const, revisionNumber: 1, draftVersion: 1, submittedAt: null, answers: [{ questionKey: 'glify', value: 'UNKNOWN', isUnknown: true }] },
    }
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockResolvedValueOnce(new Response(JSON.stringify(committedProjection), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={projection} />)

    fireEvent.click(screen.getByRole('button', { name: 'Nie wiem' }))
    act(() => { vi.advanceTimersByTime(550) })
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('/api/public/installations/')
    expect(screen.getByRole('status').textContent).toContain('Wszystko zapisane')
    expect(screen.getByRole('button', { name: 'Nie wiem' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('sends an explicit clear for an optional visible text answer and keeps it blank after save', async () => {
    vi.useFakeTimers()
    const optionalProjection = {
      ...projection,
      form: { ...projection.form, questions: [{ key: 'opis', type: 'TEXT' as const, label: 'Opis dodatkowy' }] },
      submission: { status: 'DRAFT' as const, revisionNumber: 1, draftVersion: 0, submittedAt: null, answers: [{ questionKey: 'opis', value: 'Było', isUnknown: false }] },
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'DRAFT', revisionNumber: 1, draftVersion: 1, submittedAt: null, answers: [],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={optionalProjection} />)

    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść odpowiedź: Opis dodatkowy' }))
    act(() => { vi.advanceTimersByTime(550) })
    await act(async () => {})

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.answers).toEqual([{ questionKey: 'opis', value: null }])
    expect((screen.getByLabelText('Opis dodatkowy') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByRole('status').textContent).toContain('Wszystko zapisane')
  })
})
