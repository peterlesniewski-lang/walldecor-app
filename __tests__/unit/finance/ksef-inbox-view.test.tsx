import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KsefInboxView } from '@/components/shared/ksef-inbox-view'

const costCenters = [
  { id: 'GLOBAL', name: 'Koszty centralne' },
  { id: 'PUL', name: 'Puławska' },
]

const subCategories = [
  { id: 'sub-goods', name: 'Zakup towarów handlowych', category: { name: 'Cost of Goods/COGS' } },
]

const costTagGroups = [
  {
    id: 'group-role',
    name: 'Typ wydatku',
    slug: 'role',
    tags: [
      { id: 'tag-goods', name: 'goods', slug: 'goods' },
      { id: 'tag-contractors', name: 'contractors', slug: 'contractors' },
    ],
  },
]

const invoices = [
  {
    id: 'invoice-1',
    externalId: 'ksef-1',
    supplierName: 'Test Supplier',
    supplierNip: '5250007133',
    invoiceNumber: 'FV/1/2026',
    issueDate: '2026-07-01T00:00:00.000Z',
    grossAmount: 123,
    netAmount: 100,
    vatAmount: 23,
    currency: 'PLN',
    status: 'NEW' as const,
    notes: null,
    costCenterId: 'GLOBAL',
    subCategoryId: 'sub-goods',
    costCenter: costCenters[0],
    subCategory: subCategories[0],
    parts: [],
  },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('KsefInboxView', () => {
  it.each([
    { linkedCount: 1, conflictCount: 0, externalId: null },
    { linkedCount: 1, conflictCount: 1, externalId: null },
    { linkedCount: 0, conflictCount: 1, externalId: null },
    { linkedCount: 0, conflictCount: 0, externalId: 'legacy-external-id' },
  ])('shows imported KSeF summary $linkedCount/$conflictCount without changing its approved finance status', ({ linkedCount, conflictCount, externalId }) => {
    const imported = {
      ...invoices[0], id: 'imported', invoiceNumber: 'IMPORT/KSEF', externalId,
      status: 'APPROVED' as const,
      invoiceImportDraft: { id: 'draft-1', state: 'APPROVED', ksef: { linkedCount, conflictCount } },
    }
    render(<KsefInboxView initialInvoices={[imported]} initialTotal={1} initialPage={1} initialPageSize={50} initialTotalPages={1}
      initialGrossAmountTotal={123} initialCounts={{ NEW: 0, MAPPED: 0, APPROVED: 1, IGNORED: 0 }} initialRules={[]}
      costCenters={costCenters} subCategories={subCategories} />)

    const row = within(screen.getByText('IMPORT/KSEF').closest('tr')!)
    expect(row.getByText('Dodana z pliku')).toBeTruthy()
    expect(Boolean(row.queryByText('KSeF · powiązana'))).toBe(linkedCount > 0)
    expect(Boolean(row.queryByText('KSeF · wymaga rozstrzygnięcia'))).toBe(conflictCount > 0)
    expect(row.getByText('Zatwierdzona')).toBeTruthy()
    expect(row.getByRole('button', { name: 'Otwórz dokument' })).toBeTruthy()
    expect(row.queryByTitle('Podgląd faktury')).toBeNull()
  })

  it.each(['OPEN', 'APPROVED', 'ARCHIVED'] as const)('keeps an imported %s document out of all legacy editors and bulk selection', async (state) => {
    const user = userEvent.setup()
    const imported = { ...invoices[0], id: 'imported', invoiceNumber: 'IMPORT/1', source: 'MANUAL',
      invoiceImportDraft: { id: 'draft-1', state }, paymentStatus: 'UNKNOWN' as const,
      status: state === 'APPROVED' ? 'APPROVED' as const : 'MAPPED' as const,
      parts: [{ tags: [{ tagId: 'tag-goods', tag: costTagGroups[0].tags[0] }], allocations: [] }] }
    render(<KsefInboxView initialInvoices={[imported, invoices[0]]} initialTotal={2} initialPage={1} initialPageSize={50} initialTotalPages={1}
      initialGrossAmountTotal={246} initialCounts={{ NEW: 1, MAPPED: 1, APPROVED: 0, IGNORED: 0 }} initialRules={[]}
      costCenters={costCenters} subCategories={subCategories} costTagGroups={costTagGroups} />)
    const row = within(screen.getByText('IMPORT/1').closest('tr')!)
    expect(row.getByLabelText('Zaznacz fakturę IMPORT/1').matches(':disabled')).toBe(true)
    for (const title of ['Zapisz klasyfikację', 'Podgląd faktury', 'Rozbij fakturę', 'Zatwierdź do kosztów', 'Cofnij z kosztów']) {
      expect(row.queryByTitle(title)).toBeNull()
    }
    expect(row.queryByRole('button', { name: 'Edytuj tagi' })).toBeNull()
    expect(row.queryByRole('button', { name: 'Ignoruj' })).toBeNull()
    expect(row.queryByRole('button', { name: 'Zapłacona' })).toBeNull()
    expect(row.getByText('Płatność nieustalona')).toBeTruthy()
    expect(row.getByRole('button', { name: 'Otwórz dokument' })).toBeTruthy()
    if (state !== 'APPROVED') expect(row.getByText(state === 'ARCHIVED' ? 'Poza kosztami · archiwum' : 'Poza kosztami · szkic')).toBeTruthy()
    await user.click(screen.getByLabelText('Zaznacz wszystkie faktury na stronie'))
    expect((row.getByLabelText('Zaznacz fakturę IMPORT/1') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('Zaznacz fakturę FV/1/2026') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Zaznaczono: 1')).toBeTruthy()
  })

  it('has the import entry point and honestly labels partial payments', () => {
    render(<KsefInboxView initialInvoices={[{ ...invoices[0], paymentStatus: 'PARTIAL' as const }]} initialTotal={1} initialPage={1} initialPageSize={50} initialTotalPages={1}
      initialGrossAmountTotal={123} initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }} initialRules={[]}
      costCenters={costCenters} subCategories={subCategories} />)
    expect(screen.getByRole('button', { name: 'Dodaj faktury' })).toBeTruthy()
    expect(within(screen.getByRole('table')).getByText('Częściowo zapłacona')).toBeTruthy()
  })

  it('opens the real upload workspace from the current invoice list and returns without a mutation', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ drafts: [] })))
    renderCompactInvoice()
    await user.click(screen.getByRole('button', { name: 'Dodaj faktury' }))
    expect(await screen.findByText('Brak dokumentów w tym widoku.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Import faktur' })).toBeTruthy()
    expect(screen.getByLabelText('Dodaj faktury').getAttribute('type')).toBe('file')
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Wróć do faktur' }))
    expect(screen.getByRole('heading', { name: 'KSeF Inbox' })).toBeTruthy()
  })

  it.each(['DIRECT', 'STALE_LEGACY', 'STALE_PARTS'] as const)('opens the permanently linked draft through %s navigation', async (path) => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).startsWith('/api/finance/ksef/')) return new Response(JSON.stringify({
        code: 'INVOICE_IMPORT_REVIEW_REQUIRED', draftId: 'linked-draft', error: 'Wymagany edytor dokumentu.',
      }), { status: 409 })
      if (String(url).includes('/drafts?')) return new Response(JSON.stringify({ drafts: [] }))
      return new Response(JSON.stringify({ code: 'NOT_FOUND', error: 'Dokument nie jest już dostępny.' }), { status: 404 })
    })
    render(<KsefInboxView initialInvoices={[{ ...invoices[0], ...(path === 'DIRECT' ? {
      invoiceImportDraft: { id: 'linked-draft', state: 'OPEN' },
    } : {}) }]} initialTotal={1} initialPage={1} initialPageSize={50} initialTotalPages={1}
      initialGrossAmountTotal={123} initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }} initialRules={[]}
      costCenters={costCenters} subCategories={subCategories} />)
    await user.click(path === 'DIRECT' ? screen.getByRole('button', { name: 'Otwórz dokument' })
      : screen.getByTitle(path === 'STALE_PARTS' ? 'Rozbij fakturę' : 'Zapisz klasyfikację'))
    if (path === 'STALE_PARTS') await user.click(screen.getByRole('button', { name: 'Zapisz części' }))
    expect(await screen.findByText('Dokument nie jest już dostępny.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Import faktur' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Części faktury' })).toBeNull()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/finance/invoice-import/drafts/linked-draft')).toBe(true)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/finance/ksef/'))).toHaveLength(path === 'DIRECT' ? 0 : 1)
  })

  function renderCompactInvoice(status: 'NEW' | 'APPROVED' = 'NEW') {
    render(<KsefInboxView initialInvoices={[{ ...invoices[0], status, parts: [{
      tags: [{ tagId: 'tag-goods', tag: costTagGroups[0].tags[0] }], allocations: [],
    }] }]} initialTotal={120} initialPage={2} initialPageSize={50} initialTotalPages={3}
    initialGrossAmountTotal={123} initialCounts={{ NEW: 120, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
    initialRules={[]} costCenters={costCenters} subCategories={subCategories} costTagGroups={costTagGroups} />)
  }

  it.each(['CREATE', 'APPROVE'] as const)('opens the original imported draft after a duplicate rejection from legacy %s without another mutation', async (action) => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (options?.method === 'POST') return new Response(JSON.stringify({
        code: 'INVOICE_DUPLICATE', error: 'Ta faktura jest już zapisana. Otwórz istniejący dokument.',
        duplicate: { invoiceId: 'existing-invoice', draftId: 'existing-draft' },
      }), { status: 409 })
      if (String(url).includes('/drafts?')) return new Response(JSON.stringify({ drafts: [] }))
      return new Response(JSON.stringify({ code: 'NOT_FOUND', error: 'Oryginał jest chwilowo niedostępny.' }), { status: 404 })
    })
    renderCompactInvoice()
    if (action === 'CREATE') {
      await user.type(screen.getByPlaceholderText('Dostawca'), 'Existing supplier')
      await user.type(screen.getByPlaceholderText('Numer FV'), 'EXISTING/1')
      await user.type(screen.getByPlaceholderText('Brutto'), '123')
      await user.click(screen.getByRole('button', { name: 'Dodaj', exact: true }))
    } else await user.click(screen.getByTitle('Zatwierdź do kosztów'))
    const open = await screen.findByRole('button', { name: 'Otwórz istniejący dokument' })
    expect(screen.getByText('Ta faktura jest już zapisana. Otwórz istniejący dokument.')).toBeTruthy()
    if (action === 'CREATE') expect((screen.getByPlaceholderText('Numer FV') as HTMLInputElement).value).toBe('EXISTING/1')
    await user.click(open)
    expect(await screen.findByText('Oryginał jest chwilowo niedostępny.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Import faktur' })).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/finance/invoice-import/drafts/existing-draft')).toBe(true)
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })

  it('shows a legacy existing invoice by its authorized ID and retries only the failed read', async () => {
    const user = userEvent.setup()
    let reads = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (options?.method === 'POST') return new Response(JSON.stringify({
        code: 'INVOICE_DUPLICATE', error: 'Ta faktura jest już zapisana. Otwórz istniejący dokument.',
        duplicate: { invoiceId: 'existing-invoice', draftId: null },
      }), { status: 409 })
      expect(String(url)).toBe('/api/finance/ksef/invoices/existing-invoice')
      if (++reads === 1) return new Response(JSON.stringify({ error: 'Nie udało się pobrać dokumentu.' }), { status: 503 })
      return new Response(JSON.stringify({ invoice: { ...invoices[0], id: 'existing-invoice',
        invoiceNumber: 'EXISTING/1', supplierName: 'Existing supplier', status: 'APPROVED' } }))
    })
    renderCompactInvoice()
    await user.click(screen.getByTitle('Zatwierdź do kosztów'))
    await user.click(await screen.findByRole('button', { name: 'Otwórz istniejący dokument' }))
    expect(await screen.findByText('Nie udało się pobrać dokumentu.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Otwórz istniejący dokument' }))
    const detail = within(await screen.findByRole('region', { name: 'Istniejąca faktura' }))
    expect(detail.getByText('EXISTING/1')).toBeTruthy()
    expect(detail.getByText('Existing supplier')).toBeTruthy()
    expect(detail.getByText('Zatwierdzona')).toBeTruthy()
    expect(detail.getByText(/123(?:[,.]00)?\s*PLN/)).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    expect(reads).toBe(2)
    await user.click(detail.getByRole('button', { name: 'Zamknij podgląd istniejącej faktury' }))
    expect(screen.queryByRole('region', { name: 'Istniejąca faktura' })).toBeNull()
  })

  it('does not expose a duplicate navigation action for an invalid target', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 'INVOICE_DUPLICATE', error: 'Nie można otworzyć dokumentu.',
      duplicate: { invoiceId: '../../other', draftId: 'https://example.invalid' },
    }), { status: 409 }))
    renderCompactInvoice()
    await user.click(screen.getByTitle('Zatwierdź do kosztów'))
    expect(await screen.findByText('Nie można otworzyć dokumentu.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Otwórz istniejący dokument' })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows only assigned tag labels, expands on demand and preserves a collapsed draft', async () => {
    const user = userEvent.setup()
    renderCompactInvoice()
    const table = within(screen.getByRole('table'))
    expect(table.getByText('goods')).toBeTruthy()
    expect(table.queryByRole('button', { name: 'contractors' })).toBeNull()
    await user.click(table.getByRole('button', { name: 'Edytuj tagi' }))
    await user.click(table.getByRole('button', { name: 'contractors' }))
    await user.click(table.getByRole('button', { name: 'Zwiń tagi' }))
    expect(table.queryByRole('button', { name: 'contractors' })).toBeNull()
    expect(table.getByText('contractors')).toBeTruthy()
    expect(table.getByText('Niezapisane zmiany')).toBeTruthy()
    await user.click(table.getByRole('button', { name: 'Edytuj tagi' }))
    expect(table.getByRole('button', { name: 'contractors' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('renders approved tags as labels without an edit action', () => {
    renderCompactInvoice('APPROVED')
    const table = within(screen.getByRole('table'))
    expect(table.getByText('goods')).toBeTruthy()
    expect(table.queryByRole('button', { name: 'Edytuj tagi' })).toBeNull()
    expect(table.queryByRole('button', { name: 'contractors' })).toBeNull()
  })

  it('fills leap-month bounds, resets selection, preserves dates when sorting and clears them', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      invoices, total: 1, page: 1, pageSize: 50, totalPages: 1, grossAmountTotal: 123,
      counts: { NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
    })))
    renderCompactInvoice()
    await user.click(screen.getByLabelText('Zaznacz fakturę FV/1/2026'))
    fireEvent.change(screen.getByLabelText('Miesiąc wystawienia'), { target: { value: '2024-02' } })
    expect((screen.getByLabelText('Data wystawienia od') as HTMLInputElement).value).toBe('2024-02-01')
    expect((screen.getByLabelText('Data wystawienia do') as HTMLInputElement).value).toBe('2024-02-29')
    await user.click(screen.getByRole('button', { name: 'Filtruj' }))
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('issueDateFrom=2024-02-01&issueDateTo=2024-02-29')
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('page=1')
    expect((screen.getByLabelText('Zaznacz fakturę FV/1/2026') as HTMLInputElement).checked).toBe(false)
    await user.click(screen.getByRole('button', { name: /Kwota/i }))
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('issueDateFrom=2024-02-01&issueDateTo=2024-02-29')
    await user.click(screen.getByRole('button', { name: 'Wyczyść' }))
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).not.toContain('issueDate')
    expect((screen.getByLabelText('Miesiąc wystawienia') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Data wystawienia od') as HTMLInputElement).value).toBe('')
  })

  it('allows a custom date range and rejects reversed dates without requesting data', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      invoices, total: 1, page: 1, pageSize: 50, totalPages: 1, grossAmountTotal: 123,
      counts: { NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
    })))
    renderCompactInvoice()
    fireEvent.change(screen.getByLabelText('Miesiąc wystawienia'), { target: { value: '2026-09' } })
    fireEvent.change(screen.getByLabelText('Data wystawienia od'), { target: { value: '2026-10-01' } })
    expect((screen.getByLabelText('Miesiąc wystawienia') as HTMLInputElement).value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Filtruj' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('Data od nie może być późniejsza niż data do.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Data wystawienia do'), { target: { value: '2026-10-15' } })
    await user.click(screen.getByRole('button', { name: 'Filtruj' }))
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('issueDateFrom=2026-10-01&issueDateTo=2026-10-15')
  })

  it('clears month selection when showing all invoices', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      invoices, total: 1, page: 1, pageSize: 50, totalPages: 1, grossAmountTotal: 123,
      counts: { NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
    })))
    renderCompactInvoice()
    fireEvent.change(screen.getByLabelText('Miesiąc wystawienia'), { target: { value: '2026-09' } })
    await user.click(screen.getAllByRole('button', { name: 'pokaż wszystkie' })[0])
    expect((screen.getByLabelText('Miesiąc wystawienia') as HTMLInputElement).value).toBe('')
  })

  it.each(['filter', 'sort'])('blocks competing list actions while a %s request is pending', async (first) => {
    const user = userEvent.setup()
    let finish!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>((resolve) => { finish = resolve }))
    renderCompactInvoice()
    fireEvent.change(screen.getByLabelText('Miesiąc wystawienia'), { target: { value: '2026-09' } })
    const filter = screen.getByRole('button', { name: 'Filtruj' })
    const sort = screen.getByRole('button', { name: /Kwota/i })
    await user.click(first === 'filter' ? filter : sort)
    await user.click(first === 'filter' ? sort : filter)
    const callsWhilePending = fetchMock.mock.calls.length
    await act(async () => finish(new Response(JSON.stringify({
      invoices, total: 1, page: 1, pageSize: 50, totalPages: 1, grossAmountTotal: 123,
      counts: { NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
    }))))
    expect(callsWhilePending).toBe(1)
    expect(filter.matches(':disabled')).toBe(false)
    expect(sort.matches(':disabled')).toBe(false)
  })

  it.each([['2026-02', '2026-02-28'], ['2026-12', '2026-12-31'], ['2026-04', '2026-04-30']])(
    'fills correct month end for %s', (month, lastDay) => {
      renderCompactInvoice()
      fireEvent.change(screen.getByLabelText('Miesiąc wystawienia'), { target: { value: month } })
      expect((screen.getByLabelText('Data wystawienia do') as HTMLInputElement).value).toBe(lastDay)
    }
  )

  it('renders pagination controls above and below the invoice list', () => {
    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={120}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={3}
        initialGrossAmountTotal={12345.67}
        initialCounts={{ NEW: 120, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
      />
    )

    expect(screen.getAllByText('Na stronie')).toHaveLength(2)
    expect(screen.getAllByText('pokaż wszystkie')).toHaveLength(2)
    expect(screen.getAllByTitle('Poprzednia strona')).toHaveLength(2)
    expect(screen.getAllByTitle('Następna strona')).toHaveLength(2)
  })

  it('requests the first page with supplier search and amount range filters', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      invoices: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      counts: { NEW: 0, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
    })))

    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={120}
        initialPage={3}
        initialPageSize={50}
        initialTotalPages={3}
        initialGrossAmountTotal={12345.67}
        initialCounts={{ NEW: 120, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
      />
    )

    await user.type(screen.getByLabelText('Dostawca lub NIP'), 'wall')
    await user.type(screen.getByLabelText('Kwota od'), '100')
    await user.type(screen.getByLabelText('Kwota do'), '500')
    await user.click(screen.getByRole('button', { name: 'Filtruj' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/finance/ksef/invoices?page=1&pageSize=50&sortBy=issueDate&sortDir=desc&search=wall&amountMin=100&amountMax=500')
  })

  it('requests sorted invoice data after clicking a sortable column header', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      invoices: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      grossAmountTotal: 0,
      counts: { NEW: 0, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
    })))

    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={123}
        initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
      />
    )

    await user.click(screen.getByRole('button', { name: /Kwota/i }))

    expect(fetchMock).toHaveBeenCalledWith('/api/finance/ksef/invoices?page=1&pageSize=50&sortBy=grossAmount&sortDir=desc')
  })

  it('shows the gross amount sum for all invoices and then for filtered results', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      invoices: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      grossAmountTotal: 1234.56,
      counts: { NEW: 0, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
    })))

    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={120}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={3}
        initialGrossAmountTotal={12345.67}
        initialCounts={{ NEW: 120, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
      />
    )

    expect(screen.getByText('Suma faktur')).toBeTruthy()
    expect(screen.getByText('12345,67 PLN')).toBeTruthy()

    await user.type(screen.getByLabelText('Dostawca lub NIP'), 'wall')
    await user.click(screen.getByRole('button', { name: 'Filtruj' }))

    expect(await screen.findByText('Suma wyników')).toBeTruthy()
    expect(screen.getByText('1234,56 PLN')).toBeTruthy()
  })

  it('shows unpaid total and payment aging buckets', () => {
    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={120}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={3}
        initialGrossAmountTotal={12345.67}
        initialUnpaidAmountTotal={4321.99}
        initialPaymentAging={{
          OVERDUE: { count: 2, grossAmount: 1200 },
          DUE_0_7: { count: 3, grossAmount: 900 },
          DUE_8_14: { count: 0, grossAmount: 0 },
          DUE_15_30: { count: 1, grossAmount: 2221.99 },
          LATER: { count: 4, grossAmount: 700 },
          MISSING_DUE_DATE: { count: 5, grossAmount: 321.5 },
        }}
        initialCounts={{ NEW: 120, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
      />
    )

    expect(screen.getByText('Niezapłacone dokumenty')).toBeTruthy()
    expect(screen.getAllByText('Po terminie').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0-7 dni').length).toBeGreaterThan(0)
    expect(screen.getByText('4 / 700 PLN')).toBeTruthy()
    expect(screen.getByText('5 / 321,5 PLN')).toBeTruthy()
    expect(screen.getByText('15 / 4321,99 PLN')).toBeTruthy()
  })

  it('derives the unpaid document count when a legacy reload omits unpaidCount', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      invoices,
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      grossAmountTotal: 500,
      unpaidAmountTotal: 500,
      paymentAging: {
        OVERDUE: { count: 2, grossAmount: 200 },
        DUE_0_7: { count: 1, grossAmount: 100 },
        DUE_8_14: { count: 0, grossAmount: 0 },
        DUE_15_30: { count: 1, grossAmount: 100 },
        LATER: { count: 2, grossAmount: 75 },
        MISSING_DUE_DATE: { count: 1, grossAmount: 25 },
      },
      counts: { NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
    })))

    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={123}
        initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
      />
    )

    await user.click(screen.getByRole('button', { name: /Kwota/i }))

    expect(await screen.findByText('7 / 500 PLN')).toBeTruthy()
  })

  it('shows nominal currencies and uncertainty and preserves that metadata after a reload', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      invoices,
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      grossAmountTotal: 120,
      grossAmountSummary: {
        plnAmount: 120,
        unconvertedCount: 1,
        unconvertedByCurrency: [{ currency: 'GBP', amount: 30, count: 1 }],
      },
      unpaidAmountTotal: 120,
      unpaidAmountSummary: {
        plnAmount: 120,
        unconvertedCount: 1,
        unconvertedByCurrency: [{ currency: 'GBP', amount: 30, count: 1 }],
      },
      unpaidCount: 2,
      uncertainPaymentCount: 1,
      paymentAging: {
        OVERDUE: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
        DUE_0_7: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
        DUE_8_14: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
        DUE_15_30: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
        LATER: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
        MISSING_DUE_DATE: { count: 2, grossAmount: 120, plnAmount: 120, unconvertedCount: 1, unconvertedByCurrency: [{ currency: 'GBP', amount: 30, count: 1 }] },
      },
      counts: { NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
    })))

    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={218}
        initialGrossAmountSummary={{ plnAmount: 218, unconvertedCount: 1, unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }] }}
        initialUnpaidAmountTotal={218}
        initialUnpaidAmountSummary={{ plnAmount: 218, unconvertedCount: 1, unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }] }}
        initialUnpaidCount={4}
        initialUncertainPaymentCount={2}
        initialPaymentAging={{
          OVERDUE: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
          DUE_0_7: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
          DUE_8_14: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
          DUE_15_30: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
          LATER: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
          MISSING_DUE_DATE: { count: 4, grossAmount: 218, plnAmount: 218, unconvertedCount: 1, unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }] },
        }}
        initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
      />
    )

    expect(screen.getAllByText('Bez przeliczenia: 1 dokument').length).toBeGreaterThan(0)
    expect(screen.getAllByText('20 EUR · 1 dokument').length).toBeGreaterThan(0)
    expect(screen.getByText('2 dokumenty z niepewnym statusem płatności — pokazujemy pełne kwoty dokumentów, nie wyliczone saldo.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Kwota/i }))

    expect(await screen.findAllByText('30 GBP · 1 dokument')).not.toHaveLength(0)
    expect(screen.queryByText('20 EUR · 1 dokument')).toBeNull()
    expect(screen.getByText('1 dokument z niepewnym statusem płatności — pokazujemy pełne kwoty dokumentów, nie wyliczone saldo.')).toBeTruthy()
  })

  it('shows a readable empty state when no cost tags exist', () => {
    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={123}
        initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
        costTagGroups={[]}
      />
    )

    expect(screen.getAllByText('Brak tagów kosztowych').length).toBeGreaterThan(0)
  })

  it('opens invoice parts editor from an invoice row', async () => {
    const user = userEvent.setup()
    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={123}
        initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
        costTagGroups={costTagGroups}
      />
    )

    await user.click(screen.getByTitle('Rozbij fakturę'))

    expect(screen.getByText('Części faktury')).toBeTruthy()
    expect(screen.getByText('Suma części')).toBeTruthy()
  })

  it('updates the invoice row with due date returned by the XML content endpoint', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      invoiceId: 'invoice-1',
      ksefNumber: 'ksef-1',
      invoice: {
        id: 'invoice-1',
        dueDate: '2026-07-21T00:00:00.000Z',
        bankAccount: '12345678901234567890123456',
      },
      xml: `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Fa>
    <P_2>FV/1/2026</P_2>
    <Platnosc>
      <TerminPlatnosci>
        <Termin>2026-07-21</Termin>
      </TerminPlatnosci>
    </Platnosc>
  </Fa>
</Faktura>`,
    })))

    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={123}
        initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
        costTagGroups={costTagGroups}
      />
    )

    expect(screen.getByText('Termin: brak')).toBeTruthy()

    await user.click(screen.getByTitle('Podgląd faktury'))

    expect(await screen.findByText('Termin: 2026-07-21')).toBeTruthy()
    expect(screen.getByText('Konto: 1234 5678 9012 3456 7890 1234 56')).toBeTruthy()
  })

  it('shows linked and conflict counts alongside import and XML counts after KSeF sync', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/finance/ksef/sync')) {
        expect(init?.method).toBe('POST')
        return new Response(JSON.stringify({
          ok: true,
          environment: 'TEST',
          fetched: 565,
          imported: 3,
          updated: 556,
          linked: 6,
          conflicts: 2,
          mappedByRules: 0,
          xmlDetailsFetched: 14,
          xmlDetailsFailed: 551,
          ranges: 1,
          truncated: false,
        }))
      }

      return new Response(JSON.stringify({
        invoices,
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        grossAmountTotal: 123,
        unpaidAmountTotal: 123,
        paymentAging: {
          OVERDUE: { count: 0, grossAmount: 0 },
          DUE_0_7: { count: 0, grossAmount: 0 },
          DUE_8_14: { count: 0, grossAmount: 0 },
          DUE_15_30: { count: 0, grossAmount: 0 },
          LATER: { count: 0, grossAmount: 0 },
          MISSING_DUE_DATE: { count: 1, grossAmount: 123 },
        },
        counts: { NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
      }))
    })

    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={123}
        initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
        costTagGroups={costTagGroups}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Synchronizuj z KSeF' }))

    expect(await screen.findByText('KSeF: pobrano 565, dodano 3, zaktualizowano 556, powiązano z importem 6, wymaga rozstrzygnięcia 2, zmapowano regułami 0. XML faktur: pobrano 14, błędy 551.')).toBeTruthy()
  })

  it('uses tags instead of legacy subcategory for inline classification', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/api/finance/ksef/invoices/invoice-1')) {
        return new Response(JSON.stringify({
          invoice: {
            ...invoices[0],
            status: 'MAPPED',
            parts: [
              {
                id: 'part-1',
                label: 'FV/1/2026',
                grossAmount: 123,
                tags: [{ tagId: 'tag-goods', tag: costTagGroups[0].tags[0] }],
                allocations: [{ costCenterId: 'GLOBAL', percent: 100 }],
              },
            ],
          },
        }))
      }

      return new Response(JSON.stringify({
        invoices,
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        grossAmountTotal: 123,
        counts: { NEW: 0, MAPPED: 1, APPROVED: 0, IGNORED: 0 },
      }))
    })

    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={123}
        initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
        costTagGroups={costTagGroups}
      />
    )

    expect(screen.queryByText('Podkategoria')).toBeNull()
    expect(screen.getByText('Tagi')).toBeTruthy()

    // Inline tagging is now grouped toggle chips instead of a native <select multiple>.
    const table = screen.getByRole('table')
    await user.click(within(table).getByRole('button', { name: 'Edytuj tagi' }))
    await user.click(within(table).getByRole('button', { name: 'goods' }))
    await user.click(screen.getByTitle('Zapisz klasyfikację'))

    const patchCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/finance/ksef/invoices/invoice-1'))
    expect(patchCall).toBeTruthy()
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      costCenterId: 'GLOBAL',
      tagIds: ['tag-goods'],
    })
  })

  it('creates a custom tag from the invoice row and selects it for that invoice', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/finance/cost-tags')) {
        expect(init?.method).toBe('POST')
        return new Response(JSON.stringify({
          tag: { id: 'tag-legal', name: 'Usługi prawne', slug: 'uslugi-prawne' },
        }), { status: 201 })
      }

      return new Response(JSON.stringify({
        invoices,
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        grossAmountTotal: 123,
        counts: { NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 },
      }))
    })

    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={123}
        initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
        costTagGroups={costTagGroups}
      />
    )

    const table = screen.getByRole('table')
    await user.click(within(table).getByRole('button', { name: 'Edytuj tagi' }))
    await user.click(within(table).getByRole('button', { name: 'Dodaj tag do Typ wydatku' }))
    const form = within(table).getByRole('form', { name: 'Dodaj tag do Typ wydatku' })
    await user.type(within(form).getByLabelText('Nowy tag w Typ wydatku'), 'Usługi prawne')
    await user.click(within(form).getByRole('button', { name: 'Zapisz nowy tag' }))

    const newTag = await within(table).findByRole('button', { name: 'Usługi prawne' })
    expect(newTag.getAttribute('aria-pressed')).toBe('true')
    const createCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/finance/cost-tags'))
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      groupSlug: 'role',
      name: 'Usługi prawne',
    })
  })

  it('uses chips instead of a select for inline cost center classification', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/api/finance/ksef/invoices/invoice-1')) {
        return new Response(JSON.stringify({
          invoice: {
            ...invoices[0],
            status: 'MAPPED',
            costCenterId: 'PUL',
            costCenter: costCenters[1],
            parts: [
              {
                id: 'part-1',
                label: 'FV/1/2026',
                grossAmount: 123,
                tags: [{ tagId: 'tag-goods', tag: costTagGroups[0].tags[0] }],
                allocations: [{ costCenterId: 'PUL', percent: 100 }],
              },
            ],
          },
        }))
      }

      return new Response(JSON.stringify({
        invoices,
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        grossAmountTotal: 123,
        counts: { NEW: 0, MAPPED: 1, APPROVED: 0, IGNORED: 0 },
      }))
    })

    render(
      <KsefInboxView
        initialInvoices={invoices}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={123}
        initialCounts={{ NEW: 1, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
        costTagGroups={costTagGroups}
      />
    )

    const table = screen.getByRole('table')
    expect(within(table).queryByRole('combobox')).toBeNull()

    await user.click(within(table).getByRole('button', { name: 'Puławska' }))
    await user.click(within(table).getByRole('button', { name: 'Edytuj tagi' }))
    await user.click(within(table).getByRole('button', { name: 'goods' }))
    await user.click(screen.getByTitle('Zapisz klasyfikację'))

    const patchCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/finance/ksef/invoices/invoice-1'))
    expect(patchCall).toBeTruthy()
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      costCenterId: 'PUL',
      tagIds: ['tag-goods'],
    })
  })

  it('allows an approved invoice to be removed from costs', async () => {
    const user = userEvent.setup()
    const approvedInvoice = {
      ...invoices[0],
      status: 'APPROVED' as const,
      parts: [
        {
          tags: [{ tagId: 'tag-goods', tag: costTagGroups[0].tags[0] }],
          allocations: [{ costCenterId: 'GLOBAL', percent: 100 }],
        },
      ],
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/finance/ksef/invoices/invoice-1/approve')) {
        expect(init?.method).toBe('DELETE')
        return new Response(JSON.stringify({
          invoice: {
            ...approvedInvoice,
            status: 'MAPPED',
          },
          voidedCostEvents: 1,
        }))
      }

      return new Response(JSON.stringify({
        invoices: [{ ...approvedInvoice, status: 'MAPPED' }],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        grossAmountTotal: 123,
        unpaidAmountTotal: 123,
        paymentAging: {
          OVERDUE: { count: 0, grossAmount: 0 },
          DUE_0_7: { count: 0, grossAmount: 0 },
          DUE_8_14: { count: 0, grossAmount: 0 },
          DUE_15_30: { count: 0, grossAmount: 0 },
          LATER: { count: 0, grossAmount: 0 },
          MISSING_DUE_DATE: { count: 1, grossAmount: 123 },
        },
        counts: { NEW: 0, MAPPED: 1, APPROVED: 0, IGNORED: 0 },
      }))
    })

    render(
      <KsefInboxView
        initialInvoices={[approvedInvoice]}
        initialTotal={1}
        initialPage={1}
        initialPageSize={50}
        initialTotalPages={1}
        initialGrossAmountTotal={123}
        initialCounts={{ NEW: 0, MAPPED: 0, APPROVED: 1, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
        costTagGroups={costTagGroups}
      />
    )

    await user.click(screen.getByTitle('Cofnij z kosztów'))

    expect(fetchMock).toHaveBeenCalledWith('/api/finance/ksef/invoices/invoice-1/approve', {
      method: 'DELETE',
    })
    expect(await screen.findByText('Faktura cofnięta z kosztów. Możesz poprawić klasyfikację i zatwierdzić ją ponownie.')).toBeTruthy()
    expect(screen.getAllByText('Zmapowana').length).toBeGreaterThan(0)
  })
})
