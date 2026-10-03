import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunStatusButton } from '@/components/operations/run-status-button'
import { StartMonthBanner } from '@/components/operations/start-month-banner'
import { StartRunButton } from '@/components/operations/start-run-button'

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

function jsonResponse(status: number, body: unknown = {}) {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    )
}

function stubFetch(respond: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(respond)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function stubFetchFailure() {
  return stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
}

function requestOf(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls[0]
  return { url, init: init as RequestInit, body: JSON.parse(String(init?.body)) as unknown }
}

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('StartMonthBanner', () => {
  const bannerButton = { name: 'Rozpocznij zamknięcie: wrzesień 2026' }

  function renderBanner() {
    return render(<StartMonthBanner templateId="tpl-1" periodYear={2026} periodMonth={9} />)
  }

  it('should name the missing month in the heading', () => {
    renderBanner()

    expect(screen.queryByText('wrzesień 2026 nie ma jeszcze zamknięcia')).not.toBeNull()
  })

  it('should post the template and the missing period to the runs API', async () => {
    const fetchMock = stubFetch(jsonResponse(201, { id: 'run-new' }))
    renderBanner()

    await userEvent.click(screen.getByRole('button', bannerButton))

    expect(requestOf(fetchMock).body).toEqual({ templateId: 'tpl-1', periodYear: 2026, periodMonth: 9 })
  })

  it('should use POST on /api/operations/runs', async () => {
    const fetchMock = stubFetch(jsonResponse(201, { id: 'run-new' }))
    renderBanner()

    await userEvent.click(screen.getByRole('button', bannerButton))

    const { url, init } = requestOf(fetchMock)
    expect([url, init.method]).toEqual(['/api/operations/runs', 'POST'])
  })

  it('should open the new run after a 201', async () => {
    stubFetch(jsonResponse(201, { id: 'run-new' }))
    renderBanner()

    await userEvent.click(screen.getByRole('button', bannerButton))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/operations/runs/run-new'))
  })

  it('should open the existing run after a 409 with a runId', async () => {
    stubFetch(jsonResponse(409, { error: 'duplicate', runId: 'run-existing' }))
    renderBanner()

    await userEvent.click(screen.getByRole('button', bannerButton))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/operations/runs/run-existing'))
  })

  it('should show an alert after a 500', async () => {
    stubFetch(jsonResponse(500))
    renderBanner()

    await userEvent.click(screen.getByRole('button', bannerButton))

    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się utworzyć wykonania. Spróbuj ponownie.')
  })

  it('should not navigate after a 500', async () => {
    stubFetch(jsonResponse(500))
    renderBanner()

    await userEvent.click(screen.getByRole('button', bannerButton))
    await screen.findByRole('alert')

    expect(push).not.toHaveBeenCalled()
  })

  it('should show an alert when the request throws', async () => {
    stubFetchFailure()
    renderBanner()

    await userEvent.click(screen.getByRole('button', bannerButton))

    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się utworzyć wykonania. Spróbuj ponownie.')
  })

  it('should enable the button again when the request throws', async () => {
    stubFetchFailure()
    renderBanner()

    await userEvent.click(screen.getByRole('button', bannerButton))
    await screen.findByRole('alert')

    await waitFor(() => expect((screen.getByRole('button', bannerButton) as HTMLButtonElement).disabled).toBe(false))
  })

  it('should show an alert when a 409 body is not valid JSON', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>conflict</html>', { status: 409 })))
    renderBanner()

    await userEvent.click(screen.getByRole('button', bannerButton))

    expect(await screen.findByRole('alert')).not.toBeNull()
  })

  it('should show an alert after a 409 without a runId', async () => {
    stubFetch(jsonResponse(409, { error: 'duplicate' }))
    renderBanner()

    await userEvent.click(screen.getByRole('button', bannerButton))

    expect(await screen.findByRole('alert')).not.toBeNull()
  })

  it('should clear the previous error when the request is retried', async () => {
    const fetchMock = stubFetch(jsonResponse(500))
    renderBanner()
    await userEvent.click(screen.getByRole('button', bannerButton))
    await screen.findByRole('alert')

    fetchMock.mockImplementation(jsonResponse(201, { id: 'run-new' }))
    await userEvent.click(screen.getByRole('button', bannerButton))

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('StartRunButton', () => {
  async function openPopup() {
    await userEvent.click(screen.getByRole('button', { name: '+ Rozpocznij miesiąc' }))
  }

  function renderButton() {
    return render(<StartRunButton templateId="tpl-1" label="+ Rozpocznij miesiąc" />)
  }

  it('should use the default label when none is given', () => {
    render(<StartRunButton templateId="tpl-1" />)

    expect(screen.queryByRole('button', { name: 'Uruchom zamknięcie miesiąca' })).not.toBeNull()
  })

  it('should keep the popup closed until the button is clicked', () => {
    renderButton()

    expect(screen.queryByLabelText('Miesiąc')).toBeNull()
  })

  it('should expose the month select with the "Miesiąc" label', async () => {
    renderButton()

    await openPopup()

    expect(screen.getByLabelText('Miesiąc').tagName).toBe('SELECT')
  })

  it('should expose the year input with the "Rok" label', async () => {
    renderButton()

    await openPopup()

    expect(screen.getByLabelText('Rok').tagName).toBe('INPUT')
  })

  it('should propose the previous month by default, across the year boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 15))
    renderButton()

    await openPopup()

    expect(screen.queryByRole('button', { name: 'Utwórz wykonanie: grudzień 2025' })).not.toBeNull()
  })

  it('should name the chosen period on the submit button', async () => {
    renderButton()
    await openPopup()

    await userEvent.selectOptions(screen.getByLabelText('Miesiąc'), 'marzec')

    expect(screen.queryByRole('button', { name: /^Utwórz wykonanie: marzec \d{4}$/ })).not.toBeNull()
  })

  it('should post the chosen period', async () => {
    const fetchMock = stubFetch(jsonResponse(201, { id: 'run-new' }))
    renderButton()
    await openPopup()
    await userEvent.selectOptions(screen.getByLabelText('Miesiąc'), 'marzec')
    await userEvent.clear(screen.getByLabelText('Rok'))
    await userEvent.type(screen.getByLabelText('Rok'), '2025')

    await userEvent.click(screen.getByRole('button', { name: 'Utwórz wykonanie: marzec 2025' }))

    expect(requestOf(fetchMock).body).toEqual({ templateId: 'tpl-1', periodYear: 2025, periodMonth: 3 })
  })

  it('should open the new run after a 201', async () => {
    stubFetch(jsonResponse(201, { id: 'run-new' }))
    renderButton()
    await openPopup()

    await userEvent.click(screen.getByRole('button', { name: /^Utwórz wykonanie:/ }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/operations/runs/run-new'))
  })

  it('should open the existing run after a 409 with a runId', async () => {
    stubFetch(jsonResponse(409, { error: 'duplicate', runId: 'run-existing' }))
    renderButton()
    await openPopup()

    await userEvent.click(screen.getByRole('button', { name: /^Utwórz wykonanie:/ }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/operations/runs/run-existing'))
  })

  it('should show an alert after a 500', async () => {
    stubFetch(jsonResponse(500))
    renderButton()
    await openPopup()

    await userEvent.click(screen.getByRole('button', { name: /^Utwórz wykonanie:/ }))

    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się utworzyć wykonania. Spróbuj ponownie.')
  })

  it('should not navigate after a 500', async () => {
    stubFetch(jsonResponse(500))
    renderButton()
    await openPopup()

    await userEvent.click(screen.getByRole('button', { name: /^Utwórz wykonanie:/ }))
    await screen.findByRole('alert')

    expect(push).not.toHaveBeenCalled()
  })

  it('should show an alert when the request throws', async () => {
    stubFetchFailure()
    renderButton()
    await openPopup()

    await userEvent.click(screen.getByRole('button', { name: /^Utwórz wykonanie:/ }))

    expect(await screen.findByRole('alert')).not.toBeNull()
  })

  it('should enable the submit button again when the request throws', async () => {
    stubFetchFailure()
    renderButton()
    await openPopup()

    await userEvent.click(screen.getByRole('button', { name: /^Utwórz wykonanie:/ }))
    await screen.findByRole('alert')

    await waitFor(() =>
      expect((screen.getByRole('button', { name: /^Utwórz wykonanie:/ }) as HTMLButtonElement).disabled).toBe(false)
    )
  })
})

describe('RunStatusButton', () => {
  function renderButton() {
    return render(
      <RunStatusButton runId="run-7" nextStatus="closed">
        Zamknij miesiąc
      </RunStatusButton>
    )
  }

  it('should send PATCH with the next status to the run endpoint', async () => {
    const fetchMock = stubFetch(jsonResponse(200))
    renderButton()

    await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

    const { url, init } = requestOf(fetchMock)
    expect([url, init.method]).toEqual(['/api/operations/runs/run-7', 'PATCH'])
  })

  it('should send the next status as the request body', async () => {
    const fetchMock = stubFetch(jsonResponse(200))
    renderButton()

    await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

    expect(requestOf(fetchMock).body).toEqual({ status: 'closed' })
  })

  it('should refresh the page after a successful change', async () => {
    stubFetch(jsonResponse(200))
    renderButton()

    await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('should show an alert when the server rejects the change', async () => {
    stubFetch(jsonResponse(409))
    renderButton()

    await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się zapisać.')
  })

  it('should not refresh the page when the server rejects the change', async () => {
    stubFetch(jsonResponse(409))
    renderButton()

    await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))
    await screen.findByRole('alert')

    expect(refresh).not.toHaveBeenCalled()
  })

  it('should show an alert when the request throws', async () => {
    stubFetchFailure()
    renderButton()

    await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się zapisać.')
  })

  it('should enable the button again when the request throws', async () => {
    stubFetchFailure()
    renderButton()

    await userEvent.click(screen.getByRole('button', { name: 'Zamknij miesiąc' }))
    await screen.findByRole('alert')

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Zamknij miesiąc' }) as HTMLButtonElement).disabled).toBe(false)
    )
  })

  it('should use the accessible name when one is given', () => {
    render(
      <RunStatusButton runId="run-7" nextStatus="closed" ariaLabel="Zamknij miesiąc: Wrzesień">
        Zamknij miesiąc
      </RunStatusButton>
    )

    expect(screen.queryByRole('button', { name: 'Zamknij miesiąc: Wrzesień' })).not.toBeNull()
  })
})
