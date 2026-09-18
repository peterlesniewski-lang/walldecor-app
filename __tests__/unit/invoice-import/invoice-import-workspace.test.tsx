import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvoiceImportWorkspace } from '@/components/invoice-import/invoice-import-workspace'
import type { InvoiceReviewEditorProps } from '@/components/invoice-import/invoice-review-editor'
import type { InvoiceDraftData } from '@/lib/invoice-import/contracts'
import type { InvoiceDraftDetail, InvoiceDraftKsefReconciliation } from '@/lib/invoice-import/client-contracts'

vi.mock('@/components/invoice-import/invoice-original-preview', () => ({
  InvoiceOriginalPreview: ({ draftId }: { draftId: string }) => <div data-testid="original">Oryginał {draftId}</div>,
}))

vi.mock('@/components/invoice-import/invoice-review-editor', () => ({
  InvoiceReviewEditor: (props: InvoiceReviewEditorProps) => (
    <div data-testid="editor" data-version={props.draft.version}>
      <span>Dane {props.draft.id}</span>
      <button onClick={() => props.onDirtyChange?.(true)}>Oznacz zmiany</button>
      <button onClick={() => { void props.onSave({ supplierName: 'Po korekcie' }, props.draft.version).catch(() => {}) }}>Test zapisz</button>
      <button disabled={Boolean(props.approvalBlockReason)} onClick={() => { void props.onApprove({ supplierName: 'Po korekcie' }, props.draft.version).catch(() => {}) }}>Test zatwierdź</button>
      <button onClick={() => { void props.onRevoke(props.draft.version).catch(() => {}) }}>Test cofnij</button>
      <button onClick={() => { void props.onAction('SKIP', props.draft.version).catch(() => {}) }}>Test pomiń</button>
      <output>{props.busy ? 'busy' : 'idle'}</output>
      {props.approvalBlockReason && <p>{props.approvalBlockReason}</p>}
    </div>
  ),
}))

const NOW = '2026-09-11T08:00:00.000Z'

function detail(id: string, version = 3, data: InvoiceDraftData = {}, state: InvoiceDraftDetail['state'] = 'OPEN'): InvoiceDraftDetail {
  return {
    id,
    batchId: 'batch-1',
    version,
    extractionRevision: 1,
    state,
    skippedAt: null,
    invoiceId: state === 'APPROVED' ? `invoice-${id}` : null,
    ksef: { linkedCount: 0, conflictCount: 0 },
    display: {
      fileName: `${id}.pdf`,
      supplierName: data.supplierName ?? null,
      invoiceNumber: data.invoiceNumber ?? null,
      gross: data.gross ?? null,
      currency: data.currency ?? null,
    },
    latestJob: null,
    createdAt: NOW,
    updatedAt: NOW,
    data,
    manualFields: [],
    attachment: {
      id: `attachment-${id}`,
      sha256: 'a'.repeat(64),
      originalName: `${id}.pdf`,
      mimeType: 'application/pdf',
      byteSize: 1234,
      pageCount: 1,
      state: 'READY',
      createdAt: NOW,
      updatedAt: NOW,
    },
  }
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}

function routeOf(input: RequestInfo | URL) {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
}

function summaryOf(item: InvoiceDraftDetail) {
  return {
    id: item.id,
    batchId: item.batchId,
    version: item.version,
    extractionRevision: item.extractionRevision,
    state: item.state,
    skippedAt: item.skippedAt,
    invoiceId: item.invoiceId,
    ksef: item.ksef,
    display: item.display,
    latestJob: item.latestJob,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function ksefDetail(item: InvoiceDraftDetail): InvoiceDraftKsefReconciliation {
  return { draftId: item.id, draftVersion: item.version, draftState: item.state, links: [{
    id: `link-${item.id}`, externalId: `KSEF-${item.id}`, version: 1, status: 'CONFLICT', approvalBlocked: true,
    differences: [{ field: 'gross', localValue: item.data.gross ?? null, ksefValue: 124 }],
    snapshot: { externalId: `KSEF-${item.id}`, documentStatus: 'ACTIVE', data: {
      documentType: 'INVOICE', supplierName: 'Dostawca', taxId: 'PL1234567890', invoiceNumber: 'FV/1',
      issueDate: '2026-09-10', currency: 'PLN', gross: 124, net: null, vat: null,
      paymentStatus: 'UNKNOWN', paidAt: null, dueDate: null, bankAccount: null,
    } }, createdAt: NOW, updatedAt: NOW,
  }] }
}

function linkedDraft(id = 'a', state: InvoiceDraftDetail['state'] = 'OPEN') {
  return { ...detail(id, 3, { gross: 123, currency: 'PLN' }, state), ksef: { linkedCount: 1, conflictCount: 1 } }
}

function setupApi(initial: InvoiceDraftDetail[]) {
  const drafts = new Map(initial.map((item) => [item.id, item]))
  const reconciliations = new Map(initial.filter((item) => item.ksef.linkedCount).map((item) => [item.id, ksefDetail(item)]))
  const ksefReceipts = new Map<string, unknown>()
  const calls: Array<{ url: URL; init?: RequestInit; body?: unknown }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = routeOf(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
    calls.push({ url, init, body })
    if (url.pathname.endsWith('/batches') && method === 'POST') return json({ batch: { id: 'batch-new' } })
    if (url.pathname.endsWith('/drafts') && method === 'GET') {
      const state = url.searchParams.get('state')
      return json({ drafts: [...drafts.values()].filter((item) => !state || item.state === state).map(summaryOf) })
    }
    if (url.pathname.endsWith('/drafts') && method === 'POST') {
      const uploaded = detail('uploaded', 1)
      drafts.set(uploaded.id, uploaded)
      return json({ draft: uploaded, deduplicated: false })
    }
    const match = url.pathname.match(/\/drafts\/([^/]+)(?:\/(approve|actions|history|ksef))?$/)
    if (!match) throw new Error(`Nieobsłużone żądanie ${method} ${url.pathname}`)
    const id = decodeURIComponent(match[1])
    const suffix = match[2]
    const current = drafts.get(id)
    if (!current) return json({ error: 'Nie znaleziono.' }, 404)
    if (suffix === 'ksef') {
      const record = reconciliations.get(id)!
      if (method === 'GET') return json({ reconciliation: { ...record, draftVersion: current.version, draftState: current.state } })
      const input = body as { action: 'KEEP_LOCAL' | 'APPLY_TO_DRAFT'; idempotencyKey: string; expectedDraftVersion: number; expectedLinkVersion: number }
      if (ksefReceipts.has(input.idempotencyKey)) return json({ result: ksefReceipts.get(input.idempotencyKey) })
      const outcome = input.action === 'KEEP_LOCAL' ? 'KEPT_LOCAL' : 'APPLIED_TO_DRAFT'
      const updated = { ...current, version: current.version + 1, ksef: { linkedCount: 1, conflictCount: 0 },
        data: input.action === 'KEEP_LOCAL' ? current.data : { ...current.data, ...record.links[0].snapshot.data } }
      drafts.set(id, updated)
      reconciliations.set(id, { ...record, draftVersion: updated.version, links: [{ ...record.links[0],
        version: record.links[0].version + 1, status: outcome, approvalBlocked: false,
        differences: input.action === 'KEEP_LOCAL' ? record.links[0].differences : [],
      }] })
      const result = { draftId: id, version: updated.version, reconciliationId: record.links[0].id,
        reconciliationVersion: record.links[0].version + 1, outcome }
      ksefReceipts.set(input.idempotencyKey, result)
      return json({ result })
    }
    if (!suffix && method === 'GET') return json({ draft: current })
    if (!suffix && method === 'PATCH') {
      const next = detail(id, current.version + 1, { ...current.data, ...(body as { data: InvoiceDraftData }).data }, current.state)
      drafts.set(id, next)
      return json({ draft: next })
    }
    if (suffix === 'approve') {
      const next = detail(id, current.version + 1, current.data, method === 'DELETE' ? 'OPEN' : 'APPROVED')
      drafts.set(id, next)
      return json({ result: {
        outcome: method === 'DELETE' ? 'REVOKED' : 'APPROVED',
        draftId: id,
        version: next.version,
        invoiceId: `invoice-${id}`,
        costEventId: `cost-${id}`,
      } })
    }
    if (suffix === 'actions') {
      const action = (body as { action: string }).action
      const next = { ...current, version: current.version + 1, skippedAt: action === 'SKIP' ? NOW : current.skippedAt }
      drafts.set(id, next)
      return json({ draft: next })
    }
    if (suffix === 'history') return json({ entries: [], nextCursor: null })
    throw new Error(`Nieobsłużone żądanie ${method} ${url.pathname}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { drafts, reconciliations, calls, fetchMock }
}

function workspace(overrides: Partial<React.ComponentProps<typeof InvoiceImportWorkspace>> = {}) {
  const props: React.ComponentProps<typeof InvoiceImportWorkspace> = {
    costCenters: [{ id: 'PUL', name: 'Puławska' }],
    tagGroups: [],
    rules: [],
    onClose: vi.fn(),
    onInvoicesChanged: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  return { props, view: render(<InvoiceImportWorkspace {...props} />) }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('InvoiceImportWorkspace', () => {
  it('loads KSeF differences, blocks approval, and saves an explicit KEEP with both versions before refreshing', async () => {
    const user = userEvent.setup()
    const api = setupApi([linkedDraft()])
    workspace({ initialDraftId: 'a' })
    await screen.findByRole('button', { name: 'Zachowaj moje dane' })
    expect((screen.getByRole('button', { name: 'Test zatwierdź' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.calls.some((call) => call.init?.method === 'POST')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Zachowaj moje dane' }))
    await screen.findByText('Zachowano dane administratora')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Test zatwierdź' }) as HTMLButtonElement).disabled).toBe(false))
    const decisions = api.calls.filter((call) => call.url.pathname.endsWith('/ksef') && call.init?.method === 'POST')
    expect(decisions).toHaveLength(1)
    expect(decisions[0].body).toEqual({ reconciliationId: 'link-a', expectedDraftVersion: 3, expectedLinkVersion: 1,
      action: 'KEEP_LOCAL', idempotencyKey: expect.any(String) })
    expect(api.drafts.get('a')?.data.gross).toBe(123)
    expect(api.calls.some((call) => call.url.pathname.endsWith('/approve'))).toBe(false)
  })

  it('retains the exact KSeF decision request when its successful response is lost', async () => {
    const user = userEvent.setup()
    const api = setupApi([linkedDraft()])
    const base = api.fetchMock.getMockImplementation()!
    let dropped = false
    api.fetchMock.mockImplementation(async (input, init) => {
      const response = await base(input, init)
      if (routeOf(input).pathname.endsWith('/ksef') && init?.method === 'POST' && !dropped) {
        dropped = true
        throw new TypeError('Lost committed response')
      }
      return response
    })
    workspace({ initialDraftId: 'a' })
    await user.click(await screen.findByRole('button', { name: 'Przyjmij dane KSeF do szkicu' }))
    await screen.findByText('Dane KSeF przyjęte do szkicu')
    const decisions = api.calls.filter((call) => call.url.pathname.endsWith('/ksef') && call.init?.method === 'POST')
    expect(decisions).toHaveLength(2)
    expect(decisions[1].body).toEqual(decisions[0].body)
    expect(api.drafts.get('a')).toMatchObject({ version: 4, data: { gross: 124 } })
    expect(api.calls.some((call) => call.url.pathname.endsWith('/approve'))).toBe(false)
  })

  it('does not resolve KSeF while the editor has unsaved changes', async () => {
    const user = userEvent.setup()
    const api = setupApi([linkedDraft()])
    workspace({ initialDraftId: 'a' })
    await screen.findByRole('button', { name: 'Zachowaj moje dane' })
    await user.click(screen.getByRole('button', { name: 'Oznacz zmiany' }))
    expect((screen.getByRole('button', { name: 'Zachowaj moje dane' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Przyjmij dane KSeF do szkicu' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.calls.some((call) => call.init?.method === 'POST')).toBe(false)
  })

  it('refreshes both lists after both committed KSeF decision responses are lost', async () => {
    const user = userEvent.setup()
    const api = setupApi([linkedDraft()])
    const base = api.fetchMock.getMockImplementation()!
    api.fetchMock.mockImplementation(async (input, init) => {
      const response = await base(input, init)
      if (routeOf(input).pathname.endsWith('/ksef') && init?.method === 'POST') throw new TypeError('Lost reply')
      return response
    })
    const { props } = workspace({ initialDraftId: 'a' })
    await user.click(await screen.findByRole('button', { name: 'Zachowaj moje dane' }))
    await screen.findByText(/Wczytano bieżący stan dokumentu/)
    await waitFor(() => expect(screen.getByText('idle')).toBeTruthy())
    expect(props.onInvoicesChanged).toHaveBeenCalledTimes(1)
    const decisions = api.calls.filter((call) => call.url.pathname.endsWith('/ksef') && call.init?.method === 'POST')
    expect(decisions).toHaveLength(2)
    expect(decisions[1].body).toEqual(decisions[0].body)
    expect(api.calls.slice(api.calls.indexOf(decisions[1]) + 1).some((call) => call.url.pathname.endsWith('/drafts'))).toBe(true)
    expect(api.drafts.get('a')).toMatchObject({ version: 4, data: { gross: 123 } })
    expect(api.calls.some((call) => call.url.pathname.endsWith('/approve'))).toBe(false)
  })

  it('does not claim a KSeF decision succeeded when both replies and subsequent reads fail', async () => {
    const user = userEvent.setup()
    const api = setupApi([linkedDraft()])
    const base = api.fetchMock.getMockImplementation()!
    let uncertain = false
    api.fetchMock.mockImplementation(async (input, init) => {
      if (routeOf(input).pathname.endsWith('/ksef') && init?.method === 'POST') {
        uncertain = true
        await base(input, init)
        return json({ invalid: 'reply' })
      }
      if (uncertain) throw new TypeError('Read unavailable')
      return base(input, init)
    })
    workspace({ initialDraftId: 'a', onInvoicesChanged: vi.fn().mockRejectedValue(new Error('List unavailable')) })
    await user.click(await screen.findByRole('button', { name: 'Zachowaj moje dane' }))
    await screen.findByText(/Nie można potwierdzić wyboru ani odświeżyć dokumentu/)
    await waitFor(() => expect(screen.getByText('idle')).toBeTruthy())
    expect(screen.queryByText('Zachowano dane administratora')).toBeNull()
    expect((screen.getByRole('button', { name: 'Test zatwierdź' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.calls.filter((call) => call.url.pathname.endsWith('/ksef') && call.init?.method === 'POST')).toHaveLength(2)
    expect(api.calls.some((call) => call.url.pathname.endsWith('/approve'))).toBe(false)
  })

  it('shows KSeF conflict and resolved badges alongside the existing finance state in the document list', async () => {
    const user = userEvent.setup()
    setupApi([linkedDraft('a', 'APPROVED')])
    workspace({ initialDraftId: 'a' })
    const sidebar = within(screen.getByRole('complementary', { name: 'Dokumenty importu' }))
    expect(await sidebar.findByText('KSeF · wymaga rozstrzygnięcia')).toBeTruthy()
    expect(sidebar.getByText('Zatwierdzona')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Zachowaj moje dane' }))
    expect(await sidebar.findByText('Powiązana z KSeF')).toBeTruthy()
    expect(sidebar.queryByText('KSeF · wymaga rozstrzygnięcia')).toBeNull()
    expect(sidebar.getByText('Zatwierdzona')).toBeTruthy()
  })

  it('aborts a forced refresh for A and never shows its late error on B', async () => {
    const user = userEvent.setup()
    const api = setupApi([detail('a'), detail('b')])
    const base = api.fetchMock.getMockImplementation()!
    let aReads = 0
    let rejectForced: ((error: Error) => void) | undefined
    let forcedSignal: AbortSignal | null | undefined
    api.fetchMock.mockImplementation((input, init) => {
      const url = routeOf(input)
      if (url.pathname.endsWith('/drafts/a') && init?.method === 'PATCH') {
        return json({ code: 'STALE_VERSION', error: 'Nieaktualna wersja.' }, 409)
      }
      if (url.pathname.endsWith('/drafts/a') && (!init?.method || init.method === 'GET') && ++aReads === 2) {
        forcedSignal = init?.signal
        return new Promise<Response>((_resolve, reject) => { rejectForced = reject })
      }
      return base(input, init)
    })
    workspace({ initialDraftId: 'a' })
    await screen.findByText('Dane a')
    await user.click(screen.getByRole('button', { name: 'Test zapisz' }))
    await waitFor(() => expect(rejectForced).toBeTypeOf('function'))
    await user.click(within(screen.getByRole('complementary', { name: 'Dokumenty importu' })).getByRole('button', { name: /b.pdf/ }))
    await screen.findByText('Dane b')
    await act(async () => { rejectForced?.(new Error('Late A network failure')) })
    expect(screen.queryByText(/Nie udało się potwierdzić odpowiedzi serwera/)).toBeNull()
    expect(forcedSignal?.aborted).toBe(true)
  })

  it('refreshes open history after a saved version and fetches again when reopened', async () => {
    const user = userEvent.setup()
    const api = setupApi([detail('a')])
    const base = api.fetchMock.getMockImplementation()!
    let historyCalls = 0
    api.fetchMock.mockImplementation((input, init) => {
      if (routeOf(input).pathname.endsWith('/history')) {
        historyCalls += 1
        return json({ entries: [{ id: `history-${historyCalls}`, action: historyCalls === 1 ? 'CREATED' : 'EDITED', actorName: null, createdAt: NOW }], nextCursor: null })
      }
      return base(input, init)
    })
    workspace({ initialDraftId: 'a' })
    await screen.findByText('Dane a')
    await user.click(screen.getByRole('button', { name: 'Historia dokumentu' }))
    await screen.findByText('Dodano dokument')
    await user.click(screen.getByRole('button', { name: 'Test zapisz' }))
    expect(await screen.findByText('Zapisano poprawki')).toBeTruthy()
    expect(historyCalls).toBe(2)
    await user.click(screen.getByRole('button', { name: 'Historia dokumentu' }))
    await user.click(screen.getByRole('button', { name: 'Historia dokumentu' }))
    await waitFor(() => expect(historyCalls).toBe(3))
    expect(await screen.findByText('Zapisano poprawki')).toBeTruthy()
  })

  it('loads the capped list, keeps real statuses visible and opens the selected source with its editor', async () => {
    const queued = detail('queued')
    queued.latestJob = { id: 'job-1', kind: 'INVOICE_EXTRACT', status: 'RUNNING', errorCode: null, blockedReason: null, attempts: 1, warnings: [], createdAt: NOW, updatedAt: NOW }
    const api = setupApi([queued, detail('approved', 4, {}, 'APPROVED')])
    workspace({ initialDraftId: 'queued' })

    expect(screen.getByText('Wczytuję dokumenty…')).toBeTruthy()
    expect(await screen.findByText('Oryginał queued')).toBeTruthy()
    expect(screen.getByText('Dane queued')).toBeTruthy()
    expect(screen.getByText('Odczytywanie')).toBeTruthy()
    expect(screen.getByText('Zatwierdzona')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Stan dokumentów' }) as HTMLSelectElement).value).toBe('ALL')
    expect(api.calls.find((call) => call.url.pathname.endsWith('/drafts'))?.url.searchParams.get('limit')).toBe('100')
  })

  it('shows a known amount without inventing PLN when currency is null or empty', async () => {
    const missing = detail('missing-currency')
    missing.display.gross = 100
    missing.display.currency = null
    const empty = detail('empty-currency')
    empty.display.gross = 100
    empty.display.currency = ''
    setupApi([missing, empty])
    workspace()

    expect(await screen.findAllByText('100,00 · waluta nieodczytana')).toHaveLength(2)
    expect(screen.queryByText(/100,00\s*zł/)).toBeNull()
  })

  it('lets a slow foreground list request finish instead of superseding it with polling', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    let listCalls = 0
    const api = setupApi([])
    api.fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = routeOf(input)
      if (url.pathname.endsWith('/drafts')) {
        listCalls += 1
        if (listCalls === 1) return new Promise<Response>((resolve) => { resolveFirst = resolve })
        return new Promise<Response>(() => undefined)
      }
      throw new Error(`Nieobsłużone ${url.pathname}`)
    })
    workspace()
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 2_100)) })
    await act(async () => {
      resolveFirst?.(new Response(JSON.stringify({ drafts: [summaryOf(detail('slow'))] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    })

    expect(await screen.findByRole('button', { name: /slow\.pdf/i })).toBeTruthy()
    expect(listCalls).toBe(1)
  }, 5_000)

  it('shows a filter request error instead of silently presenting rows from another filter', async () => {
    const user = userEvent.setup()
    const api = setupApi([detail('all-only')])
    const original = api.fetchMock.getMockImplementation()!
    api.fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = routeOf(input)
      if (url.pathname.endsWith('/drafts') && url.searchParams.get('state') === 'OPEN') {
        return json({ code: 'HTTP_ERROR', error: 'Filtr jest chwilowo niedostępny.' }, 503)
      }
      return original(input, init)
    })
    workspace()
    await screen.findByRole('button', { name: /all-only\.pdf/i })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Stan dokumentów' }), 'OPEN')

    expect((await screen.findByRole('alert')).textContent).toContain('Filtr jest chwilowo niedostępny.')
    expect(screen.getByRole('button', { name: /all-only\.pdf/i })).toBeTruthy()
  })

  it('creates one batch per file selection, uploads sequentially and retries a failed file in the same batch', async () => {
    const user = userEvent.setup()
    const api = setupApi([])
    let uploadAttempt = 0
    api.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = routeOf(input)
      if (url.pathname.endsWith('/batches')) return json({ batch: { id: 'batch-retry' } })
      if (url.pathname.endsWith('/drafts') && init?.method === 'POST') {
        uploadAttempt += 1
        if (uploadAttempt === 1) throw new TypeError('lost')
        return json({ draft: detail('retried', 1), deduplicated: true })
      }
      if (url.pathname.endsWith('/drafts')) return json({ drafts: [] })
      if (url.pathname.endsWith('/drafts/retried')) return json({ draft: detail('retried', 1) })
      throw new Error(`Nieobsłużone ${url.pathname}`)
    })
    workspace()
    await screen.findByText('Brak dokumentów w tym widoku.')

    const file = new File(['pdf'], 'utracona.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Dodaj faktury'), file)
    expect(await screen.findByText('Błąd')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Ponów utracona.pdf' }))
    expect(await screen.findByText('Duplikat — już zapisany')).toBeTruthy()

    const batchCalls = api.fetchMock.mock.calls.filter(([input]) => routeOf(input).pathname.endsWith('/batches'))
    expect(batchCalls).toHaveLength(1)
    const uploadCalls = api.fetchMock.mock.calls.filter(([input, init]) => routeOf(input).pathname.endsWith('/drafts') && init?.method === 'POST')
    expect(uploadCalls).toHaveLength(2)
    expect((uploadCalls[0][1]?.body as FormData).get('batchId')).toBe('batch-retry')
    expect((uploadCalls[1][1]?.body as FormData).get('batchId')).toBe('batch-retry')
  })

  it('waits for each upload response before sending the next file', async () => {
    const user = userEvent.setup()
    const api = setupApi([])
    const original = api.fetchMock.getMockImplementation()!
    let uploadCalls = 0
    let resolveFirst: ((response: Response) => void) | undefined
    api.fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = routeOf(input)
      if (url.pathname.endsWith('/drafts') && init?.method === 'POST') {
        uploadCalls += 1
        if (uploadCalls === 1) return new Promise<Response>((resolve) => { resolveFirst = resolve })
      }
      return original(input, init)
    })
    workspace()
    await screen.findByText('Brak dokumentów w tym widoku.')

    await user.upload(screen.getByLabelText('Dodaj faktury'), [
      new File(['one'], 'pierwsza.pdf', { type: 'application/pdf' }),
      new File(['two'], 'druga.pdf', { type: 'application/pdf' }),
    ])
    await waitFor(() => expect(uploadCalls).toBe(1))
    expect(screen.getByText('pierwsza.pdf')).toBeTruthy()
    expect(screen.getByText('druga.pdf')).toBeTruthy()

    await act(async () => {
      resolveFirst?.(new Response(JSON.stringify({ draft: detail('first-upload', 1), deduplicated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    })
    await waitFor(() => expect(uploadCalls).toBe(2))
    await waitFor(() => expect(screen.getAllByText('Zapisany')).toHaveLength(2))
  })

  it('rejects selections above 20 files and oversized files before creating a batch', async () => {
    const user = userEvent.setup()
    const api = setupApi([])
    workspace()
    await screen.findByText('Brak dokumentów w tym widoku.')
    const input = screen.getByLabelText('Dodaj faktury')

    await user.upload(input, Array.from({ length: 21 }, (_, index) => new File(['x'], `${index}.pdf`, { type: 'application/pdf' })))
    expect(await screen.findByText('Wybierz maksymalnie 20 plików w jednym dodaniu.')).toBeTruthy()

    await user.upload(input, new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'za-duza.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText('Plik przekracza limit 10 MiB.')).toBeTruthy()
    expect(api.fetchMock.mock.calls.filter(([request]) => routeOf(request).pathname.endsWith('/batches'))).toHaveLength(0)
  })

  it('saves a patch before approval, approves the returned version once and advances to the next open draft', async () => {
    const api = setupApi([detail('first', 3), detail('next', 7)])
    const onInvoicesChanged = vi.fn().mockResolvedValue(undefined)
    workspace({ initialDraftId: 'first', onInvoicesChanged })
    await screen.findByText('Dane first')

    const approve = screen.getByRole('button', { name: 'Test zatwierdź' })
    fireEvent.click(approve)
    fireEvent.click(approve)

    await waitFor(() => expect(onInvoicesChanged).toHaveBeenCalledTimes(1))
    const patch = api.calls.find((call) => call.init?.method === 'PATCH')
    const approval = api.calls.find((call) => call.url.pathname.endsWith('/approve'))
    expect(patch?.body).toEqual({ expectedVersion: 3, data: { supplierName: 'Po korekcie' } })
    expect(approval?.body).toMatchObject({ expectedVersion: 4, confirmedPeriodIds: [] })
    expect((approval?.body as { idempotencyKey: string }).idempotencyKey).toEqual(expect.any(String))
    expect(api.calls.filter((call) => call.url.pathname.endsWith('/approve'))).toHaveLength(1)
    expect(await screen.findByText('Dane next')).toBeTruthy()
  })

  it('requires an explicit discard before switching a dirty editor or leaving the workspace', async () => {
    const user = userEvent.setup()
    const api = setupApi([detail('first'), detail('second')])
    const onClose = vi.fn()
    workspace({ initialDraftId: 'first', onClose })
    await screen.findByText('Dane first')
    await user.click(screen.getByRole('button', { name: 'Oznacz zmiany' }))
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)

    await user.click(screen.getByRole('button', { name: /second\.pdf/i }))
    expect(screen.getByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Zostań przy dokumencie' }))
    expect(screen.getByText('Dane first')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Wróć do faktur' }))
    await user.click(screen.getByRole('button', { name: 'Odrzuć zmiany' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(api.fetchMock).toHaveBeenCalled()
  })

  it('does not let an older poll response overwrite a mutation result', async () => {
    let resolvePoll: ((value: Response) => void) | undefined
    const base = detail('first', 3)
    const api = setupApi([base])
    const original = api.fetchMock.getMockImplementation()!
    let getCount = 0
    api.fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = routeOf(input)
      if (url.pathname.endsWith('/drafts/first') && (!init?.method || init.method === 'GET')) {
        getCount += 1
        if (getCount === 2) return new Promise<Response>((resolve) => { resolvePoll = resolve })
      }
      return original(input, init)
    })
    workspace({ initialDraftId: 'first' })
    expect(await screen.findByText('Dane first')).toBeTruthy()

    await waitFor(() => expect(resolvePoll).toEqual(expect.any(Function)), { timeout: 2_500 })
    fireEvent.click(screen.getByRole('button', { name: 'Test zapisz' }))
    await waitFor(() => expect(screen.getByTestId('editor').getAttribute('data-version')).toBe('4'))
    await act(async () => { resolvePoll?.(new Response(JSON.stringify({ draft: base }), { status: 200, headers: { 'content-type': 'application/json' } })) })
    expect(screen.getByTestId('editor').getAttribute('data-version')).toBe('4')
  }, 7_000)

  it('lists closed months and only retries approval after confirmation with the same version and key', async () => {
    const user = userEvent.setup()
    const api = setupApi([detail('first', 3)])
    const original = api.fetchMock.getMockImplementation()!
    let approveAttempts = 0
    const approvalBodies: Array<{ expectedVersion: number; idempotencyKey: string; confirmedPeriodIds: string[] }> = []
    api.fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = routeOf(input)
      if (url.pathname.endsWith('/approve')) {
        approveAttempts += 1
        approvalBodies.push(JSON.parse(String(init?.body)))
        if (approveAttempts === 1) return json({
          code: 'CLOSED_PERIOD_CONFIRMATION_REQUIRED',
          error: 'Okres jest zamknięty.',
          periods: [{ id: 'period-2026-09', year: 2026, month: 9, closedAt: NOW }],
        }, 409)
      }
      return original(input, init)
    })
    workspace({ initialDraftId: 'first' })
    await screen.findByText('Dane first')
    await user.click(screen.getByRole('button', { name: 'Test zatwierdź' }))

    const dialog = await screen.findByRole('dialog', { name: 'Ponownie otworzyć zamknięty okres?' })
    expect(within(dialog).getByText('wrzesień 2026')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Potwierdź i otwórz okres' }))
    await waitFor(() => expect(approveAttempts).toBe(2))
    expect(approvalBodies[1]).toMatchObject({
      expectedVersion: 4,
      idempotencyKey: approvalBodies[0].idempotencyKey,
      confirmedPeriodIds: ['period-2026-09'],
    })
  })

  it('never approves after an ambiguous patch response even when version +1 repeats the patch but changes an unseen field', async () => {
    const api = setupApi([detail('first', 3)])
    const original = api.fetchMock.getMockImplementation()!
    let approvalCalls = 0
    let detailReads = 0
    api.fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = routeOf(input)
      if (url.pathname.endsWith('/drafts/first') && init?.method === 'PATCH') throw new TypeError('lost')
      if (url.pathname.endsWith('/drafts/first/approve')) {
        approvalCalls += 1
        return original(input, init)
      }
      if (url.pathname.endsWith('/drafts/first') && (!init?.method || init.method === 'GET')) {
        detailReads += 1
        if (detailReads === 1) return json({ draft: detail('first', 3) })
        return json({ draft: detail('first', 4, { supplierName: 'Po korekcie', bankAccount: 'PL0011223344' }) })
      }
      return original(input, init)
    })
    workspace({ initialDraftId: 'first' })
    await screen.findByText('Dane first')

    fireEvent.click(screen.getByRole('button', { name: 'Test zatwierdź' }))

    await waitFor(() => expect(screen.getByTestId('editor').getAttribute('data-version')).toBe('4'))
    expect(approvalCalls).toBe(0)
    expect(screen.getByText(/sprawdź wszystkie dane i ponownie wybierz/i)).toBeTruthy()
  })

  it.each(['success', 'error'] as const)('loads draft B history while stale draft A history finishes with %s', async (ending) => {
    const user = userEvent.setup()
    const api = setupApi([detail('a'), detail('b')])
    const original = api.fetchMock.getMockImplementation()!
    let resolveA: ((response: Response) => void) | undefined
    let rejectA: ((error: unknown) => void) | undefined
    let bHistoryCalls = 0
    api.fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = routeOf(input)
      if (url.pathname.endsWith('/drafts/a/history')) {
        return new Promise<Response>((resolve, reject) => { resolveA = resolve; rejectA = reject })
      }
      if (url.pathname.endsWith('/drafts/b/history')) {
        bHistoryCalls += 1
        return json({ entries: [{ id: 'history-b', action: 'EDITED', actorName: 'Beata', createdAt: NOW }], nextCursor: null })
      }
      return original(input, init)
    })
    workspace({ initialDraftId: 'a' })
    await screen.findByText('Dane a')
    await user.click(screen.getByRole('button', { name: 'Historia dokumentu' }))
    await waitFor(() => expect(resolveA).toEqual(expect.any(Function)))

    await user.click(screen.getByRole('button', { name: /b\.pdf/i }))
    await screen.findByText('Dane b')
    await user.click(screen.getByRole('button', { name: 'Historia dokumentu' }))

    expect(await screen.findByText('Zapisano poprawki')).toBeTruthy()
    expect(bHistoryCalls).toBe(1)
    await act(async () => {
      if (ending === 'success') {
        resolveA?.(new Response(JSON.stringify({ entries: [{ id: 'history-a', action: 'ARCHIVED', actorName: null, createdAt: NOW }], nextCursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      } else {
        rejectA?.(new TypeError('stale history failed'))
      }
    })
    expect(screen.getByText('Zapisano poprawki')).toBeTruthy()
    expect(screen.queryByText('Przeniesiono do archiwum')).toBeNull()
    expect(screen.queryByText(/nie udało się wczytać historii/i)).toBeNull()
  })

  it('cancels closed-period confirmation without approving or refreshing invoice totals', async () => {
    const user = userEvent.setup()
    const api = setupApi([detail('first', 3)])
    const original = api.fetchMock.getMockImplementation()!
    const onInvoicesChanged = vi.fn().mockResolvedValue(undefined)
    let approvals = 0
    api.fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = routeOf(input)
      if (url.pathname.endsWith('/approve')) {
        approvals += 1
        return json({
          code: 'CLOSED_PERIOD_CONFIRMATION_REQUIRED',
          error: 'Okres jest zamknięty.',
          periods: [{ id: 'period-2026-09', year: 2026, month: 9, closedAt: NOW }],
        }, 409)
      }
      return original(input, init)
    })
    workspace({ initialDraftId: 'first', onInvoicesChanged })
    await screen.findByText('Dane first')
    await user.click(screen.getByRole('button', { name: 'Test zatwierdź' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ponownie otworzyć zamknięty okres?' })

    await user.click(within(dialog).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ponownie otworzyć zamknięty okres?' })).toBeNull())
    await waitFor(() => expect(screen.getByText('idle')).toBeTruthy())
    expect(approvals).toBe(1)
    expect(onInvoicesChanged).not.toHaveBeenCalled()
  })
})
