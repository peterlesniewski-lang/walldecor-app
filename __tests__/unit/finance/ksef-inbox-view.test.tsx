import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KsefInboxView } from '@/components/shared/ksef-inbox-view'

const costCenters = [
  { id: 'GLOBAL', name: 'Koszty centralne' },
]

const subCategories = [
  { id: 'sub-goods', name: 'Zakup towarów handlowych', category: { name: 'Cost of Goods/COGS' } },
]

const costTagGroups = [
  {
    id: 'group-role',
    name: 'Rola',
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

    expect(fetchMock).toHaveBeenCalledWith('/api/finance/ksef/invoices?page=1&pageSize=50&search=wall&amountMin=100&amountMax=500')
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
          LATER: { count: 0, grossAmount: 0 },
          MISSING_DUE_DATE: { count: 0, grossAmount: 0 },
        }}
        initialCounts={{ NEW: 120, MAPPED: 0, APPROVED: 0, IGNORED: 0 }}
        initialRules={[]}
        costCenters={costCenters}
        subCategories={subCategories}
      />
    )

    expect(screen.getByText('Pozostało do zapłaty')).toBeTruthy()
    expect(screen.getAllByText('Po terminie').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0-7 dni').length).toBeGreaterThan(0)
    expect(screen.getByText('4321,99 PLN')).toBeTruthy()
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

  it('uses tags instead of legacy subcategory for inline classification', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
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

    await user.selectOptions(screen.getByLabelText('Tagi FV/1/2026'), ['tag-goods'])
    await user.click(screen.getByTitle('Zapisz klasyfikację'))

    const patchCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/finance/ksef/invoices/invoice-1'))
    expect(patchCall).toBeTruthy()
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      costCenterId: 'GLOBAL',
      tagIds: ['tag-goods'],
    })
  })
})
