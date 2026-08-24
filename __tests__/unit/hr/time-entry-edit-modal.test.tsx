import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeEntryEditModal } from '@/components/hr/time-tracking/time-entry-edit-modal'

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

function localIso(hour: number, minute = 0) {
  return new Date(2026, 6, 2, hour, minute, 0, 0).toISOString()
}

const firstEntry = {
  id: 'entry-1',
  clockIn: localIso(8),
  clockOut: localIso(16),
  totalMinutes: 480,
  status: 'pending',
}

const baseProps = {
  employeeId: 'employee-1',
  employeeName: 'Anna Kowalska',
  date: '2026-07-02',
  entry: firstEntry,
  userRole: 'ADMIN' as const,
  onClose: vi.fn(),
  onSaved: vi.fn(),
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('TimeEntryEditModal', () => {
  it('exposes a named modal dialog with associated Polish form labels', async () => {
    const hydration = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => hydration.promise))
    render(<TimeEntryEditModal {...baseProps} />)

    const dialog = screen.getByRole('dialog', { name: 'Edytuj wpis' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getByRole('button', { name: 'Zamknij' })).toBeTruthy()
    expect(within(dialog).getByLabelText('Wejście').id).toBe('time-entry-clock-in')
    expect(within(dialog).getByLabelText('Wyjście').id).toBe('time-entry-clock-out')
    expect(within(dialog).getByLabelText('Notatka').id).toBe('time-entry-notes')
    await act(async () => {
      hydration.resolve(jsonResponse({
        clockIn: localIso(8),
        clockOut: localIso(16),
        notes: 'Dyżur',
      }))
    })
    await waitFor(() => {
      expect((within(dialog).getByLabelText('Wejście') as HTMLInputElement).disabled).toBe(false)
    })
  })

  it('gates controls and ignores late hydration from a superseded entry', async () => {
    const firstHydration = deferred<Response>()
    const secondHydration = deferred<Response>()
    const fetchMock = vi.fn((input: string | URL | Request) => (
      String(input).endsWith('/entry-2') ? secondHydration.promise : firstHydration.promise
    ))
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(<TimeEntryEditModal {...baseProps} />)

    expect((screen.getByLabelText('Wejście') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Zapisz' }) as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    const secondEntry = {
      ...firstEntry,
      id: 'entry-2',
      clockIn: localIso(9),
      clockOut: localIso(17),
    }
    rerender(<TimeEntryEditModal {...baseProps} entry={secondEntry} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect((fetchMock.mock.calls[0][1] as RequestInit | undefined)?.signal?.aborted).toBe(true)

    await act(async () => {
      secondHydration.resolve(jsonResponse({
        clockIn: localIso(9),
        clockOut: localIso(17),
        notes: 'Nowy wpis',
      }))
    })
    const clockIn = screen.getByLabelText('Wejście') as HTMLInputElement
    await waitFor(() => {
      expect(clockIn.disabled).toBe(false)
      expect(clockIn.value).toBe('09:00')
    })

    fireEvent.change(clockIn, { target: { value: '10:30' } })
    expect(clockIn.value).toBe('10:30')

    await act(async () => {
      firstHydration.resolve(jsonResponse({
        clockIn: localIso(6),
        clockOut: localIso(14),
        notes: 'Stary wpis',
      }))
    })
    expect(clockIn.value).toBe('10:30')
    expect((screen.getByLabelText('Notatka') as HTMLTextAreaElement).value).toBe('Nowy wpis')
  })

  it('aborts pending detail hydration on unmount', async () => {
    const pending = deferred<Response>()
    const fetchMock = vi.fn(() => pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(<TimeEntryEditModal {...baseProps} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const signal = (fetchMock.mock.calls[0][1] as RequestInit | undefined)?.signal

    unmount()

    expect(signal?.aborted).toBe(true)
  })

  it('closes on Escape and restores focus to the opener', async () => {
    function ModalHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Otwórz edycję</button>
          {open && (
            <TimeEntryEditModal
              {...baseProps}
              entry={null}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      )
    }

    const user = userEvent.setup()
    render(<ModalHarness />)
    const opener = screen.getByRole('button', { name: 'Otwórz edycję' })
    await user.click(opener)
    expect(screen.getByRole('dialog', { name: 'Dodaj wpis' })).toBeTruthy()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('blocks every dismissal path during a pending save and keeps a failed mutation visible', async () => {
    const patch = deferred<Response>()
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (init?.method === 'PATCH') return patch.promise
      return Promise.resolve(jsonResponse({
        clockIn: localIso(8),
        clockOut: localIso(16),
        notes: 'Dyżur',
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    function ModalHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Otwórz edycję</button>
          {open && (
            <TimeEntryEditModal
              {...baseProps}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      )
    }

    const user = userEvent.setup()
    render(<ModalHarness />)
    const opener = screen.getByRole('button', { name: 'Otwórz edycję' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Edytuj wpis' })
    await waitFor(() => {
      expect((within(dialog).getByRole('button', { name: 'Zapisz' }) as HTMLButtonElement).disabled)
        .toBe(false)
    })

    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true)
    })

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Edytuj wpis' })).toBe(dialog)

    await user.click(within(dialog).getByRole('button', { name: 'Zamknij' }))
    expect(screen.getByRole('dialog', { name: 'Edytuj wpis' })).toBe(dialog)

    const overlay = dialog.previousElementSibling
    expect(overlay).not.toBeNull()
    fireEvent.pointerDown(overlay as Element)
    fireEvent.click(overlay as Element)
    expect(screen.getByRole('dialog', { name: 'Edytuj wpis' })).toBe(dialog)

    await act(async () => {
      patch.resolve(jsonResponse({ error: 'Nie można zapisać wpisu' }, 500))
    })
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Nie można zapisać wpisu'
    )

    const focusSpy = vi.spyOn(opener, 'focus')
    await user.click(within(dialog).getByRole('button', { name: 'Zamknij' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(focusSpy).toHaveBeenCalledTimes(1))
    expect(document.activeElement).toBe(opener)
  })

  it.each([
    ['save', 'Zapisz', 'PATCH', '/api/hr/time-tracking/entry-1'],
    ['delete', 'Usuń wpis', 'DELETE', '/api/hr/time-tracking/entry-1'],
    ['approve', 'Zatwierdź', 'PATCH', '/api/hr/time-tracking/entry-1/approve'],
    ['reject', 'Odrzuć', 'PATCH', '/api/hr/time-tracking/entry-1/reject'],
  ])('keeps %s pending until the async refresh completes', async (
    _operation,
    buttonName,
    method,
    endpoint
  ) => {
    const refresh = deferred<void>()
    const onClose = vi.fn()
    const onSaved = vi.fn(() => refresh.promise)
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (init?.method) return Promise.resolve(jsonResponse({ ok: true }))
      return Promise.resolve(jsonResponse({
        clockIn: localIso(8),
        clockOut: localIso(16),
        notes: 'Dyżur',
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    const user = userEvent.setup()
    render(
      <TimeEntryEditModal
        {...baseProps}
        onClose={onClose}
        onSaved={onSaved}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'Edytuj wpis' })
    await waitFor(() => {
      expect((within(dialog).getByRole('button', { name: buttonName }) as HTMLButtonElement).disabled)
        .toBe(false)
    })
    await user.click(within(dialog).getByRole('button', { name: buttonName }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) => (
        String(input) === endpoint && init?.method === method
      ))).toBe(true)
      expect(onSaved).toHaveBeenCalledOnce()
    })
    expect(onClose).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Edytuj wpis' })).toBe(dialog)

    await act(async () => {
      refresh.resolve()
      await refresh.promise
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it.each([
    ['save', 'Zapisz', 'PATCH', '/api/hr/time-tracking/entry-1'],
    ['delete', 'Usuń wpis', 'DELETE', '/api/hr/time-tracking/entry-1'],
  ])('retries only refresh after a failed post-%s refresh', async (
    _operation,
    buttonName,
    method,
    endpoint
  ) => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce(undefined)
    const fetchMock = vi.fn((
      _input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (init?.method) return Promise.resolve(jsonResponse({ ok: true }))
      return Promise.resolve(jsonResponse({
        clockIn: localIso(8),
        clockOut: localIso(16),
        notes: 'Dyżur',
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    const user = userEvent.setup()
    render(
      <TimeEntryEditModal
        {...baseProps}
        onClose={onClose}
        onSaved={onSaved}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'Edytuj wpis' })
    await waitFor(() => {
      expect((within(dialog).getByRole('button', { name: buttonName }) as HTMLButtonElement).disabled)
        .toBe(false)
    })
    await user.click(within(dialog).getByRole('button', { name: buttonName }))

    const recoveryAlert = await within(dialog).findByRole('alert')
    expect(within(recoveryAlert).getByText(
      'Zmiana została zapisana, ale nie udało się odświeżyć widoku.'
    ).textContent).toBe(
      'Zmiana została zapisana, ale nie udało się odświeżyć widoku.'
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledOnce()
    for (const mutationName of ['Usuń wpis', 'Odrzuć', 'Zatwierdź', 'Zapisz']) {
      expect((within(dialog).getByRole('button', {
        name: mutationName,
      }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === endpoint && init?.method === method
    ))).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', {
      name: 'Ponów odświeżenie',
    }))

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2)
      expect(onClose).toHaveBeenCalledOnce()
    })
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === endpoint && init?.method === method
    ))).toHaveLength(1)
  })

  it('blocks passive dismissal in recovery but allows the explicit close control', async () => {
    const onClose = vi.fn()
    vi.stubGlobal('fetch', vi.fn((
      _input: string | URL | Request,
      init?: RequestInit
    ) => Promise.resolve(init?.method
      ? jsonResponse({ ok: true })
      : jsonResponse({
          clockIn: localIso(8),
          clockOut: localIso(16),
          notes: 'Dyżur',
        }))))
    const user = userEvent.setup()
    render(
      <TimeEntryEditModal
        {...baseProps}
        onClose={onClose}
        onSaved={vi.fn().mockRejectedValue(new Error('refresh failed'))}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'Edytuj wpis' })
    await waitFor(() => {
      expect((within(dialog).getByRole('button', { name: 'Zapisz' }) as HTMLButtonElement).disabled)
        .toBe(false)
    })
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }))
    await within(dialog).findByRole('button', { name: 'Ponów odświeżenie' })

    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()

    const overlay = dialog.previousElementSibling
    fireEvent.pointerDown(overlay as Element)
    fireEvent.click(overlay as Element)
    expect(onClose).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Zamknij' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
