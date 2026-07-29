import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LeaveEntitlementPanel,
  type LeaveEntitlementPanelData,
} from '@/components/hr/employees/leave-entitlement-panel'

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

const configuredData: LeaveEntitlementPanelData = {
  config: {
    id: 'config-1',
    mode: 'DAYS_26',
    customAnnualDays: null,
    employmentFraction: 1,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    note: null,
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  calculatedDays: 26,
  balance: {
    id: 'balance-1',
    year: 2026,
    totalDays: 26,
    usedDays: 5,
    pendingDays: 2,
    carriedOver: 3,
  },
  corrections: [],
  needsReview: false,
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function renderPanel(data: LeaveEntitlementPanelData = configuredData) {
  return render(
    <LeaveEntitlementPanel
      employeeId="employee-1"
      targetYear={2026}
      initialData={data}
    />
  )
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('LeaveEntitlementPanel', () => {
  it('marks missing effective configuration for review', () => {
    renderPanel({
      config: null,
      calculatedDays: null,
      balance: null,
      corrections: [],
      needsReview: true,
    })

    expect(screen.getByText('Do weryfikacji')).toBeTruthy()
  })

  it('provides an accessible mode control and validates custom days, fraction, and date', async () => {
    const user = userEvent.setup()
    renderPanel()

    const days20 = screen.getByRole('button', { name: '20 dni' })
    const days26 = screen.getByRole('button', { name: '26 dni' })
    const custom = screen.getByRole('button', { name: 'Własny' })
    expect(days20.getAttribute('aria-pressed')).toBe('false')
    expect(days26.getAttribute('aria-pressed')).toBe('true')
    expect(custom.getAttribute('aria-pressed')).toBe('false')

    await user.click(custom)
    expect(custom.getAttribute('aria-pressed')).toBe('true')

    const customDays = screen.getByLabelText('Własny limit roczny') as HTMLInputElement
    const fraction = screen.getByLabelText('Wymiar etatu') as HTMLInputElement
    const effectiveFrom = screen.getByLabelText('Obowiązuje od') as HTMLInputElement
    const preview = screen.getByRole('button', { name: 'Przelicz' }) as HTMLButtonElement

    await user.clear(customDays)
    await user.type(customDays, '0')
    expect(preview.disabled).toBe(true)

    await user.clear(customDays)
    await user.type(customDays, '21')
    await user.clear(fraction)
    await user.type(fraction, '0')
    expect(preview.disabled).toBe(true)

    await user.clear(fraction)
    await user.type(fraction, '0.8')
    await user.clear(effectiveFrom)
    expect(preview.disabled).toBe(true)

    await user.type(effectiveFrom, '2026-01-01')
    expect(preview.disabled).toBe(false)
    expect(customDays.min).toBe('1')
    expect(customDays.max).toBe('365')
    expect(customDays.step).toBe('1')
    expect(fraction.min).toBe('0.01')
    expect(fraction.max).toBe('1')
    expect(fraction.step).toBe('0.01')
  })

  it('previews an exact 26 to 20 payload, shows -6, and requires a correction reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      calculatedDays: 20,
      currentTotalDays: 26,
      expectedCurrentTotalDays: 26,
      deltaDays: -6,
      requiresCorrection: true,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: '20 dni' }))
    await user.click(screen.getByRole('button', { name: 'Przelicz' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/hr/employees/employee-1/leave-entitlement',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'DAYS_20',
          customAnnualDays: null,
          employmentFraction: 1,
          effectiveFrom: '2026-01-01',
          note: null,
          year: 2026,
          preview: true,
        }),
      }
    )
    expect(await screen.findByText('Roczny wymiar: 20 dni')).toBeTruthy()
    expect(screen.getByText('Aktualne saldo: 26 dni')).toBeTruthy()
    expect(screen.getByText('Zmiana salda: -6 dni')).toBeTruthy()

    const apply = screen.getByRole('button', { name: 'Zastosuj' }) as HTMLButtonElement
    expect(screen.getByLabelText('Powód korekty')).toBeTruthy()
    expect(apply.disabled).toBe(true)
    await user.type(screen.getByLabelText('Powód korekty'), 'ab')
    expect(apply.disabled).toBe(true)
    await user.type(screen.getByLabelText('Powód korekty'), 'c')
    expect(apply.disabled).toBe(false)
  })

  it('applies normalized values with preview token and reason, then refreshes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        calculatedDays: 20,
        currentTotalDays: 26,
        expectedCurrentTotalDays: 26,
        deltaDays: -6,
        requiresCorrection: true,
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'config-new' }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: '20 dni' }))
    await user.click(screen.getByRole('button', { name: 'Przelicz' }))
    await user.type(await screen.findByLabelText('Powód korekty'), 'Zmiana stażu')
    await user.click(screen.getByRole('button', { name: 'Zastosuj' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      mode: 'DAYS_20',
      customAnnualDays: null,
      employmentFraction: 1,
      effectiveFrom: '2026-01-01',
      note: null,
      year: 2026,
      preview: false,
      expectedCurrentTotalDays: 26,
      correctionReason: 'Zmiana stażu',
    })
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce())
    expect(screen.getByText('Zapisano uprawnienie urlopowe.')).toBeTruthy()
  })

  it('applies a missing balance with an expected null token and no reason', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        calculatedDays: 20,
        currentTotalDays: 0,
        expectedCurrentTotalDays: null,
        deltaDays: 20,
        requiresCorrection: false,
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'config-new' }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPanel({
      config: null,
      calculatedDays: null,
      balance: null,
      corrections: [],
      needsReview: true,
    })

    await user.click(screen.getByRole('button', { name: '20 dni' }))
    await user.click(screen.getByRole('button', { name: 'Przelicz' }))
    expect(screen.queryByLabelText('Powód korekty')).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Zastosuj' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const applyBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(applyBody.expectedCurrentTotalDays).toBeNull()
    expect(applyBody).not.toHaveProperty('correctionReason')
  })

  it('invalidates an existing preview after any form field change', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      calculatedDays: 26,
      currentTotalDays: 26,
      expectedCurrentTotalDays: 26,
      deltaDays: 0,
      requiresCorrection: false,
    })))
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Przelicz' }))
    expect(await screen.findByText('Zmiana salda: bez zmian')).toBeTruthy()
    await user.clear(screen.getByLabelText('Wymiar etatu'))
    await user.type(screen.getByLabelText('Wymiar etatu'), '0.8')

    expect(screen.queryByText('Zmiana salda: bez zmian')).toBeNull()
    expect((screen.getByRole('button', { name: 'Zastosuj' }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('ignores an in-flight stale preview and applies the exact second form snapshot', async () => {
    const firstPreview = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstPreview.promise)
      .mockResolvedValueOnce(jsonResponse({
        calculatedDays: 10,
        currentTotalDays: 26,
        expectedCurrentTotalDays: 26,
        deltaDays: -16,
        requiresCorrection: true,
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'config-new' }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Przelicz' }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      mode: 'DAYS_26',
      customAnnualDays: null,
      employmentFraction: 1,
      effectiveFrom: '2026-01-01',
      note: null,
      year: 2026,
      preview: true,
    })

    await user.click(screen.getByRole('button', { name: '20 dni' }))
    await user.clear(screen.getByLabelText('Wymiar etatu'))
    await user.type(screen.getByLabelText('Wymiar etatu'), '0.5')
    await user.clear(screen.getByLabelText('Obowiązuje od'))
    await user.type(screen.getByLabelText('Obowiązuje od'), '2026-02-01')
    await user.type(screen.getByLabelText('Notatka (opcjonalnie)'), 'Nowe warunki')

    await act(async () => {
      firstPreview.resolve(jsonResponse({
        calculatedDays: 26,
        currentTotalDays: 26,
        expectedCurrentTotalDays: 26,
        deltaDays: 0,
        requiresCorrection: false,
      }))
      await firstPreview.promise
    })

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Przelicz' }) as HTMLButtonElement).disabled)
        .toBe(false)
    })
    expect(screen.queryByText('Zmiana salda: bez zmian')).toBeNull()
    expect(screen.queryByLabelText('Powód korekty')).toBeNull()
    expect((screen.getByRole('button', { name: 'Zastosuj' }) as HTMLButtonElement).disabled)
      .toBe(true)

    await user.click(screen.getByRole('button', { name: 'Przelicz' }))
    expect(await screen.findByText('Zmiana salda: -16 dni')).toBeTruthy()
    await user.type(screen.getByLabelText('Powód korekty'), 'Zmiana wymiaru etatu')
    await user.click(screen.getByRole('button', { name: 'Zastosuj' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      mode: 'DAYS_20',
      customAnnualDays: null,
      employmentFraction: 0.5,
      effectiveFrom: '2026-02-01',
      note: 'Nowe warunki',
      year: 2026,
      preview: true,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      mode: 'DAYS_20',
      customAnnualDays: null,
      employmentFraction: 0.5,
      effectiveFrom: '2026-02-01',
      note: 'Nowe warunki',
      year: 2026,
      preview: false,
      expectedCurrentTotalDays: 26,
      correctionReason: 'Zmiana wymiaru etatu',
    })
  })

  it('clears a stale 409 preview and requires recalculation', async () => {
    const preview = {
      calculatedDays: 20,
      currentTotalDays: 26,
      expectedCurrentTotalDays: 26,
      deltaDays: -6,
      requiresCorrection: true,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(preview))
      .mockResolvedValueOnce(jsonResponse({ error: 'Leave balance changed since preview' }, 409))
      .mockResolvedValueOnce(jsonResponse(preview))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: '20 dni' }))
    await user.click(screen.getByRole('button', { name: 'Przelicz' }))
    await user.type(await screen.findByLabelText('Powód korekty'), 'Korekta limitu')
    await user.click(screen.getByRole('button', { name: 'Zastosuj' }))

    expect(await screen.findByText('Saldo zmieniło się od czasu podglądu. Przelicz ponownie.'))
      .toBeTruthy()
    expect(screen.queryByText('Zmiana salda: -6 dni')).toBeNull()
    expect((screen.getByRole('button', { name: 'Zastosuj' }) as HTMLButtonElement).disabled)
      .toBe(true)

    await user.click(screen.getByRole('button', { name: 'Przelicz' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(await screen.findByText('Zmiana salda: -6 dni')).toBeTruthy()
  })

  it('renders correction totals defensively when historical JSON is malformed', () => {
    renderPanel({
      ...configuredData,
      corrections: [
        {
          id: 'correction-1',
          createdAt: '2026-07-20T10:00:00.000Z',
          reason: 'Zmiana stażu',
          beforeJson: JSON.stringify({ totalDays: 26 }),
          afterJson: JSON.stringify({ totalDays: 20 }),
        },
        {
          id: 'correction-2',
          createdAt: '2026-07-19T10:00:00.000Z',
          reason: 'Stary import',
          beforeJson: '{broken',
          afterJson: 'null',
        },
      ],
    })

    expect(screen.getByText('Zmiana stażu')).toBeTruthy()
    expect(screen.getByText('26 → 20 dni')).toBeTruthy()
    expect(screen.getByText('Stary import')).toBeTruthy()
    expect(screen.getByText('— → —')).toBeTruthy()
  })

  it('preserves current usage values and displays negative availability', () => {
    renderPanel({
      ...configuredData,
      balance: {
        ...configuredData.balance!,
        totalDays: 20,
        usedDays: 19,
        pendingDays: 3,
        carriedOver: 2,
      },
    })

    const summary = screen.getByText('Łącznie').closest('dl')!
    expect(within(summary).getByText('20 dni')).toBeTruthy()
    expect(within(summary).getByText('19 dni')).toBeTruthy()
    expect(within(summary).getByText('3 dni')).toBeTruthy()
    expect(within(summary).getByText('2 dni')).toBeTruthy()
    expect(within(summary).getByText('-2 dni')).toBeTruthy()
  })
})
