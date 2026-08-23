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
  visitFee: null,
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

  it('hides a grandchild when an ancestor becomes NO despite its stale parent answer', async () => {
    const user = userEvent.setup()
    const recursiveProjection = {
      ...projection,
      form: {
        ...projection.form,
        questions: [
          { key: 'okna', type: 'YES_NO_UNKNOWN' as const, label: 'Czy są okna?', required: true },
          { key: 'glify', type: 'YES_NO_UNKNOWN' as const, label: 'Czy są glify?', required: true, condition: { questionKey: 'okna', equals: 'YES' } },
          { key: 'glebokosc', type: 'DIMENSION' as const, label: 'Jaka jest głębokość glifu?', required: true, condition: { questionKey: 'glify', equals: 'YES' } },
        ],
      },
    }
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={recursiveProjection} />)

    await user.click(screen.getByRole('button', { name: 'Tak' }))
    await user.click(screen.getAllByRole('button', { name: 'Tak' })[1])
    expect(screen.getByLabelText(/Jaka jest głębokość glifu/)).not.toBeNull()

    await user.click(screen.getAllByRole('button', { name: 'Nie' })[0])
    expect(screen.queryByText('Czy są glify?')).toBeNull()
    expect(screen.queryByLabelText(/Jaka jest głębokość glifu/)).toBeNull()
  })

  it('renders an ordinary file picker and an optional QR handoff without making photos visually dominant', () => {
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={projection} />)

    expect(screen.getByLabelText('Dodaj plik: Zdjęcie referencyjne')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Dodaj z telefonu' })).not.toBeNull()
    expect(screen.queryByText(/Dokumenty i zdjęcia dodamy w kroku plików/i)).toBeNull()
  })

  it('shows an approved visit-fee clause and keeps submit unavailable until the customer explicitly accepts it', async () => {
    const user = userEvent.setup()
    const feeProjection = {
      ...projection,
      visitFee: {
        grossAmount: '249.90',
        clauseText: 'Jeżeli rzeczywisty stan odbiega od formularza, może obowiązywać opłata za bezskuteczny podjazd.',
        clauseVersion: 3,
        snapshotDigest: `sha256:${'3'.repeat(64)}`,
        clientAcceptedAt: null,
      },
    }
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={feeProjection} />)

    expect(screen.getAllByText(/249,90 zł/i)).not.toHaveLength(0)
    expect((screen.getByRole('checkbox', { name: /akceptuję informację o opłacie/i }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Wyślij formularz' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('checkbox', { name: /akceptuję informację o opłacie/i }))
    expect((screen.getByRole('button', { name: 'Wyślij formularz' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('accepts a fee selected after submission without restarting the form correction flow', async () => {
    const user = userEvent.setup()
    const submittedFeeProjection = {
      ...projection,
      submission: { status: 'SUBMITTED' as const, revisionNumber: 1, draftVersion: 1, submittedAt: '2026-08-23T12:00:00.000Z', answers: [{ questionKey: 'glify', value: 'NO', isUnknown: false }] },
      canStartCorrection: true,
      visitFee: {
        grossAmount: '279.90',
        clauseText: 'Informacja o opłacie została wybrana po wcześniejszym wysłaniu formularza.',
        clauseVersion: 7,
        snapshotDigest: `sha256:${'7'.repeat(64)}`,
        clientAcceptedAt: null,
      },
    }
    const acceptedProjection = {
      ...submittedFeeProjection,
      visitFee: { ...submittedFeeProjection.visitFee, clientAcceptedAt: '2026-08-23T12:05:00.000Z' },
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(acceptedProjection), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={submittedFeeProjection} />)

    expect(screen.getByText(/Formularz został wysłany/i)).not.toBeNull()
    await user.click(screen.getByRole('checkbox', { name: /akceptuję informację o opłacie/i }))
    await user.click(screen.getByRole('button', { name: 'Potwierdź informację o opłacie' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/public/installations/' + 'a'.repeat(43) + '/accept-visit-fee', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ accepted: true, snapshotDigest: `sha256:${'7'.repeat(64)}` }),
    }))
    expect(await screen.findByText(/Informację o opłacie potwierdzono/i)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Zgłoś korektę' })).not.toBeNull()
  })

  it('requires a fresh checkbox when a 409 reload reveals a different fee snapshot', async () => {
    const user = userEvent.setup()
    const initialFeeProjection = {
      ...projection,
      submission: { status: 'SUBMITTED' as const, revisionNumber: 1, draftVersion: 1, submittedAt: '2026-08-23T12:00:00.000Z', answers: [{ questionKey: 'glify', value: 'NO', isUnknown: false }] },
      canStartCorrection: true,
      visitFee: { grossAmount: '279.90', clauseText: 'Pierwotna wersja klauzuli.', clauseVersion: 7, snapshotDigest: `sha256:${'7'.repeat(64)}`, clientAcceptedAt: null },
    }
    const changedFeeProjection = {
      ...initialFeeProjection,
      visitFee: { grossAmount: '319.00', clauseText: 'Nowsza wersja klauzuli.', clauseVersion: 8, snapshotDigest: `sha256:${'8'.repeat(64)}`, clientAcceptedAt: null },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Informacja zmieniła się.' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(changedFeeProjection), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={initialFeeProjection} />)

    const checkbox = screen.getByRole('checkbox', { name: /akceptuję informację o opłacie/i }) as HTMLInputElement
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Potwierdź informację o opłacie' }))

    expect((await screen.findAllByText(/319,00 zł brutto/i)).length).toBeGreaterThan(0)
    expect((screen.getByRole('checkbox', { name: /akceptuję informację o opłacie/i }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Potwierdź informację o opłacie' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('requires a fresh checkbox when only clause text and the opaque digest changed', async () => {
    const user = userEvent.setup()
    const initialFeeProjection = {
      ...projection,
      submission: { status: 'SUBMITTED' as const, revisionNumber: 1, draftVersion: 1, submittedAt: '2026-08-23T12:00:00.000Z', answers: [{ questionKey: 'glify', value: 'NO', isUnknown: false }] },
      canStartCorrection: true,
      visitFee: { grossAmount: '279.90', clauseText: 'Pierwotna wersja klauzuli.', clauseVersion: 7, snapshotDigest: `sha256:${'a'.repeat(64)}`, clientAcceptedAt: null },
    }
    const changedFeeProjection = {
      ...initialFeeProjection,
      visitFee: { ...initialFeeProjection.visitFee, clauseText: 'Nowa treść przy tej samej kwocie i wersji.', snapshotDigest: `sha256:${'b'.repeat(64)}` },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Informacja zmieniła się.' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(changedFeeProjection), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={initialFeeProjection} />)

    await user.click(screen.getByRole('checkbox', { name: /akceptuję informację o opłacie/i }))
    await user.click(screen.getByRole('button', { name: 'Potwierdź informację o opłacie' }))

    expect(await screen.findByText('Nowa treść przy tej samej kwocie i wersji.')).not.toBeNull()
    expect((screen.getByRole('checkbox', { name: /akceptuję informację o opłacie/i }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Potwierdź informację o opłacie' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('resets the initial-submit checkbox after a stale same-amount clause digest conflict', async () => {
    const readyProjection = {
      ...projection,
      submission: { status: 'DRAFT' as const, revisionNumber: 1, draftVersion: 0, submittedAt: null, answers: [{ questionKey: 'glify', value: 'UNKNOWN', isUnknown: true }] },
      visitFee: { grossAmount: '249.90', clauseText: 'Treść widziana przed wysłaniem.', clauseVersion: 3, snapshotDigest: `sha256:${'c'.repeat(64)}`, clientAcceptedAt: null },
    }
    const refreshedProjection = {
      ...readyProjection,
      visitFee: { ...readyProjection.visitFee, clauseText: 'Treść zmieniona bez zmiany kwoty i wersji.', snapshotDigest: `sha256:${'d'.repeat(64)}` },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Informacja o opłacie zmieniła się.' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(refreshedProjection), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={readyProjection} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /akceptuję informację o opłacie/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Wyślij formularz' }))
    await act(async () => {})

    expect(await screen.findByText('Treść zmieniona bez zmiany kwoty i wersji.')).not.toBeNull()
    expect((screen.getByRole('checkbox', { name: /akceptuję informację o opłacie/i }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Wyślij formularz' }) as HTMLButtonElement).disabled).toBe(true)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      visitFeeAccepted: true,
      visitFeeSnapshotDigest: `sha256:${'c'.repeat(64)}`,
    })
  })

  it('retries the exact initial-submit fee digest after a transport failure', async () => {
    const readyProjection = {
      ...projection,
      submission: { status: 'DRAFT' as const, revisionNumber: 1, draftVersion: 0, submittedAt: null, answers: [{ questionKey: 'glify', value: 'UNKNOWN', isUnknown: true }] },
      visitFee: { grossAmount: '249.90', clauseText: 'Treść zaakceptowana przed próbą wysłania.', clauseVersion: 3, snapshotDigest: `sha256:${'e'.repeat(64)}`, clientAcceptedAt: null },
    }
    const submitted = { ...readyProjection.submission, status: 'SUBMITTED' as const, submittedAt: '2026-08-23T12:00:00.000Z' }
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify(readyProjection), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(submitted), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={readyProjection} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /akceptuję informację o opłacie/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Wyślij formularz' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Wyślij formularz' }))
    await act(async () => {})

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const retryBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body))
    expect(retryBody).toEqual(firstBody)
    expect(firstBody).toMatchObject({ visitFeeAccepted: true, visitFeeSnapshotDigest: `sha256:${'e'.repeat(64)}` })
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

  it('restarts a submit from the read-back draft after a deterministic 409 conflict', async () => {
    const readyProjection = {
      ...projection,
      submission: { status: 'DRAFT' as const, revisionNumber: 1, draftVersion: 0, submittedAt: null, answers: [{ questionKey: 'glify', value: 'UNKNOWN', isUnknown: true }] },
    }
    const currentDraft = {
      ...readyProjection,
      submission: { ...readyProjection.submission, draftVersion: 1 },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Formularz został zapisany w nowszej wersji.' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(currentDraft), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'SUBMITTED', revisionNumber: 1, draftVersion: 1, submittedAt: '2026-08-22T12:00:00.000Z', answers: [{ questionKey: 'glify', value: 'UNKNOWN', isUnknown: true }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={readyProjection} />)

    fireEvent.click(screen.getByRole('button', { name: 'Wyślij formularz' }))
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert').textContent).toMatch(/nowszej wersji|spróbuj ponownie/i)

    fireEvent.click(screen.getByRole('button', { name: 'Wyślij formularz' }))
    await act(async () => {})

    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const retry = JSON.parse(String(fetchMock.mock.calls[2][1]?.body))
    expect(first).toMatchObject({ revisionNumber: 1, draftVersion: 0 })
    expect(retry).toMatchObject({ revisionNumber: 1, draftVersion: 1 })
    expect(retry.clientMutationId).not.toBe(first.clientMutationId)
    expect(screen.getByText(/Formularz został wysłany/)).not.toBeNull()
  })

  it('does not retry a deterministic validation failure until the customer acts again', async () => {
    const readyProjection = {
      ...projection,
      submission: { status: 'DRAFT' as const, revisionNumber: 1, draftVersion: 0, submittedAt: null, answers: [{ questionKey: 'glify', value: 'UNKNOWN', isUnknown: true }] },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Uzupełnij wymagane widoczne odpowiedzi.' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(readyProjection), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={readyProjection} />)

    fireEvent.click(screen.getByRole('button', { name: 'Wyślij formularz' }))
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert').textContent).toContain('Uzupełnij wymagane widoczne odpowiedzi.')
    expect(screen.getByRole('button', { name: 'Wyślij formularz' })).not.toBeNull()
  })

  it('accepts a lost submit response only after public readback confirms the same submitted revision', async () => {
    const readyProjection = {
      ...projection,
      submission: { status: 'DRAFT' as const, revisionNumber: 1, draftVersion: 0, submittedAt: null, answers: [{ questionKey: 'glify', value: 'UNKNOWN', isUnknown: true }] },
    }
    const submittedProjection = {
      ...readyProjection,
      submission: { ...readyProjection.submission, status: 'SUBMITTED' as const, submittedAt: '2026-08-22T12:00:00.000Z' },
    }
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockResolvedValueOnce(new Response(JSON.stringify(submittedProjection), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientInstallationForm token={'a'.repeat(43)} initialProjection={readyProjection} />)

    fireEvent.click(screen.getByRole('button', { name: 'Wyślij formularz' }))
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ revisionNumber: 1, draftVersion: 0 })
    expect(screen.getByText(/Formularz został wysłany/)).not.toBeNull()
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
