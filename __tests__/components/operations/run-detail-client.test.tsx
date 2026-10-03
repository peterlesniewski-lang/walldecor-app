import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunDetailClient } from '@/components/operations/run-detail-client'
import type { RunTask } from '@/components/operations/run-task-list'

const { push, refresh, listSpy } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  listSpy: { latest: null as null | { items: RunTask[]; onReorder: (orderedIds: string[]) => void } },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

vi.mock('@/components/wikipedia/ArticleViewer', () => ({
  ArticleViewer: ({ content }: { content: string }) => <div data-testid="article-viewer">{content}</div>,
}))

// The real list is rendered; the wrapper only records its latest props so tests can read the `order` values the
// client passes down and call `onReorder` the way a finished drag would (jsdom cannot drag with a pointer).
vi.mock('@/components/operations/run-task-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/operations/run-task-list')>()
  return {
    ...actual,
    RunTaskList: (props: ComponentProps<typeof actual.RunTaskList>) => {
      listSpy.latest = props as unknown as NonNullable<typeof listSpy.latest>
      return <actual.RunTaskList {...props} />
    },
  }
})

type InitialRun = ComponentProps<typeof RunDetailClient>['initialRun']
type Item = InitialRun['items'][number]

const SAVE_ERROR = 'Nie udało się zapisać zmiany. Odśwież stronę i spróbuj ponownie.'

function makeItem(overrides: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return {
    description: null,
    order: 1,
    procedureId: null,
    ownerId: null,
    status: 'todo',
    note: null,
    recurring: true,
    ...overrides,
  }
}

function makeItems(): Item[] {
  return [
    makeItem({ id: 'i1', title: 'Wyciąg bankowy', order: 1, procedureId: 'p1', description: 'Pobierz z banku' }),
    makeItem({ id: 'i2', title: 'Faktury kosztowe', order: 2 }),
    makeItem({ id: 'i3', title: 'Raport VAT', order: 3, recurring: false }),
  ]
}

function makeRun(overrides: Partial<InitialRun> = {}): InitialRun {
  return {
    id: 'run-1',
    name: 'Zamknięcie miesiąca - wrzesień 2026',
    status: 'open',
    periodYear: 2026,
    periodMonth: 9,
    canManage: true,
    template: { module: { name: 'Księgowość', area: { name: 'Finanse' } } },
    items: makeItems(),
    procedures: [{ id: 'p1', title: 'Jak pobrać wyciąg', content: 'Krok 1: zaloguj się do banku' }],
    procedureOptions: [
      { id: 'p1', title: 'Jak pobrać wyciąg' },
      { id: 'p2', title: 'Jak wystawić fakturę' },
    ],
    ...overrides,
  }
}

function renderClient(overrides: Partial<InitialRun> = {}) {
  return render(<RunDetailClient initialRun={makeRun(overrides)} />)
}

function jsonResponse(status: number, body: unknown = {}) {
  return () =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function stubFetch(respond: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(respond)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function stubFetchFailure() {
  return stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
}

function requestOf(fetchMock: ReturnType<typeof stubFetch>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index]
  return { url, method: (init as RequestInit).method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }
}

const rowTitles = () =>
  screen
    .queryAllByTestId('run-task-row')
    .map((row) => within(row).getByRole('checkbox').getAttribute('aria-label')?.replace('Oznacz jako gotowe: ', ''))

const checkbox = (title: string) => screen.getByRole('checkbox', { name: `Oznacz jako gotowe: ${title}` }) as HTMLButtonElement
const header = () => within(screen.getByRole('heading', { level: 1 }).parentElement as HTMLElement)
const addButton = () => screen.queryByRole('button', { name: '+ Dodaj zadanie' })
const dragHandles = () => screen.queryAllByRole('button', { name: /^Przeciągnij zadanie: / })
const rowMenus = () => screen.queryAllByRole('button', { name: /^Opcje zadania: / })
const progressText = () => screen.getByText('Postęp').nextElementSibling?.textContent

function itemResponse(item: Item, extra: { procedure?: { id: string; title: string; content: string } | null } = {}) {
  return { ...item, procedure: null, ...extra }
}

async function deleteViaMenu(title: string) {
  await userEvent.click(screen.getByRole('button', { name: `Opcje zadania: ${title}` }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }))
  await userEvent.click(screen.getByRole('button', { name: 'Tak, usuń' }))
}

async function fillAndSubmitNewTask(title: string) {
  await userEvent.click(screen.getByRole('button', { name: '+ Dodaj zadanie' }))
  await userEvent.type(screen.getByLabelText('Tytuł zadania'), title)
  await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))
}

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
  listSpy.latest = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RunDetailClient', () => {
  describe('header', () => {
    it('should show the run name', () => {
      renderClient()

      expect(screen.queryByRole('heading', { level: 1, name: 'Zamknięcie miesiąca - wrzesień 2026' })).not.toBeNull()
    })

    it('should show the "W toku" status of an open run with unfinished tasks', () => {
      renderClient()

      expect(header().queryByText('W toku')).not.toBeNull()
    })

    it('should show "Gotowe do zamknięcia" when every task is done', () => {
      renderClient({ items: makeItems().map((item) => ({ ...item, status: 'done' })) })

      expect(header().queryByText('Gotowe do zamknięcia')).not.toBeNull()
    })

    it('should show the "Zamknięte" status of a closed run', () => {
      renderClient({ status: 'closed' })

      expect(header().queryByText('Zamknięte')).not.toBeNull()
    })

    it('should show the progress of the run', () => {
      renderClient({ items: makeItems().map((item, index) => ({ ...item, status: index === 0 ? 'done' : 'todo' })) })

      expect(progressText()).toBe('1/3')
    })

    it('should let a manager change the closing period of an open run', () => {
      renderClient()

      expect(screen.queryByRole('button', { name: 'Zapisz okres' })).not.toBeNull()
    })
  })

  describe('manager on an open run', () => {
    it('should render a row per task', () => {
      renderClient()

      expect(rowTitles()).toEqual(['Wyciąg bankowy', 'Faktury kosztowe', 'Raport VAT'])
    })

    it('should show the add button', () => {
      renderClient()

      expect(addButton()).not.toBeNull()
    })

    it('should show a drag handle per task', () => {
      renderClient()

      expect(dragHandles()).toHaveLength(3)
    })

    it('should show a row menu per task', () => {
      renderClient()

      expect(rowMenus()).toHaveLength(3)
    })

    it('should show the "Zamknij miesiąc" button', () => {
      renderClient()

      expect(screen.queryByRole('button', { name: 'Zamknij miesiąc' })).not.toBeNull()
    })

    it('should not show the "Otwórz ponownie" button', () => {
      renderClient()

      expect(screen.queryByRole('button', { name: 'Otwórz ponownie' })).toBeNull()
    })

    it('should select the first task and show its description in the detail panel', () => {
      renderClient()

      expect(screen.queryByRole('heading', { level: 2, name: 'Wyciąg bankowy' })).not.toBeNull()
    })

    it('should show the procedure of the selected task', () => {
      renderClient()

      expect(screen.getByTestId('article-viewer').textContent).toBe('Krok 1: zaloguj się do banku')
    })

    it('should show the empty-procedure hint with the edit tip for a task without a procedure', async () => {
      renderClient()

      await userEvent.click(screen.getByText('Faktury kosztowe'))

      expect(
        screen.queryByText('To zadanie nie ma jeszcze podpiętej procedury. Możesz ją dodać w menu „⋯” → Edytuj.')
      ).not.toBeNull()
    })

    it('should show the empty-list message with the add hint when the run has no tasks', () => {
      renderClient({ items: [] })

      expect(
        screen.queryByText('Brak zadań w tym wykonaniu. Dodaj pierwsze zadanie przyciskiem powyżej.')
      ).not.toBeNull()
    })
  })

  describe('ticking a task', () => {
    it('should send PATCH with status done when a todo task is ticked', async () => {
      const fetchMock = stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i2', title: 'Faktury kosztowe', status: 'done' }))))
      renderClient()

      await userEvent.click(checkbox('Faktury kosztowe'))

      expect(requestOf(fetchMock)).toEqual({
        url: '/api/operations/runs/run-1/items/i2',
        method: 'PATCH',
        body: { status: 'done' },
      })
    })

    it('should update the progress counter after a task is ticked', async () => {
      stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i2', title: 'Faktury kosztowe', status: 'done' }))))
      renderClient()

      await userEvent.click(checkbox('Faktury kosztowe'))

      await waitFor(() => expect(progressText()).toBe('1/3'))
    })

    it('should check the checkbox after a task is ticked', async () => {
      stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i2', title: 'Faktury kosztowe', status: 'done' }))))
      renderClient()

      await userEvent.click(checkbox('Faktury kosztowe'))

      await waitFor(() => expect(checkbox('Faktury kosztowe').getAttribute('aria-checked')).toBe('true'))
    })

    it('should send PATCH with status todo when a done task is unticked', async () => {
      const fetchMock = stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i2', title: 'Faktury kosztowe' }))))
      renderClient({ items: makeItems().map((item) => (item.id === 'i2' ? { ...item, status: 'done' } : item)) })

      await userEvent.click(checkbox('Faktury kosztowe'))

      expect(requestOf(fetchMock).body).toEqual({ status: 'todo' })
    })

    it('should show "Gotowe do zamknięcia" once the last task is ticked', async () => {
      stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i3', title: 'Raport VAT', status: 'done' }))))
      renderClient({ items: makeItems().map((item) => (item.id === 'i3' ? item : { ...item, status: 'done' })) })

      await userEvent.click(checkbox('Raport VAT'))

      await waitFor(() => expect(header().queryByText('Gotowe do zamknięcia')).not.toBeNull())
    })

    it('should show an alert and keep the task unchecked when the server rejects the change', async () => {
      stubFetch(jsonResponse(500))
      renderClient()

      await userEvent.click(checkbox('Faktury kosztowe'))

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
      expect(checkbox('Faktury kosztowe').getAttribute('aria-checked')).toBe('false')
    })

    it('should show an alert when the request throws', async () => {
      stubFetchFailure()
      renderClient()

      await userEvent.click(checkbox('Faktury kosztowe'))

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
    })

    it('should keep the list on screen when the request throws', async () => {
      stubFetchFailure()
      renderClient()

      await userEvent.click(checkbox('Faktury kosztowe'))
      await screen.findByRole('alert')

      expect(rowTitles()).toEqual(['Wyciąg bankowy', 'Faktury kosztowe', 'Raport VAT'])
    })

    it('should let the user tick again after the request throws', async () => {
      stubFetchFailure()
      renderClient()
      await userEvent.click(checkbox('Faktury kosztowe'))
      await screen.findByRole('alert')

      await waitFor(() => expect(checkbox('Faktury kosztowe').disabled).toBe(false))
    })

    it('should clear the alert after the next successful change', async () => {
      const fetchMock = stubFetch(jsonResponse(500))
      renderClient()
      await userEvent.click(checkbox('Faktury kosztowe'))
      await screen.findByRole('alert')
      await waitFor(() => expect(checkbox('Faktury kosztowe').disabled).toBe(false))

      fetchMock.mockImplementation(jsonResponse(200, itemResponse(makeItem({ id: 'i2', title: 'Faktury kosztowe', status: 'done' }))))
      await userEvent.click(checkbox('Faktury kosztowe'))

      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })
  })

  describe('adding a task', () => {
    const created = makeItem({ id: 'i4', title: 'Rozliczenie ZUS', order: 4 })

    it('should open the "Nowe zadanie" form from the add button', async () => {
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: '+ Dodaj zadanie' }))

      expect(screen.queryByRole('heading', { name: 'Nowe zadanie' })).not.toBeNull()
    })

    it('should POST the form values to the items endpoint', async () => {
      const fetchMock = stubFetch(jsonResponse(201, itemResponse(created)))
      renderClient()

      await fillAndSubmitNewTask('Rozliczenie ZUS')

      expect(requestOf(fetchMock)).toEqual({
        url: '/api/operations/runs/run-1/items',
        method: 'POST',
        body: { title: 'Rozliczenie ZUS', description: null, procedureId: null, recurring: true },
      })
    })

    it('should append a row for the created task', async () => {
      stubFetch(jsonResponse(201, itemResponse(created)))
      renderClient()

      await fillAndSubmitNewTask('Rozliczenie ZUS')

      await waitFor(() => expect(rowTitles()).toEqual(['Wyciąg bankowy', 'Faktury kosztowe', 'Raport VAT', 'Rozliczenie ZUS']))
    })

    it('should select the created task in the detail panel', async () => {
      stubFetch(jsonResponse(201, itemResponse(created)))
      renderClient()

      await fillAndSubmitNewTask('Rozliczenie ZUS')

      expect(await screen.findByRole('heading', { level: 2, name: 'Rozliczenie ZUS' })).not.toBeNull()
    })

    it('should close the form after the task is created', async () => {
      stubFetch(jsonResponse(201, itemResponse(created)))
      renderClient()

      await fillAndSubmitNewTask('Rozliczenie ZUS')

      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nowe zadanie' })).toBeNull())
    })

    it('should count the created task in the progress', async () => {
      stubFetch(jsonResponse(201, itemResponse(created)))
      renderClient()

      await fillAndSubmitNewTask('Rozliczenie ZUS')

      await waitFor(() => expect(progressText()).toBe('0/4'))
    })

    it('should show the procedure returned with the created task', async () => {
      const procedure = { id: 'p2', title: 'Jak wystawić fakturę', content: 'Krok 1: otwórz program do faktur' }
      stubFetch(jsonResponse(201, itemResponse({ ...created, procedureId: 'p2' }, { procedure })))
      renderClient()

      await fillAndSubmitNewTask('Rozliczenie ZUS')

      await waitFor(() => expect(screen.getByTestId('article-viewer').textContent).toBe('Krok 1: otwórz program do faktur'))
    })

    it('should not send the request when the title is too short', async () => {
      const fetchMock = stubFetch(jsonResponse(201, itemResponse(created)))
      renderClient()

      await fillAndSubmitNewTask('ab')

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('should show an alert when the server rejects the task', async () => {
      stubFetch(jsonResponse(500))
      renderClient()

      await fillAndSubmitNewTask('Rozliczenie ZUS')

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
    })

    it('should keep the form and the typed title when the server rejects the task', async () => {
      stubFetch(jsonResponse(500))
      renderClient()

      await fillAndSubmitNewTask('Rozliczenie ZUS')
      await screen.findByRole('alert')

      expect((screen.getByLabelText('Tytuł zadania') as HTMLInputElement).value).toBe('Rozliczenie ZUS')
    })

    it('should not add a row when the server rejects the task', async () => {
      stubFetch(jsonResponse(500))
      renderClient()

      await fillAndSubmitNewTask('Rozliczenie ZUS')
      await screen.findByRole('alert')

      expect(rowTitles()).toHaveLength(3)
    })

    it('should show an alert and keep the form when the request throws', async () => {
      stubFetchFailure()
      renderClient()

      await fillAndSubmitNewTask('Rozliczenie ZUS')

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
      expect(screen.queryByRole('heading', { name: 'Nowe zadanie' })).not.toBeNull()
    })

    it('should close the form when "Anuluj" is clicked', async () => {
      renderClient()
      await userEvent.click(screen.getByRole('button', { name: '+ Dodaj zadanie' }))

      await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }))

      expect(screen.queryByRole('heading', { name: 'Nowe zadanie' })).toBeNull()
    })
  })

  describe('editing a task', () => {
    async function openEditForm(title: string) {
      await userEvent.click(screen.getByRole('button', { name: `Opcje zadania: ${title}` }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj' }))
    }

    it('should open the "Edytuj zadanie" form prefilled with the task', async () => {
      renderClient()

      await openEditForm('Wyciąg bankowy')

      expect((screen.getByLabelText('Tytuł zadania') as HTMLInputElement).value).toBe('Wyciąg bankowy')
    })

    it('should prefill the procedure of the task', async () => {
      renderClient()

      await openEditForm('Wyciąg bankowy')

      expect((screen.getByLabelText('Procedura „jak to zrobić” (opcjonalnie)') as HTMLSelectElement).value).toBe('p1')
    })

    it('should PATCH the edited values to the item endpoint', async () => {
      const fetchMock = stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i2', title: 'Faktury sprzedażowe', order: 2 }))))
      renderClient()
      await openEditForm('Faktury kosztowe')
      await userEvent.clear(screen.getByLabelText('Tytuł zadania'))
      await userEvent.type(screen.getByLabelText('Tytuł zadania'), 'Faktury sprzedażowe')

      await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }))

      expect(requestOf(fetchMock)).toEqual({
        url: '/api/operations/runs/run-1/items/i2',
        method: 'PATCH',
        body: { title: 'Faktury sprzedażowe', description: null, procedureId: null, recurring: true },
      })
    })

    it('should show the new title in the list and close the form after saving', async () => {
      stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i2', title: 'Faktury sprzedażowe', order: 2 }))))
      renderClient()
      await openEditForm('Faktury kosztowe')
      await userEvent.clear(screen.getByLabelText('Tytuł zadania'))
      await userEvent.type(screen.getByLabelText('Tytuł zadania'), 'Faktury sprzedażowe')

      await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }))

      await waitFor(() => expect(rowTitles()).toEqual(['Wyciąg bankowy', 'Faktury sprzedażowe', 'Raport VAT']))
      expect(screen.queryByRole('heading', { name: 'Edytuj zadanie' })).toBeNull()
    })

    it('should keep the form open and show an alert when saving fails', async () => {
      stubFetch(jsonResponse(500))
      renderClient()
      await openEditForm('Faktury kosztowe')

      await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }))

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
      expect(screen.queryByRole('heading', { name: 'Edytuj zadanie' })).not.toBeNull()
    })
  })

  describe('deleting a task', () => {
    it('should send DELETE to the item endpoint after confirmation', async () => {
      const fetchMock = stubFetch(jsonResponse(200, { ok: true }))
      renderClient()

      await deleteViaMenu('Faktury kosztowe')

      expect(requestOf(fetchMock)).toEqual({
        url: '/api/operations/runs/run-1/items/i2',
        method: 'DELETE',
        body: undefined,
      })
    })

    it('should remove the row', async () => {
      stubFetch(jsonResponse(200, { ok: true }))
      renderClient()

      await deleteViaMenu('Faktury kosztowe')

      await waitFor(() => expect(rowTitles()).toEqual(['Wyciąg bankowy', 'Raport VAT']))
    })

    it('should renumber the remaining tasks from 1', async () => {
      stubFetch(jsonResponse(200, { ok: true }))
      renderClient()

      await deleteViaMenu('Wyciąg bankowy')

      await waitFor(() => expect(listSpy.latest?.items.map((item) => item.title)).toEqual(['Faktury kosztowe', 'Raport VAT']))
      expect(listSpy.latest?.items.map((item) => (item as RunTask & { order: number }).order)).toEqual([1, 2])
    })

    it('should select the first remaining task when the selected one is deleted', async () => {
      stubFetch(jsonResponse(200, { ok: true }))
      renderClient()

      await deleteViaMenu('Wyciąg bankowy')

      expect(await screen.findByRole('heading', { level: 2, name: 'Faktury kosztowe' })).not.toBeNull()
    })

    it('should update the progress after a task is deleted', async () => {
      stubFetch(jsonResponse(200, { ok: true }))
      renderClient()

      await deleteViaMenu('Faktury kosztowe')

      await waitFor(() => expect(progressText()).toBe('0/2'))
    })

    it('should show the empty message after the last task is deleted', async () => {
      stubFetch(jsonResponse(200, { ok: true }))
      renderClient({ items: [makeItem({ id: 'i1', title: 'Wyciąg bankowy' })] })

      await deleteViaMenu('Wyciąg bankowy')

      expect(
        await screen.findByText('Brak zadań w tym wykonaniu. Dodaj pierwsze zadanie przyciskiem powyżej.')
      ).not.toBeNull()
    })

    it('should keep the row and show an alert when the server rejects the deletion', async () => {
      stubFetch(jsonResponse(500))
      renderClient()

      await deleteViaMenu('Faktury kosztowe')

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
      expect(rowTitles()).toHaveLength(3)
    })

    it('should not send a request when the deletion is not confirmed', async () => {
      const fetchMock = stubFetch(jsonResponse(200, { ok: true }))
      renderClient()
      await userEvent.click(screen.getByRole('button', { name: 'Opcje zadania: Faktury kosztowe' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }))

      await userEvent.click(screen.getByRole('button', { name: 'Nie' }))

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('reordering', () => {
    const reorder = (orderedIds: string[]) => act(async () => listSpy.latest?.onReorder(orderedIds))

    it('should PUT the new order to the order endpoint', async () => {
      const fetchMock = stubFetch(jsonResponse(200, { ok: true }))
      renderClient()

      await reorder(['i3', 'i1', 'i2'])

      expect(requestOf(fetchMock)).toEqual({
        url: '/api/operations/runs/run-1/items/order',
        method: 'PUT',
        body: { itemIds: ['i3', 'i1', 'i2'] },
      })
    })

    it('should show the new order after a successful save', async () => {
      stubFetch(jsonResponse(200, { ok: true }))
      renderClient()

      await reorder(['i3', 'i1', 'i2'])

      expect(rowTitles()).toEqual(['Raport VAT', 'Wyciąg bankowy', 'Faktury kosztowe'])
    })

    it('should renumber the tasks to match the new order', async () => {
      stubFetch(jsonResponse(200, { ok: true }))
      renderClient()

      await reorder(['i3', 'i1', 'i2'])

      expect(listSpy.latest?.items.map((item) => [item.id, (item as RunTask & { order: number }).order])).toEqual([
        ['i3', 1],
        ['i1', 2],
        ['i2', 3],
      ])
    })

    it('should show the new order before the server answers', async () => {
      let answer: (response: Response) => void = () => undefined
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => (answer = resolve)))
      )
      renderClient()

      await reorder(['i3', 'i1', 'i2'])

      expect(rowTitles()).toEqual(['Raport VAT', 'Wyciąg bankowy', 'Faktury kosztowe'])
      await act(async () => answer(new Response(JSON.stringify({ ok: true }), { status: 200 })))
    })

    it('should restore the previous order when the server rejects it', async () => {
      stubFetch(jsonResponse(500))
      renderClient()

      await reorder(['i3', 'i1', 'i2'])

      expect(rowTitles()).toEqual(['Wyciąg bankowy', 'Faktury kosztowe', 'Raport VAT'])
    })

    it('should show an alert when the server rejects the order', async () => {
      stubFetch(jsonResponse(500))
      renderClient()

      await reorder(['i3', 'i1', 'i2'])

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
    })

    it('should restore the previous order and show an alert when the request throws', async () => {
      stubFetchFailure()
      renderClient()

      await reorder(['i3', 'i1', 'i2'])

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
      expect(rowTitles()).toEqual(['Wyciąg bankowy', 'Faktury kosztowe', 'Raport VAT'])
    })
  })

  describe('closing and reopening the month', () => {
    it('should PATCH the run with status closed', async () => {
      const fetchMock = stubFetch(jsonResponse(200, { status: 'closed' }))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      expect(requestOf(fetchMock)).toEqual({
        url: '/api/operations/runs/run-1',
        method: 'PATCH',
        body: { status: 'closed' },
      })
    })

    it('should show the "Zamknięte" status after closing', async () => {
      stubFetch(jsonResponse(200, { status: 'closed' }))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      await waitFor(() => expect(header().queryByText('Zamknięte')).not.toBeNull())
    })

    it('should hide the add button after closing', async () => {
      stubFetch(jsonResponse(200, { status: 'closed' }))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      await waitFor(() => expect(addButton()).toBeNull())
    })

    it('should hide the drag handles after closing', async () => {
      stubFetch(jsonResponse(200, { status: 'closed' }))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      await waitFor(() => expect(dragHandles()).toHaveLength(0))
    })

    it('should hide the row menus after closing', async () => {
      stubFetch(jsonResponse(200, { status: 'closed' }))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      await waitFor(() => expect(rowMenus()).toHaveLength(0))
    })

    it('should disable the checkboxes after closing', async () => {
      stubFetch(jsonResponse(200, { status: 'closed' }))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      await waitFor(() => expect(checkbox('Faktury kosztowe').disabled).toBe(true))
    })

    it('should offer "Otwórz ponownie" instead of "Zamknij miesiąc" after closing', async () => {
      stubFetch(jsonResponse(200, { status: 'closed' }))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      expect(await screen.findByRole('button', { name: 'Otwórz ponownie' })).not.toBeNull()
      expect(screen.queryByRole('button', { name: 'Zamknij miesiąc' })).toBeNull()
    })

    it('should refresh the router after closing', async () => {
      stubFetch(jsonResponse(200, { status: 'closed' }))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    })

    it('should close an open task form when the month is closed', async () => {
      stubFetch(jsonResponse(200, { status: 'closed' }))
      renderClient()
      await userEvent.click(screen.getByRole('button', { name: '+ Dodaj zadanie' }))

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nowe zadanie' })).toBeNull())
    })

    it('should keep the month open and show an alert when closing fails', async () => {
      stubFetch(jsonResponse(409))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
      expect(addButton()).not.toBeNull()
    })

    it('should not refresh the router when closing fails', async () => {
      stubFetch(jsonResponse(409))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))
      await screen.findByRole('alert')

      expect(refresh).not.toHaveBeenCalled()
    })

    it('should show an alert when the close request throws', async () => {
      stubFetchFailure()
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
    })

    it('should PATCH the run with status open when reopening', async () => {
      const fetchMock = stubFetch(jsonResponse(200, { status: 'open' }))
      renderClient({ status: 'closed' })

      await userEvent.click(screen.getByRole('button', { name: 'Otwórz ponownie' }))

      expect(requestOf(fetchMock).body).toEqual({ status: 'open' })
    })

    it('should bring the editing controls back after reopening', async () => {
      stubFetch(jsonResponse(200, { status: 'open' }))
      renderClient({ status: 'closed' })

      await userEvent.click(screen.getByRole('button', { name: 'Otwórz ponownie' }))

      await waitFor(() => expect(addButton()).not.toBeNull())
      expect(dragHandles()).toHaveLength(3)
    })

    it('should enable the checkboxes after reopening', async () => {
      stubFetch(jsonResponse(200, { status: 'open' }))
      renderClient({ status: 'closed' })

      await userEvent.click(screen.getByRole('button', { name: 'Otwórz ponownie' }))

      await waitFor(() => expect(checkbox('Faktury kosztowe').disabled).toBe(false))
    })
  })

  describe('closed run', () => {
    it('should disable the checkboxes', () => {
      renderClient({ status: 'closed' })

      expect(checkbox('Faktury kosztowe').disabled).toBe(true)
    })

    it('should not show the add button', () => {
      renderClient({ status: 'closed' })

      expect(addButton()).toBeNull()
    })

    it('should not show drag handles or row menus', () => {
      renderClient({ status: 'closed' })

      expect([dragHandles().length, rowMenus().length]).toEqual([0, 0])
    })

    it('should not show the "Zamknij miesiąc" button', () => {
      renderClient({ status: 'closed' })

      expect(screen.queryByRole('button', { name: 'Zamknij miesiąc' })).toBeNull()
    })

    it('should show the closing period as read-only text', () => {
      renderClient({ status: 'closed' })

      expect(screen.queryByRole('button', { name: 'Zapisz okres' })).toBeNull()
    })

    it('should disable the task status buttons in the detail panel', () => {
      renderClient({ status: 'closed' })

      expect((screen.getByRole('button', { name: 'Gotowe' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('should make the note read-only', () => {
      renderClient({ status: 'closed' })

      expect((screen.getByPlaceholderText('Co blokuje zadanie albo co trzeba zapamiętać?') as HTMLTextAreaElement).readOnly).toBe(true)
    })

    it('should not send a request when a disabled checkbox is clicked', async () => {
      const fetchMock = stubFetch(jsonResponse(200, {}))
      renderClient({ status: 'closed' })

      await userEvent.click(checkbox('Faktury kosztowe'))

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('employee view', () => {
    const employee = { canManage: false, procedureOptions: [] }

    it('should not show the add button', () => {
      renderClient(employee)

      expect(addButton()).toBeNull()
    })

    it('should not show drag handles', () => {
      renderClient(employee)

      expect(dragHandles()).toHaveLength(0)
    })

    it('should not show row menus', () => {
      renderClient(employee)

      expect(rowMenus()).toHaveLength(0)
    })

    it('should not show the "Zamknij miesiąc" button', () => {
      renderClient(employee)

      expect(screen.queryByRole('button', { name: 'Zamknij miesiąc' })).toBeNull()
    })

    it('should not show the "Otwórz ponownie" button on a closed run', () => {
      renderClient({ ...employee, status: 'closed' })

      expect(screen.queryByRole('button', { name: 'Otwórz ponownie' })).toBeNull()
    })

    it('should show the closing period as read-only text', () => {
      renderClient(employee)

      expect(screen.queryByText('Zamykany okres: wrzesień 2026')).not.toBeNull()
    })

    it('should not offer period editing', () => {
      renderClient(employee)

      expect(screen.queryByRole('button', { name: 'Zapisz okres' })).toBeNull()
    })

    it('should not mention the edit menu in the empty-procedure hint', async () => {
      renderClient(employee)

      await userEvent.click(screen.getByText('Faktury kosztowe'))

      expect(screen.queryByText('To zadanie nie ma jeszcze podpiętej procedury.')).not.toBeNull()
    })

    it('should not show the add hint in the empty-list message', () => {
      renderClient({ ...employee, items: [] })

      expect(screen.queryByText(/Dodaj pierwsze zadanie/)).toBeNull()
    })

    it('should still enable the checkboxes on an open run', () => {
      renderClient(employee)

      expect(checkbox('Faktury kosztowe').disabled).toBe(false)
    })

    it('should send PATCH with status done when the employee ticks a task', async () => {
      const fetchMock = stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i2', title: 'Faktury kosztowe', status: 'done' }))))
      renderClient(employee)

      await userEvent.click(checkbox('Faktury kosztowe'))

      expect(requestOf(fetchMock).body).toEqual({ status: 'done' })
    })

    it('should update the progress after the employee ticks a task', async () => {
      stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i2', title: 'Faktury kosztowe', status: 'done' }))))
      renderClient(employee)

      await userEvent.click(checkbox('Faktury kosztowe'))

      await waitFor(() => expect(progressText()).toBe('1/3'))
    })
  })

  describe('selected task panel', () => {
    it('should show the note of the selected task', async () => {
      renderClient({ items: makeItems().map((item) => (item.id === 'i2' ? { ...item, note: 'Czekam na fakturę' } : item)) })

      await userEvent.click(screen.getByText('Faktury kosztowe'))

      expect((screen.getByPlaceholderText('Co blokuje zadanie albo co trzeba zapamiętać?') as HTMLTextAreaElement).value).toBe('Czekam na fakturę')
    })

    it('should save a changed note when the field loses focus', async () => {
      const fetchMock = stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i1', title: 'Wyciąg bankowy', note: 'Brak dostępu' }))))
      renderClient()

      await userEvent.type(screen.getByPlaceholderText('Co blokuje zadanie albo co trzeba zapamiętać?'), 'Brak dostępu')
      await userEvent.tab()

      expect(requestOf(fetchMock)).toEqual({
        url: '/api/operations/runs/run-1/items/i1',
        method: 'PATCH',
        body: { note: 'Brak dostępu' },
      })
    })

    it('should not save an unchanged note when the field loses focus', async () => {
      const fetchMock = stubFetch(jsonResponse(200, {}))
      renderClient()

      await userEvent.click(screen.getByPlaceholderText('Co blokuje zadanie albo co trzeba zapamiętać?'))
      await userEvent.tab()

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('should PATCH the status chosen in the detail panel', async () => {
      const fetchMock = stubFetch(jsonResponse(200, itemResponse(makeItem({ id: 'i1', title: 'Wyciąg bankowy', status: 'blocked' }))))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Bloker' }))

      expect(requestOf(fetchMock).body).toEqual({ status: 'blocked' })
    })
  })

  describe('closing period', () => {
    it('should PATCH the chosen month and year', async () => {
      const fetchMock = stubFetch(
        jsonResponse(200, { name: 'Zamknięcie miesiąca - sierpień 2026', periodYear: 2026, periodMonth: 8 })
      )
      renderClient()
      await userEvent.selectOptions(screen.getByDisplayValue('wrzesień'), 'sierpień')

      await userEvent.click(screen.getByRole('button', { name: 'Zapisz okres' }))

      expect(requestOf(fetchMock)).toEqual({
        url: '/api/operations/runs/run-1',
        method: 'PATCH',
        body: { periodYear: 2026, periodMonth: 8 },
      })
    })

    it('should show the new run name after the period is saved', async () => {
      stubFetch(jsonResponse(200, { name: 'Zamknięcie miesiąca - sierpień 2026', periodYear: 2026, periodMonth: 8 }))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zapisz okres' }))

      expect(await screen.findByRole('heading', { level: 1, name: 'Zamknięcie miesiąca - sierpień 2026' })).not.toBeNull()
    })

    it('should show an alert when the server rejects the period', async () => {
      stubFetch(jsonResponse(409))
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zapisz okres' }))

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
    })

    it('should show an alert when the period request throws', async () => {
      stubFetchFailure()
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zapisz okres' }))

      expect((await screen.findByRole('alert')).textContent).toBe(SAVE_ERROR)
    })

    it('should enable the "Zapisz okres" button again when the period request throws', async () => {
      stubFetchFailure()
      renderClient()

      await userEvent.click(screen.getByRole('button', { name: 'Zapisz okres' }))
      await screen.findByRole('alert')

      expect((screen.getByRole('button', { name: 'Zapisz okres' }) as HTMLButtonElement).disabled).toBe(false)
    })
  })
})
