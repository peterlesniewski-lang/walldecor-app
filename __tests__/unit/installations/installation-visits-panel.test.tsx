import { createElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallationVisitsPanel } from '@/components/installations/installation-visits-panel'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

const scopes = [
  { id: 'scope-salon-tapety', roomName: 'Salon', name: 'Tapety', installerIds: ['installer-anna', 'installer-marek'] },
  { id: 'scope-sypialnia-sztukateria', roomName: 'Sypialnia', name: 'Sztukateria', installerIds: [] },
]

const employees = [
  { id: 'installer-anna', firstName: 'Anna', lastName: 'Montaż', email: '' },
  { id: 'installer-marek', firstName: 'Marek', lastName: 'Montaż', email: 'marek@example.test' },
]

const draftVisit = {
  id: 'visit-draft', orderId: 'order-1', status: 'DRAFT', startsAt: null, endsAt: null,
  timezone: 'Europe/Warsaw', note: null, revision: 1, confirmedAt: null, cancelledAt: null, completedAt: null,
  createdById: 'coordinator-1', createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z',
  scopeIds: [], participants: [],
  syncState: { status: 'NOT_REQUESTED', externalId: null, externalUrl: null, externalEtag: null, lastErrorCode: null, lastErrorMessage: null, lastAttemptAt: null, lastSyncedAt: null },
}

function jsonResponse(value: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => value }
}

describe('InstallationVisitsPanel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    mocks.refresh.mockReset()
  })

  it('creates a draft, progressively reveals its schedule and confirms it in Warsaw time', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(draftVisit))
      .mockResolvedValueOnce(jsonResponse({ ...draftVisit, status: 'CONFIRMED', revision: 2, syncState: { ...draftVisit.syncState, status: 'PENDING' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(createElement(InstallationVisitsPanel, {
      orderId: 'order-1', visits: [], scopes, employees, canEdit: true, canForceOverwrite: false,
    }))

    expect(screen.getByRole('heading', { name: 'Wizyty i terminy' })).toBeTruthy()
    expect(screen.getByText('Termin nieustalony')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Dodaj wizytę' }))
    await user.type(screen.getByLabelText('Początek wizyty'), '2026-09-14T08:00')
    await user.type(screen.getByLabelText('Koniec wizyty'), '2026-09-14T16:00')
    await user.click(screen.getByRole('checkbox', { name: 'Salon — Tapety' }))

    expect(screen.getByText('Instalatorzy dla Salon — Tapety')).toBeTruthy()
    expect(screen.queryByText('Instalatorzy dla Sypialnia — Sztukateria')).toBeNull()
    expect(screen.getByText('Anna Montaż nie ma adresu e-mail — zaproszenie nie zostanie wysłane.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Potwierdź i wyślij zaproszenia' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/installations/order-1/visits', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/installations/order-1/visits/visit-draft', expect.objectContaining({ method: 'PATCH' }))
    expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)).toMatchObject({
      action: 'CONFIRM', expectedRevision: 1, scopeIds: ['scope-salon-tapety'],
      startsAt: '2026-09-14T06:00:00.000Z', endsAt: '2026-09-14T14:00:00.000Z',
    })
    expect(screen.getByText('Oczekuje')).toBeTruthy()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows sync state, calendar link and retry action for a visit needing attention', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...draftVisit, revision: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(InstallationVisitsPanel, {
      orderId: 'order-1', scopes, employees, canEdit: true, canForceOverwrite: false,
      visits: [{
        ...draftVisit, id: 'visit-attention', status: 'CONFIRMED', startsAt: '2026-09-14T06:00:00.000Z', endsAt: '2026-09-14T14:00:00.000Z', scopeIds: ['scope-salon-tapety'],
        syncState: { ...draftVisit.syncState, status: 'ATTENTION', externalUrl: 'https://calendar.google.test/event', lastSyncedAt: '2026-09-14T06:00:00.000Z' },
      }],
    }))

    expect(screen.getByText('Wymaga uwagi')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Wymaga uwagi/ }))
    expect(screen.getByRole('link', { name: 'Otwórz w Google Calendar' }).getAttribute('href')).toBe('https://calendar.google.test/event')
    expect(screen.getByText('Ostatnia synchronizacja: 14.09.2026, 08:00')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Ponów synchronizację' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/installations/order-1/visits/visit-attention/calendar',
      expect.objectContaining({ method: 'POST' }),
    ))
    expect(screen.queryByRole('button', { name: 'Wymuś nadpisanie w Google Calendar' })).toBeNull()
  })

  it('shows force conflict repair only to an administrator or manager', async () => {
    const user = userEvent.setup()
    render(createElement(InstallationVisitsPanel, {
      orderId: 'order-1', scopes, employees, canEdit: true, canForceOverwrite: true,
      visits: [{ ...draftVisit, id: 'visit-conflict', status: 'CONFIRMED', syncState: { ...draftVisit.syncState, status: 'ATTENTION', lastErrorCode: 'CONFLICT' } }],
    }))

    await user.click(screen.getByRole('button', { name: /Wymaga uwagi/ }))
    expect(screen.getByRole('button', { name: 'Wymuś nadpisanie w Google Calendar' })).toBeTruthy()
  })

  it('never renders a legacy Calendar URL for a cancelled visit', async () => {
    const user = userEvent.setup()
    render(createElement(InstallationVisitsPanel, {
      orderId: 'order-1', scopes, employees, canEdit: true, canForceOverwrite: false,
      visits: [{
        ...draftVisit,
        id: 'visit-cancelled-legacy-url',
        status: 'CANCELLED',
        syncState: {
          ...draftVisit.syncState,
          status: 'SYNCED',
          externalUrl: 'https://calendar.google.test/stale-event',
          externalEtag: 'legacy-etag',
        },
      }],
    }))

    await user.click(screen.getByRole('button', { name: /Odwołana/ }))

    expect(screen.queryByRole('link', { name: 'Otwórz w Google Calendar' })).toBeNull()
  })

  it('rebases a changed crew revision without rerendering or losing a dirty visit form', async () => {
    const user = userEvent.setup()
    const confirmed = {
      ...draftVisit,
      id: 'visit-confirmed-after-team-change',
      status: 'CONFIRMED',
      revision: 4,
      startsAt: '2026-09-14T06:00:00.000Z',
      endsAt: '2026-09-14T14:00:00.000Z',
      scopeIds: ['scope-salon-tapety'],
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        scopeId: 'scope-salon-tapety',
        employeeIds: ['installer-anna'],
        visitRevisions: [{ id: confirmed.id, revision: 5 }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        ...confirmed,
        revision: 6,
        startsAt: '2026-09-15T07:30:00.000Z',
        endsAt: '2026-09-15T13:00:00.000Z',
        scopeIds: ['scope-salon-tapety', 'scope-sypialnia-sztukateria'],
      }))
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(InstallationVisitsPanel, {
      orderId: 'order-1', scopes, employees, canEdit: true, canForceOverwrite: false,
      visits: [confirmed],
    }))

    await user.click(screen.getByRole('button', { name: /Potwierdzona/ }))
    const startsAt = screen.getByLabelText('Początek wizyty')
    const endsAt = screen.getByLabelText('Koniec wizyty')
    await user.clear(startsAt)
    await user.type(startsAt, '2026-09-15T09:30')
    await user.clear(endsAt)
    await user.type(endsAt, '2026-09-15T15:00')
    await user.click(screen.getByRole('checkbox', { name: 'Sypialnia — Sztukateria' }))
    await user.click(screen.getByRole('checkbox', { name: 'Marek Montaż dla Salon — Tapety' }))
    await user.click(screen.getByRole('button', { name: 'Zapisz ekipę' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/installations/order-1/scope-assignments/scope-salon-tapety',
      expect.objectContaining({ method: 'PUT' }),
    ))
    const scheduleButton = screen.getByRole('button', { name: 'Zapisz zmianę terminu i wyślij aktualizacje' })
    await waitFor(() => expect(scheduleButton).toHaveProperty('disabled', false))
    expect(startsAt).toHaveProperty('value', '2026-09-15T09:30')
    expect(endsAt).toHaveProperty('value', '2026-09-15T15:00')
    expect(screen.getByRole('checkbox', { name: 'Sypialnia — Sztukateria' })).toHaveProperty('checked', true)
    expect(screen.getByRole('checkbox', { name: 'Anna Montaż dla Salon — Tapety' })).toHaveProperty('disabled', false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).not.toHaveBeenCalled()

    await user.click(scheduleButton)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({
      action: 'CHANGE_SCHEDULE',
      expectedRevision: 5,
      startsAt: '2026-09-15T07:30:00.000Z',
      endsAt: '2026-09-15T13:00:00.000Z',
      note: null,
      scopeIds: ['scope-salon-tapety', 'scope-sypialnia-sztukateria'],
    })
  })

  it('cancels a draft with its current expected revision', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...draftVisit, status: 'CANCELLED', revision: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(InstallationVisitsPanel, {
      orderId: 'order-1', scopes, employees, canEdit: true, canForceOverwrite: false, visits: [draftVisit],
    }))

    await user.click(screen.getByRole('button', { name: 'Odwołaj szkic' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      action: 'CANCEL',
      expectedRevision: 1,
    })
  })

  it('refreshes and explains a 409 revision conflict in Polish', async () => {
    const user = userEvent.setup()
    const confirmed = {
      ...draftVisit,
      id: 'visit-conflict-refresh',
      status: 'CONFIRMED',
      revision: 4,
      startsAt: '2026-09-14T06:00:00.000Z',
      endsAt: '2026-09-14T14:00:00.000Z',
      scopeIds: ['scope-salon-tapety'],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Conflict' }, false, 409)))
    render(createElement(InstallationVisitsPanel, {
      orderId: 'order-1', scopes, employees, canEdit: true, canForceOverwrite: false, visits: [confirmed],
    }))

    await user.click(screen.getByRole('button', { name: /Potwierdzona/ }))
    await user.click(screen.getByRole('button', { name: 'Zapisz zmianę terminu i wyślij aktualizacje' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Dane wizyty lub ekipy zmieniły się. Odświeżamy kartę — spróbuj ponownie za chwilę.')
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('changes a confirmed schedule without exposing or sending SAVE_DRAFT', async () => {
    const user = userEvent.setup()
    const confirmed = {
      ...draftVisit,
      id: 'visit-confirmed',
      status: 'CONFIRMED',
      revision: 4,
      startsAt: '2026-09-14T06:00:00.000Z',
      endsAt: '2026-09-14T14:00:00.000Z',
      scopeIds: ['scope-salon-tapety'],
      syncState: { ...draftVisit.syncState, status: 'SYNCED' },
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...confirmed, revision: 5, syncState: { ...confirmed.syncState, status: 'PENDING' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(InstallationVisitsPanel, {
      orderId: 'order-1', scopes, employees, canEdit: true, canForceOverwrite: false, visits: [confirmed],
    }))

    await user.click(screen.getByRole('button', { name: /Potwierdzona/ }))
    expect(screen.queryByRole('button', { name: 'Zapisz szkic' })).toBeNull()
    await user.clear(screen.getByLabelText('Początek wizyty'))
    await user.type(screen.getByLabelText('Początek wizyty'), '2026-09-15T08:00')
    await user.clear(screen.getByLabelText('Koniec wizyty'))
    await user.type(screen.getByLabelText('Koniec wizyty'), '2026-09-15T16:00')
    await user.click(screen.getByRole('button', { name: 'Zapisz zmianę terminu i wyślij aktualizacje' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body).toMatchObject({
      action: 'CHANGE_SCHEDULE',
      expectedRevision: 4,
      startsAt: '2026-09-15T06:00:00.000Z',
      endsAt: '2026-09-15T14:00:00.000Z',
      scopeIds: ['scope-salon-tapety'],
    })
    expect(body.action).not.toBe('SAVE_DRAFT')
  })
})
