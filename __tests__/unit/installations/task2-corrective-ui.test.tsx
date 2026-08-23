import { createElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallationOrderDetail } from '@/components/installations/order-detail'
import { RoomScopeEditor } from '@/components/installations/room-scope-editor'
import { TemplateBuilder } from '@/components/installations/template-builder'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const archivedOrder = {
  id: 'archived-order', number: 'MON-ARCHIVED', status: 'ARCHIVED', archivedAt: '2026-08-22T12:00:00.000Z',
  client: { name: 'Archiwalny klient', email: 'archived@example.test', phone: '+48 501 000 000' },
  addressStreet: 'Dobra', addressBuildingNumber: '1', addressApartmentNumber: null, addressPostalCode: '00-001', addressCity: 'Warszawa',
  primaryEmployee: { firstName: 'Anna', lastName: 'Opiekun' }, backupEmployee: { firstName: 'Bartek', lastName: 'Zastępca' },
}

const rooms = [{ id: 'room-1', name: 'Salon', sortOrder: 0, measurements: [], scopes: [{ id: 'scope-1', name: 'Ściana', sortOrder: 0, measurements: [], scopeProducts: [] }] }]
const catalog = [{ id: 'category-1', name: 'Tapety', types: [{ id: 'type-1', name: 'Winylowe', products: [{ id: 'product-1', name: 'Ciepły len', code: null }] }] }]
const publishedTemplates = [{
  id: 'template-v1', familyId: 'template-family', name: 'Wywiad o glifach', version: 1, status: 'PUBLISHED',
  questionDefinitions: [{ id: 'question-1', key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', help: null, riskLevel: 'LOW', optionsJson: null, conditionJson: null, sortOrder: 0 }],
}]

describe('Task 2 corrective UI invariants', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('renders an archived order as read-only even if a stale canEdit prop is true', () => {
    render(createElement(InstallationOrderDetail, {
      order: archivedOrder, employees: [], canEdit: true, canArchive: true, rooms, catalog,
    } as never))

    expect(screen.getByText('Karta jest zarchiwizowana. Historia i odpowiedzialność pozostają zachowane.')).toBeTruthy()
    expect(screen.queryByLabelText('Nazwa pomieszczenia')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edytuj pokój Salon' })).toBeNull()
    expect(screen.queryByLabelText('Produkt dla Ściana')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archiwizuj zlecenie' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Formularz klienta' })).toBeTruthy()
    expect(screen.queryByLabelText('Wersja formularza dla zlecenia')).toBeNull()
  })

  it('does not render client answers, evidence or link controls for a non-coordinator detail view', () => {
    render(createElement(InstallationOrderDetail, {
      order: { ...archivedOrder, id: 'installer-order', archivedAt: null, status: 'NEW' },
      employees: [],
      canEdit: false,
      rooms,
      catalog,
      clientLinks: [{ id: 'private-link', expiresAt: '2027-01-01T00:00:00.000Z', revokedAt: null, createdAt: '2026-08-22T12:00:00.000Z', lastOpenedAt: null }],
      clarifications: [{
        id: 'private-clarification', status: 'OPEN', isBlocking: true, questionKey: 'glify',
        reason: 'Klient wskazał odpowiedź.', revisionNumber: 1, answer: 'UNKNOWN',
        createdAt: '2026-08-22T12:00:00.000Z', resolution: null, resolutionNote: null, evidenceReference: 'wewnętrzny-dowód',
      }],
      readiness: { isReady: false, openBlockingCount: 1, submittedCount: 1 },
      formRevisions: [{ revisionNumber: 1, status: 'SUBMITTED', submittedAt: '2026-08-22T12:00:00.000Z', answers: [{ questionKey: 'glify', normalizedValue: 'UNKNOWN', isUnknown: true }] }],
    } as never))

    expect(screen.queryByText('Bezpieczny link do przygotowania montażu')).toBeNull()
    expect(screen.queryByText('Wymaga ustalenia przed terminem montażu')).toBeNull()
    expect(screen.queryByText('wewnętrzny-dowód')).toBeNull()
    expect(screen.queryByText('Wersje odpowiedzi klienta')).toBeNull()
  })

  it('lets an authorized editor pin exactly one published form snapshot from the order detail', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'snapshot-1', templateId: 'template-v1', templateVersion: 1, schemaJson: JSON.stringify({ name: 'Wywiad o glifach', version: 1, questions: [{ label: 'Czy są glify?' }] }) }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(InstallationOrderDetail, {
      order: { ...archivedOrder, id: 'active-order', archivedAt: null, status: 'NEW' }, employees: [], canEdit: true, canArchive: false, rooms, catalog, publishedTemplates,
    } as never))

    await user.selectOptions(screen.getByLabelText('Wersja formularza dla zlecenia'), 'template-v1')
    await user.click(screen.getByRole('button', { name: 'Przypnij formularz' }))

    await waitFor(() => expect(screen.getByText('Wywiad o glifach · wersja 1')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/installations/active-order/form-snapshot', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ templateId: 'template-v1' })
    expect(screen.queryByLabelText('Wersja formularza dla zlecenia')).toBeNull()
  })

  it('does not put measurement provenance fields into the browser request', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'measurement-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => rooms })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(RoomScopeEditor, { orderId: 'order-1', initialRooms: rooms, catalog, canEdit: true }))

    await user.type(screen.getByLabelText('Nazwa pomiaru w Salon'), 'Szerokość glifu')
    await user.type(screen.getByLabelText('Wartość pomiaru w Salon'), '12.5')
    await user.click(screen.getByRole('button', { name: 'Dodaj pomiar' }))

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(request.body as string)
    expect(body).not.toHaveProperty('source')
    expect(body).not.toHaveProperty('authorId')
    expect(body).not.toHaveProperty('authorContext')
  })

  it('lets an administrator select and edit the older of two existing drafts', async () => {
    const user = userEvent.setup()
    const older = { id: 'draft-old', familyId: 'family-old', name: 'Starszy szkic', version: 1, status: 'DRAFT', questionDefinitions: [] }
    const newer = { id: 'draft-new', familyId: 'family-new', name: 'Nowszy szkic', version: 1, status: 'DRAFT', questionDefinitions: [] }
    render(createElement(TemplateBuilder, { initialTemplates: [newer, older] } as never))

    const picker = screen.getByLabelText('Wybierz szkic do edycji')
    await user.selectOptions(picker, older.id)

    expect(screen.getByRole('heading', { name: 'Starszy szkic' })).toBeTruthy()
  })

  it('keeps the real publish action disabled for a detached draft map', () => {
    const detachedDraft = {
      id: 'draft-detached', familyId: 'family-detached', name: 'Uszkodzony szkic', version: 1, status: 'DRAFT',
      questionDefinitions: [
        { id: 'question-root', key: 'okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?', help: null, riskLevel: 'LOW', optionsJson: null, conditionJson: null, sortOrder: 0 },
        { id: 'question-detached', key: 'glify', type: 'TEXT', label: 'Czy są glify?', help: null, riskLevel: 'LOW', optionsJson: null, conditionJson: JSON.stringify({ questionKey: 'brak', equals: 'YES' }), sortOrder: 1 },
      ],
    }
    render(createElement(TemplateBuilder, { initialTemplates: [detachedDraft] } as never))

    expect(screen.getByRole('button', { name: 'Opublikuj v1' })).toHaveProperty('disabled', true)
  })

  it('persists the complete reordered question list through the template lifecycle API', async () => {
    const user = userEvent.setup()
    const draft = {
      id: 'draft-order', familyId: 'family-order', name: 'Szkic kolejności', version: 1, status: 'DRAFT',
      questionDefinitions: [
        { id: 'question-root', key: 'okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?', help: null, riskLevel: 'LOW', optionsJson: null, conditionJson: null, sortOrder: 0 },
        { id: 'question-first', key: 'pierwsze', type: 'TEXT', label: 'Pierwsze pytanie', help: null, riskLevel: 'LOW', optionsJson: null, conditionJson: JSON.stringify({ questionKey: 'okna', equals: 'YES' }), sortOrder: 1 },
        { id: 'question-second', key: 'drugie', type: 'TEXT', label: 'Drugie pytanie', help: null, riskLevel: 'LOW', optionsJson: null, conditionJson: JSON.stringify({ questionKey: 'okna', equals: 'YES' }), sortOrder: 2 },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => draft })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(TemplateBuilder, { initialTemplates: [draft] } as never))

    await user.click(screen.getByRole('button', { name: 'Góra: Drugie pytanie' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/installations/templates/draft-order', expect.objectContaining({ method: 'PATCH' }))
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body.questions.map((question: { key: string }) => question.key)).toEqual(['okna', 'drugie', 'pierwsze'])
  })

  it('keeps publish unavailable after a rejected local PATCH while the recoverable draft remains visible', async () => {
    const user = userEvent.setup()
    const draft = {
      id: 'draft-rejected', familyId: 'family-rejected', name: 'Szkic do ponowienia', version: 1, status: 'DRAFT',
      questionDefinitions: [
        { id: 'question-root', key: 'okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?', help: null, riskLevel: 'LOW', optionsJson: null, conditionJson: null, sortOrder: 0 },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Nie udało się zapisać pytań. Spróbuj ponownie.' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(TemplateBuilder, { initialTemplates: [draft] } as never))

    await user.click(screen.getByRole('button', { name: 'Dodaj pytanie po odpowiedzi Tak' }))
    await user.type(screen.getByLabelText('Treść pytania'), 'Czy można wejść?')
    await user.click(screen.getByRole('button', { name: 'Zapisz pytanie' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Anuluj' }))

    expect(screen.getByText('Czy można wejść?')).toBeTruthy()
    const publish = screen.getByRole('button', { name: 'Opublikuj v1' })
    expect(publish).toHaveProperty('disabled', true)
    await user.click(publish)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resets designer edit, deletion and test state when the active draft changes', async () => {
    const user = userEvent.setup()
    const draftA = {
      id: 'draft-a', familyId: 'family-a', name: 'Szkic A', version: 1, status: 'DRAFT',
      questionDefinitions: [{ id: 'question-a', key: 'a', type: 'YES_NO_UNKNOWN', label: 'Pytanie A', help: null, riskLevel: 'LOW', optionsJson: null, conditionJson: null, sortOrder: 0 }],
    }
    const draftB = {
      id: 'draft-b', familyId: 'family-b', name: 'Szkic B', version: 1, status: 'DRAFT',
      questionDefinitions: [{ id: 'question-b', key: 'b', type: 'YES_NO_UNKNOWN', label: 'Pytanie B', help: null, riskLevel: 'LOW', optionsJson: null, conditionJson: null, sortOrder: 0 }],
    }
    render(createElement(TemplateBuilder, { initialTemplates: [draftA, draftB] } as never))
    const picker = screen.getByLabelText('Wybierz szkic do edycji')

    await user.click(screen.getByRole('button', { name: 'Edytuj pytanie Pytanie A' }))
    await user.selectOptions(picker, draftB.id)
    expect(screen.getByText('Pytanie B')).toBeTruthy()
    expect(screen.queryByLabelText('Treść pytania')).toBeNull()

    await user.selectOptions(picker, draftA.id)
    await user.click(screen.getByRole('button', { name: 'Usuń pytanie Pytanie A' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    await user.selectOptions(picker, draftB.id)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('Pytanie B')).toBeTruthy()

    await user.selectOptions(picker, draftA.id)
    await user.click(screen.getByRole('button', { name: 'Testuj formularz' }))
    expect(screen.getByText('Tak zobaczy to klient')).toBeTruthy()
    await user.selectOptions(picker, draftB.id)
    expect(screen.queryByText('Tak zobaczy to klient')).toBeNull()
    expect(screen.getByText('Pytanie B')).toBeTruthy()
  })

  it('renders the immutable collection snapshot beside historic product details', () => {
    const roomsWithCollection = [{
      id: 'room-collection', name: 'Salon kolekcji', sortOrder: 0, measurements: [], scopes: [{
        id: 'scope-collection', name: 'Ściana kolekcji', sortOrder: 0, measurements: [], scopeProducts: [{
          id: 'scope-product-collection', catalogProductId: 'product-collection', productNameSnapshot: 'Misty Grey', productCodeSnapshot: 'MG-01', manufacturerSnapshot: 'WallDecor', collectionSnapshot: 'Misty', sortOrder: 0,
        }],
      }],
    }]
    render(createElement(RoomScopeEditor, { orderId: 'order-collection', initialRooms: roomsWithCollection, catalog, canEdit: false }))

    expect(screen.getByText('Kolekcja: Misty')).toBeTruthy()
  })
})
