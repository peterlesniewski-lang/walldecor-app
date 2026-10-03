import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RunsList } from '@/components/operations/runs-list'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

type RunsListProps = Parameters<typeof RunsList>[0]
type RunListItem = RunsListProps['runs'][number]

function makeRun(overrides: Partial<RunListItem> = {}): RunListItem {
  return {
    id: 'run-1',
    name: 'Zamknięcie miesiąca - wrzesień 2026',
    status: 'open',
    nextItemTitle: null,
    readyToClose: false,
    template: { module: { name: 'Księgowość', area: { name: 'Finanse' } } },
    progress: { total: 4, done: 1, blocked: 0, percent: 25 },
    ...overrides,
  }
}

function renderList(runs: RunListItem[], canManage = true) {
  return render(<RunsList runs={runs} canManage={canManage} />)
}

function sectionOf(heading: string) {
  const section = screen.getByRole('heading', { name: heading }).closest('section')
  if (!section) throw new Error(`Section "${heading}" not found`)
  return section
}

describe('RunsList', () => {
  describe('empty state', () => {
    it('should point a manager to the "Rozpocznij miesiąc" button when there are no runs', () => {
      renderList([], true)

      expect(screen.queryByText(/Użyj przycisku „Rozpocznij miesiąc”/)).not.toBeNull()
    })

    it('should show a neutral message to a user who cannot start months when there are no runs', () => {
      renderList([], false)

      expect(screen.queryByText('Brak wykonań do wyświetlenia.')).not.toBeNull()
    })

    it('should not mention the hidden "Rozpocznij miesiąc" button to a user who cannot start months', () => {
      renderList([], false)

      expect(screen.queryByText(/Rozpocznij miesiąc/)).toBeNull()
    })

    it('should not render any section heading when there are no runs', () => {
      renderList([])

      expect(screen.queryAllByRole('heading')).toHaveLength(0)
    })
  })

  describe('sections', () => {
    it('should list an open run under "Do zrobienia"', () => {
      renderList([makeRun({ id: 'open-run', name: 'Otwarty miesiąc', status: 'open' })])

      expect(within(sectionOf('Do zrobienia')).queryByText('Otwarty miesiąc')).not.toBeNull()
    })

    it('should list a closed run under "Zamknięte"', () => {
      renderList([makeRun({ id: 'closed-run', name: 'Zamknięty miesiąc', status: 'closed' })])

      expect(within(sectionOf('Zamknięte')).queryByText('Zamknięty miesiąc')).not.toBeNull()
    })

    it('should keep an open run out of the "Zamknięte" section', () => {
      renderList([
        makeRun({ id: 'open-run', name: 'Otwarty miesiąc', status: 'open' }),
        makeRun({ id: 'closed-run', name: 'Zamknięty miesiąc', status: 'closed' }),
      ])

      expect(within(sectionOf('Zamknięte')).queryByText('Otwarty miesiąc')).toBeNull()
    })

    it('should keep a closed run out of the "Do zrobienia" section', () => {
      renderList([
        makeRun({ id: 'open-run', name: 'Otwarty miesiąc', status: 'open' }),
        makeRun({ id: 'closed-run', name: 'Zamknięty miesiąc', status: 'closed' }),
      ])

      expect(within(sectionOf('Do zrobienia')).queryByText('Zamknięty miesiąc')).toBeNull()
    })

    it('should omit the "Do zrobienia" section when every run is closed', () => {
      renderList([makeRun({ status: 'closed' })])

      expect(screen.queryByRole('heading', { name: 'Do zrobienia' })).toBeNull()
    })

    it('should omit the "Zamknięte" section when every run is open', () => {
      renderList([makeRun({ status: 'open' })])

      expect(screen.queryByRole('heading', { name: 'Zamknięte' })).toBeNull()
    })

    it('should link the card title to the run detail page', () => {
      renderList([makeRun({ id: 'run-42', name: 'Wrzesień' })])

      expect(screen.getByRole('link', { name: 'Wrzesień' }).getAttribute('href')).toBe('/operations/runs/run-42')
    })
  })

  describe('status badge', () => {
    it('should show "Gotowe do zamknięcia" to a manager for an open run that is ready to close', () => {
      renderList([makeRun({ status: 'open', readyToClose: true })], true)

      expect(screen.queryByText('Gotowe do zamknięcia')).not.toBeNull()
    })

    it('should not show "Gotowe do zamknięcia" to an employee for an open run that is ready to close', () => {
      renderList([makeRun({ status: 'open', readyToClose: true })], false)

      expect(screen.queryByText('Gotowe do zamknięcia')).toBeNull()
    })

    it('should show "W toku" to an employee for an open run that is ready to close', () => {
      renderList([makeRun({ status: 'open', readyToClose: true })], false)

      expect(screen.queryByText('W toku')).not.toBeNull()
    })

    it('should show "W toku" to an employee for an open run that is not ready to close', () => {
      renderList([makeRun({ status: 'open', readyToClose: false })], false)

      expect(screen.queryByText('W toku')).not.toBeNull()
    })

    it('should show "W toku" for an open run that is not ready to close', () => {
      renderList([makeRun({ status: 'open', readyToClose: false })])

      expect(screen.queryByText('W toku')).not.toBeNull()
    })

    it('should not show "Gotowe do zamknięcia" for an open run that is not ready to close', () => {
      renderList([makeRun({ status: 'open', readyToClose: false })])

      expect(screen.queryByText('Gotowe do zamknięcia')).toBeNull()
    })

    it('should show "Zamknięte" as the badge of a closed run next to the section heading', () => {
      renderList([makeRun({ status: 'closed' })])

      expect(screen.getAllByText('Zamknięte')).toHaveLength(2)
    })

    it('should not show "Gotowe do zamknięcia" for a closed run even if readyToClose is set', () => {
      renderList([makeRun({ status: 'closed', readyToClose: true })])

      expect(screen.queryByText('Gotowe do zamknięcia')).toBeNull()
    })
  })

  describe('"Zamknij miesiąc" button', () => {
    it('should show the button to a manager for an open run that is ready to close', () => {
      renderList([makeRun({ name: 'Wrzesień', status: 'open', readyToClose: true })], true)

      expect(screen.queryByRole('button', { name: 'Zamknij miesiąc: Wrzesień' })).not.toBeNull()
    })

    it('should keep the visible button text as "Zamknij miesiąc"', () => {
      renderList([makeRun({ name: 'Wrzesień', status: 'open', readyToClose: true })], true)

      expect(screen.getByRole('button', { name: /Zamknij miesiąc/ }).textContent).toBe('Zamknij miesiąc')
    })

    it('should not nest the button inside the card link', () => {
      renderList([makeRun({ status: 'open', readyToClose: true })], true)

      expect(screen.getByRole('button', { name: /Zamknij miesiąc/ }).closest('a')).toBeNull()
    })

    it('should hide the button from a user who cannot manage runs', () => {
      renderList([makeRun({ status: 'open', readyToClose: true })], false)

      expect(screen.queryByRole('button', { name: /Zamknij miesiąc/ })).toBeNull()
    })

    it('should hide the button when the run is not ready to close', () => {
      renderList([makeRun({ status: 'open', readyToClose: false })], true)

      expect(screen.queryByRole('button', { name: /Zamknij miesiąc/ })).toBeNull()
    })

    it('should hide the button for a closed run', () => {
      renderList([makeRun({ status: 'closed', readyToClose: true })], true)

      expect(screen.queryByRole('button', { name: /Zamknij miesiąc/ })).toBeNull()
    })
  })

  describe('next task hint', () => {
    it('should show "Następne: <title>" for an open run with a next task', () => {
      renderList([makeRun({ status: 'open', nextItemTitle: 'Uzgodnij faktury' })])

      expect(screen.getByText('Następne:').textContent).toBe('Następne: Uzgodnij faktury')
    })

    it('should not show the next task for a closed run', () => {
      renderList([makeRun({ status: 'closed', nextItemTitle: 'Uzgodnij faktury' })])

      expect(screen.queryByText('Następne:')).toBeNull()
    })

    it('should not show the next task when the open run has none', () => {
      renderList([makeRun({ status: 'open', nextItemTitle: null })])

      expect(screen.queryByText('Następne:')).toBeNull()
    })
  })

  describe('blocker chip', () => {
    it('should show the blocker count when a task is blocked', () => {
      renderList([makeRun({ progress: { total: 4, done: 1, blocked: 2, percent: 25 } })])

      expect(screen.queryByText('2 bloker')).not.toBeNull()
    })

    it('should not show the blocker chip when no task is blocked', () => {
      renderList([makeRun({ progress: { total: 4, done: 1, blocked: 0, percent: 25 } })])

      expect(screen.queryByText(/bloker/)).toBeNull()
    })
  })

  describe('progress', () => {
    it('should show done and total task counts', () => {
      renderList([makeRun({ progress: { total: 7, done: 3, blocked: 0, percent: 43 } })])

      expect(screen.queryByText('3/7')).not.toBeNull()
    })
  })
})
