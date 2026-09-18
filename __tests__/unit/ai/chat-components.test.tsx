import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiChatWidget } from '@/components/shared/ai-chat-widget'
import { AiAssistant } from '@/components/wikipedia/AiAssistant/AiPanel'
import { aiChatResultSchema } from '@/lib/ai/contracts'

const location = vi.hoisted(() => ({ pathname: '/dashboard' }))
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname }))

function response(kind: 'FINANCE_CHAT' | 'WIKI_CHAT', status: string, overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ job: { id: 'chat-job', kind, status, result: status === 'SUCCEEDED' ? { answer: 'Gotowa odpowiedź.' } : null,
    errorCode: null, blockedReason: null, attempts: 0, createdAt: '2026-09-10T12:00:00.000Z', updatedAt: '2026-09-10T12:00:00.000Z', ...overrides } }),
  { status: 202, headers: { 'Content-Type': 'application/json' } })
}
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  location.pathname = '/dashboard'
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

const panels = [
  { kind: 'FINANCE_CHAT' as const, render: () => render(<AiChatWidget role="ADMIN" />), title: 'AI Analyst', placeholder: 'Zadaj pytanie o finanse...', endpoint: '/api/ai/chat' },
  { kind: 'WIKI_CHAT' as const, render: () => render(<AiAssistant articleTitle="Artykuł" articleCategory="Montaż" articleContent={'x'.repeat(4000)} />), title: 'AI Asystent wiedzy', placeholder: 'Zadaj pytanie o ten artykuł...', endpoint: '/api/knowledge/ai' },
]

describe('financial chat visibility', () => {
  it('does not offer a financial action to roles rejected by the financial API', () => {
    for (const role of ['MANAGER', 'EMPLOYEE', 'INSTALLER']) {
      const view = render(<AiChatWidget role={role} />)
      expect(screen.queryByTitle('AI Analyst')).toBeNull()
      view.unmount()
    }
  })

  it('does not cover the knowledge assistant with a second floating button', () => {
    location.pathname = '/knowledge/test-article'
    render(<AiChatWidget role="ADMIN" />)
    expect(screen.queryByTitle('AI Analyst')).toBeNull()
  })
})

describe.each(panels)('$kind async chat panel', (panel) => {
  function ask() {
    fireEvent.click(screen.getByTitle(panel.title))
    fireEvent.change(screen.getByPlaceholderText(panel.placeholder), { target: { value: 'Co wiemy?' } })
    fireEvent.keyDown(screen.getByPlaceholderText(panel.placeholder), { key: 'Enter' })
  }

  it('constrains the fixed panel to a narrow mobile viewport', () => {
    panel.render()
    fireEvent.click(screen.getByTitle(panel.title))
    const closeLabel = panel.kind === 'FINANCE_CHAT' ? 'Zamknij czat finansowy' : 'Zamknij asystenta wiedzy'
    const fixedPanel = screen.getByRole('button', { name: closeLabel }).closest('div.fixed')
    expect(fixedPanel?.className).toContain('max-w-[calc(100vw-2rem)]')
    expect(fixedPanel?.className).toContain('max-h-[calc(100dvh-')
  })

  it('shows queue progress then a final answer using the same server job', async () => {
    fetchMock.mockResolvedValueOnce(response(panel.kind, 'QUEUED')).mockResolvedValueOnce(response(panel.kind, 'RUNNING')).mockResolvedValueOnce(response(panel.kind, 'SUCCEEDED'))
    panel.render()
    ask()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('status').textContent).toContain('W kolejce')
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByRole('status').textContent).toContain('Przygotowuję odpowiedź')
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(screen.getByText('Gotowa odpowiedź.')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe(panel.endpoint)
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body) as Record<string, unknown>
    expect(payload.requestId).toEqual(expect.any(String))
    if (panel.kind === 'FINANCE_CHAT') expect(payload).toMatchObject({ year: 2026, month: 9 })
    else {
      expect(payload).toMatchObject({ articleTitle: 'Artykuł', articleCategory: 'Montaż' })
      expect(payload.articleContent).toEqual('x'.repeat(3000))
    }
  })

  it('renders an accepted image answer without creating automatic-fetch resources', async () => {
    const result = aiChatResultSchema.parse({ answer: [
      '![schemat](https://example.invalid/collect?article=SYNTHETIC_INTERNAL_CONTEXT)',
      '![](https://example.invalid/empty)',
      '**Ważne**',
      '- Pierwszy krok',
      '[Dokumentacja](https://example.invalid/guide)',
      '<iframe src="https://example.invalid/frame"></iframe>',
      '<img src="https://example.invalid/raw-image" />',
      '<link rel="preload" href="https://example.invalid/preload" as="image" />',
    ].join('\n\n') })
    fetchMock.mockResolvedValueOnce(response(panel.kind, 'QUEUED'))
      .mockResolvedValueOnce(response(panel.kind, 'SUCCEEDED', { result }))
    const view = panel.render()
    ask()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('status').textContent).toContain('W kolejce')
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(screen.queryByRole('status')).toBeNull()

    expect(document.querySelectorAll('img, link, iframe, script, video, audio, source, track, object, embed, input[type="image"]')).toHaveLength(0)
    if (panel.kind === 'WIKI_CHAT') {
      expect(screen.getByText('schemat')).toBeTruthy()
      expect(screen.getByText('[Obraz pominięty]')).toBeTruthy()
      expect(view.container.querySelector('strong')?.textContent).toBe('Ważne')
      expect(screen.getByRole('listitem').textContent).toBe('Pierwszy krok')
      expect(screen.getByRole('link', { name: 'Dokumentacja' }).getAttribute('href')).toBe('https://example.invalid/guide')
    } else {
      expect(view.container.textContent).toContain('![schemat](https://example.invalid/collect?article=SYNTHETIC_INTERNAL_CONTEXT)')
      expect(view.container.textContent).toContain('[Dokumentacja](https://example.invalid/guide)')
      expect(screen.queryByRole('link')).toBeNull()
    }
    expect(view.container.textContent).toContain('<iframe src="https://example.invalid/frame"></iframe>')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([panel.endpoint, '/api/ai/jobs/chat-job'])
  })

  it('shows controlled errors and retries the existing job instead of sending another question', async () => {
    fetchMock.mockResolvedValueOnce(response(panel.kind, 'FAILED', { errorCode: 'QUOTA' })).mockResolvedValueOnce(response(panel.kind, 'SUCCEEDED'))
    panel.render()
    ask()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('alert').textContent).toContain('limit')
    fireEvent.click(screen.getByRole('button', { name: 'Ponów zadanie' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/ai/jobs/chat-job/retry')
    expect(screen.getAllByText('Co wiemy?')).toHaveLength(1)
    expect(screen.getByText('Gotowa odpowiedź.')).toBeTruthy()
  })

  it('offers explicit retry for a blocked shared queue and stops polling after unmount', async () => {
    fetchMock.mockResolvedValueOnce(response(panel.kind, 'QUEUED', { blockedReason: 'AUTH' })).mockResolvedValueOnce(response(panel.kind, 'RUNNING'))
    const view = panel.render()
    ask()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ponów zadanie' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/ai/jobs/chat-job/retry')
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    view.unmount()
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers an uncertain POST with the same requestId and frozen context after the context changes', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network interruption')).mockResolvedValueOnce(response(panel.kind, 'SUCCEEDED'))
    const view = panel.render()
    ask()
    await act(() => vi.advanceTimersByTimeAsync(0))
    if (panel.kind === 'FINANCE_CHAT') {
      fireEvent.change(screen.getByLabelText('Rok danych'), { target: { value: '2025' } })
      fireEvent.change(screen.getByLabelText('Miesiąc danych'), { target: { value: '7' } })
    } else {
      view.rerender(<AiAssistant articleTitle="Zmieniony artykuł" articleCategory="Nowa kategoria" articleContent="Nowa treść" />)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Odzyskaj zadanie' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body)
    expect(screen.getAllByText('Co wiemy?')).toHaveLength(1)
    expect(screen.getByText('Gotowa odpowiedź.')).toBeTruthy()
  })
})

it('uses actual-finance starter copy and an explicit selected month with year', async () => {
  render(<AiChatWidget role="ADMIN" />)
  fireEvent.click(screen.getByTitle('AI Analyst'))
  expect(screen.queryByText(/wykonanie budżetu|największym kosztem/i)).toBeNull()
  fireEvent.change(screen.getByLabelText('Rok danych'), { target: { value: '2025' } })
  expect((screen.getByLabelText('Miesiąc danych') as HTMLSelectElement).value).toBe('12')
  fireEvent.change(screen.getByLabelText('Miesiąc danych'), { target: { value: '7' } })
  fetchMock.mockResolvedValueOnce(response('FINANCE_CHAT', 'SUCCEEDED'))
  fireEvent.change(screen.getByPlaceholderText('Zadaj pytanie o finanse...'), { target: { value: 'Wynik?' } })
  fireEvent.keyDown(screen.getByPlaceholderText('Zadaj pytanie o finanse...'), { key: 'Enter' })
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ year: 2025, month: 7 })
})

it('keeps the finance year selector and default period in Europe/Warsaw at the new-year boundary', () => {
  vi.setSystemTime(new Date('2026-12-31T23:30:00Z'))
  render(<AiChatWidget role="ADMIN" />)
  fireEvent.click(screen.getByTitle('AI Analyst'))
  expect((screen.getByLabelText('Rok danych') as HTMLSelectElement).value).toBe('2027')
  expect((screen.getByLabelText('Miesiąc danych') as HTMLSelectElement).value).toBe('1')
  const years = Array.from((screen.getByLabelText('Rok danych') as HTMLSelectElement).options).map((option) => option.value)
  expect(years).toEqual(['2026', '2027', '2028'])
})
