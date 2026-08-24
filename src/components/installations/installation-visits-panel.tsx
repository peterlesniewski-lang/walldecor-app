'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { CalendarDays, CheckCircle2, ChevronDown, ExternalLink, LoaderCircle, Plus, RotateCw, Save, UsersRound, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { InstallationEmployeeOption } from './order-form'
import { InstallationCalendarStatus } from './installation-calendar-status'
import { formatWarsawDateTime, formatWarsawDateTimeInput, parseWarsawLocalDateTime } from '@/lib/installations/visit-time'

export type InstallationVisitValue = {
  id: string
  orderId: string
  status: string
  startsAt: Date | string | null
  endsAt: Date | string | null
  timezone: string
  note?: string | null
  revision: number
  scopeIds: string[]
  participants: Array<{
    employeeId: string
    name: string
    scopeIds: string[]
    inviteStatus: 'READY' | 'MISSING_EMAIL'
  }>
  syncState: {
    status: string
    externalUrl?: string | null
    lastErrorCode?: string | null
    lastErrorMessage?: string | null
    lastSyncedAt?: Date | string | null
  }
}

type VisitForm = {
  startsAt: string
  endsAt: string
  note: string
  scopeIds: string[]
}

type InstallationScopeOption = {
  id: string
  roomName: string
  name: string
  installerIds: string[]
}

type InstallerOption = InstallationEmployeeOption & { email?: string | null }

export type InstallationVisitsPanelProps = {
  orderId: string
  visits: InstallationVisitValue[]
  scopes: InstallationScopeOption[]
  employees: InstallerOption[]
  canEdit: boolean
  canForceOverwrite: boolean
}

const visitStatusLabel: Record<string, string> = {
  DRAFT: 'Szkic',
  CONFIRMED: 'Potwierdzona',
  CANCELLED: 'Odwołana',
  COMPLETED: 'Zakończona',
}

function scopeLabel(scope: InstallationScopeOption) { return `${scope.roomName} — ${scope.name}` }

function formForVisit(visit: InstallationVisitValue): VisitForm {
  return {
    startsAt: visit.startsAt ? formatWarsawDateTimeInput(visit.startsAt) : '',
    endsAt: visit.endsAt ? formatWarsawDateTimeInput(visit.endsAt) : '',
    note: visit.note ?? '',
    scopeIds: [...visit.scopeIds],
  }
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index])
}

function visitCrewSnapshot(visits: InstallationVisitValue[], scopes: InstallationScopeOption[]) {
  return JSON.stringify({
    visits: visits.map((visit) => ({ id: visit.id, revision: visit.revision })).sort((left, right) => left.id.localeCompare(right.id)),
    scopes: scopes.map((scope) => ({ id: scope.id, installerIds: [...scope.installerIds].sort() })).sort((left, right) => left.id.localeCompare(right.id)),
  })
}

async function responsePayload(response: Response) {
  try { return await response.json() as { error?: string; fieldErrors?: Record<string, string> } }
  catch { return {} }
}

function errorMessage(payload: { error?: string; fieldErrors?: Record<string, string> }, fallback: string) {
  return payload.fieldErrors?.startsAt ?? payload.fieldErrors?.endsAt ?? payload.fieldErrors?.scopeIds ?? payload.fieldErrors?.form ?? payload.error ?? fallback
}

export function InstallationVisitsPanel({ orderId, visits, scopes, employees, canEdit, canForceOverwrite }: InstallationVisitsPanelProps) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const [localVisits, setLocalVisits] = useState(visits)
  const [forms, setForms] = useState<Record<string, VisitForm>>(() => Object.fromEntries(visits.map((visit) => [visit.id, formForVisit(visit)])))
  const [scopeTeams, setScopeTeams] = useState<Record<string, string[]>>(() => Object.fromEntries(scopes.map((scope) => [scope.id, scope.installerIds])))
  const [persistedScopeTeams, setPersistedScopeTeams] = useState<Record<string, string[]>>(() => Object.fromEntries(scopes.map((scope) => [scope.id, scope.installerIds])))
  const [expandedVisitId, setExpandedVisitId] = useState<string | null>(visits.find((visit) => visit.status === 'DRAFT')?.id ?? null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [crewRefreshSnapshot, setCrewRefreshSnapshot] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const propsSnapshot = useMemo(() => visitCrewSnapshot(visits, scopes), [visits, scopes])

  useEffect(() => {
    setLocalVisits(visits)
    setForms(Object.fromEntries(visits.map((visit) => [visit.id, formForVisit(visit)])))
  }, [visits])

  useEffect(() => {
    const teams = Object.fromEntries(scopes.map((scope) => [scope.id, scope.installerIds]))
    setScopeTeams(teams)
    setPersistedScopeTeams(teams)
  }, [scopes])

  useEffect(() => {
    if (crewRefreshSnapshot !== null && crewRefreshSnapshot !== propsSnapshot) setCrewRefreshSnapshot(null)
  }, [crewRefreshSnapshot, propsSnapshot])

  const scopesById = useMemo(() => new Map(scopes.map((scope) => [scope.id, scope])), [scopes])
  const employeesById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees])
  const controlsLocked = pendingAction !== null || isRefreshing || crewRefreshSnapshot !== null

  function refreshCard() {
    startRefresh(() => router.refresh())
  }

  function setForm(visitId: string, patch: Partial<VisitForm>) {
    setForms((current) => ({ ...current, [visitId]: { ...current[visitId], ...patch } }))
  }

  function replaceVisit(updated: InstallationVisitValue) {
    setLocalVisits((current) => current.map((visit) => visit.id === updated.id ? updated : visit))
    setForms((current) => ({ ...current, [updated.id]: formForVisit(updated) }))
  }

  async function request<T>(action: string, url: string, init: RequestInit, successMessage: string): Promise<T | null> {
    setPendingAction(action)
    setError('')
    setMessage(`Trwa: ${successMessage.toLocaleLowerCase('pl-PL')}`)
    try {
      const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
      const payload = await responsePayload(response)
      if (!response.ok) {
        if (response.status === 409) {
          setError('Dane wizyty lub ekipy zmieniły się. Odświeżamy kartę — spróbuj ponownie za chwilę.')
          refreshCard()
        } else {
          setError(errorMessage(payload, 'Nie udało się zapisać wizyty. Spróbuj ponownie.'))
        }
        setMessage('')
        return null
      }
      setMessage(successMessage)
      refreshCard()
      return payload as T
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.')
      setMessage('')
      return null
    } finally {
      setPendingAction(null)
    }
  }

  async function addVisit() {
    const created = await request<InstallationVisitValue>(
      'add',
      `/api/installations/${orderId}/visits`,
      { method: 'POST', body: JSON.stringify({ scopeIds: [] }) },
      'Dodano szkic wizyty.',
    )
    if (!created) return
    setLocalVisits((current) => [...current, created])
    setForms((current) => ({ ...current, [created.id]: formForVisit(created) }))
    setExpandedVisitId(created.id)
  }

  async function saveScopeTeam(scope: InstallationScopeOption) {
    const employeeIds = scopeTeams[scope.id] ?? []
    const previousEmployeeIds = persistedScopeTeams[scope.id] ?? []
    const changed = !sameIds(employeeIds, previousEmployeeIds)
    if (changed) setCrewRefreshSnapshot(propsSnapshot)
    const saved = await request<{ employeeIds: string[] }>(
      `scope:${scope.id}`,
      `/api/installations/${orderId}/scope-assignments/${scope.id}`,
      { method: 'PUT', body: JSON.stringify({ employeeIds }) },
      `Zapisano ekipę dla ${scopeLabel(scope)}.`,
    )
    if (saved) {
      setScopeTeams((current) => ({ ...current, [scope.id]: saved.employeeIds }))
      setPersistedScopeTeams((current) => ({ ...current, [scope.id]: saved.employeeIds }))
      if (sameIds(saved.employeeIds, previousEmployeeIds)) setCrewRefreshSnapshot(null)
    } else {
      setCrewRefreshSnapshot(null)
    }
  }

  function datesFromForm(form: VisitForm) {
    if (!form.startsAt || !form.endsAt) {
      setError('Podaj początek i koniec wizyty.')
      return null
    }
    try {
      return {
        startsAt: parseWarsawLocalDateTime(form.startsAt, 'startsAt').toISOString(),
        endsAt: parseWarsawLocalDateTime(form.endsAt, 'endsAt').toISOString(),
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Podaj poprawny termin wizyty.')
      return null
    }
  }

  function hasUnsavedScopeTeams(form: VisitForm) {
    return form.scopeIds.some((scopeId) => {
      const scope = scopesById.get(scopeId)
      return scope ? !sameIds(scopeTeams[scopeId] ?? [], persistedScopeTeams[scopeId] ?? []) : false
    })
  }

  async function saveVisit(visit: InstallationVisitValue, action: 'SAVE_DRAFT' | 'CONFIRM' | 'CHANGE_SCHEDULE') {
    const form = forms[visit.id]
    if (!form) return
    const requiresSchedule = action !== 'SAVE_DRAFT'
    if (requiresSchedule && hasUnsavedScopeTeams(form)) {
      setError('Najpierw zapisz zmienioną ekipę dla wybranych zakresów.')
      return
    }
    const dates = requiresSchedule ? datesFromForm(form) : (() => {
      if (!form.startsAt && !form.endsAt) return { startsAt: null, endsAt: null }
      return datesFromForm(form)
    })()
    if (!dates) return

    const updated = await request<InstallationVisitValue>(
      `${action === 'SAVE_DRAFT' ? 'draft' : action === 'CONFIRM' ? 'confirm' : 'schedule'}:${visit.id}`,
      `/api/installations/${orderId}/visits/${visit.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          expectedRevision: visit.revision,
          ...dates,
          scopeIds: form.scopeIds,
          note: form.note.trim() || null,
        }),
      },
      action === 'SAVE_DRAFT'
        ? 'Zapisano szkic wizyty.'
        : action === 'CONFIRM'
          ? 'Wizyta została potwierdzona. Zaproszenia oczekują na wysyłkę.'
          : 'Zapisano zmianę terminu. Aktualizacje oczekują na wysyłkę.',
    )
    if (updated) replaceVisit(updated)
  }

  async function visitAction(visit: InstallationVisitValue, action: 'CANCEL' | 'COMPLETE') {
    const updated = await request<InstallationVisitValue>(
      `${action.toLowerCase()}:${visit.id}`,
      `/api/installations/${orderId}/visits/${visit.id}`,
      { method: 'PATCH', body: JSON.stringify({ action, expectedRevision: visit.revision }) },
      action === 'CANCEL' ? 'Wizyta została odwołana.' : 'Wizyta została oznaczona jako zakończona.',
    )
    if (updated) replaceVisit(updated)
  }

  async function requeueCalendar(visit: InstallationVisitValue, forceOverwrite: boolean) {
    const updated = await request<InstallationVisitValue>(
      `${forceOverwrite ? 'force' : 'retry'}:${visit.id}`,
      `/api/installations/${orderId}/visits/${visit.id}/calendar`,
      { method: 'POST', body: JSON.stringify({ forceOverwrite }) },
      forceOverwrite ? 'Dodano wymuszoną synchronizację.' : 'Dodano synchronizację do kolejki.',
    )
    if (updated) replaceVisit(updated)
  }

  function toggleScope(visitId: string, scopeId: string) {
    const form = forms[visitId]
    if (!form) return
    setForm(visitId, { scopeIds: form.scopeIds.includes(scopeId) ? form.scopeIds.filter((id) => id !== scopeId) : [...form.scopeIds, scopeId] })
  }

  function toggleInstaller(scopeId: string, employeeId: string) {
    setScopeTeams((current) => {
      const selected = current[scopeId] ?? []
      return { ...current, [scopeId]: selected.includes(employeeId) ? selected.filter((id) => id !== employeeId) : [...selected, employeeId] }
    })
  }

  return <section className="mt-6 rounded-2xl border p-5 sm:p-6" aria-labelledby="installation-visits-heading" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="data-label" style={{ color: '#8C5718' }}>Plan pracy</p>
        <h2 id="installation-visits-heading" className="mt-1 text-xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>Wizyty i terminy</h2>
        <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--wd-text-muted)' }}>Najpierw wybierz zakres i termin. Instalatorzy pojawiają się tylko przy wybranych zakresach.</p>
      </div>
      {canEdit && <Button type="button" onClick={() => void addVisit()} disabled={controlsLocked}><Plus /> {pendingAction === 'add' ? 'Dodawanie…' : 'Dodaj wizytę'}</Button>}
    </div>

    {message && <p className="mt-4 text-sm font-medium" role="status" aria-live="polite" style={{ color: '#356B43' }}>{message}</p>}
    {error && <p className="mt-4 text-sm font-medium text-red-700" role="alert">{error}</p>}
    {crewRefreshSnapshot && <p className="mt-4 text-sm" role="status" style={{ color: 'var(--wd-text-muted)' }}>Odświeżamy rewizje wizyt po zmianie ekipy…</p>}

    {localVisits.length === 0 ? <div className="mt-5 rounded-xl border border-dashed p-4 text-sm" style={{ borderColor: 'rgba(30, 30, 30, 0.18)', color: 'var(--wd-text-muted)' }}><CalendarDays className="mb-2 h-5 w-5" aria-hidden="true" />Termin nieustalony</div> : <div className="mt-5 space-y-3">
      {localVisits.map((visit) => {
        const form = forms[visit.id] ?? formForVisit(visit)
        const expanded = expandedVisitId === visit.id
        const editable = canEdit && (visit.status === 'DRAFT' || visit.status === 'CONFIRMED')
        const selectedScopes = form.scopeIds.map((scopeId) => scopesById.get(scopeId)).filter((scope): scope is InstallationScopeOption => Boolean(scope))
        const selectedInstallers = selectedScopes
          .flatMap((scope) => (scopeTeams[scope.id] ?? []).map((employeeId) => employeesById.get(employeeId)))
          .filter((employee): employee is InstallerOption => employee !== undefined)
        const missingEmailEmployees = [...new Map(
          selectedInstallers.filter((employee) => !employee.email?.trim()).map((employee) => [employee.id, employee]),
        ).values()]
        const visitTitle = visit.startsAt && visit.endsAt ? `${formatWarsawDateTime(visit.startsAt)}–${formatWarsawDateTime(visit.endsAt).slice(-5)}` : 'Termin nieustalony'
        const actionBusy = (name: string) => pendingAction === `${name}:${visit.id}`

        return <article key={visit.id} className="overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(30, 30, 30, 0.12)' }}>
          <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left" aria-expanded={expanded} onClick={() => setExpandedVisitId((current) => current === visit.id ? null : visit.id)}>
            <span className="min-w-0">
              <span className="block truncate text-sm font-extrabold" style={{ color: 'var(--wd-dark)' }}>{visitTitle}</span>
              <span className="mt-1 block text-xs" style={{ color: 'var(--wd-text-muted)' }}>{visitStatusLabel[visit.status] ?? visit.status} · {visit.scopeIds.length ? `${visit.scopeIds.length} zakres${visit.scopeIds.length === 1 ? '' : 'y'}` : 'bez zakresu'}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2"><InstallationCalendarStatus syncState={visit.syncState} /><ChevronDown className={`h-4 w-4 transition ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" /></span>
          </button>

          {expanded && <div className="border-t p-4" style={{ borderColor: 'rgba(30, 30, 30, 0.12)', background: 'rgba(251, 249, 245, 0.55)' }}>
            {editable ? <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label htmlFor={`visit-start-${visit.id}`}>Początek wizyty</Label><Input id={`visit-start-${visit.id}`} aria-label="Początek wizyty" type="datetime-local" value={form.startsAt} disabled={controlsLocked} onChange={(event) => setForm(visit.id, { startsAt: event.target.value })} /></div>
                <div><Label htmlFor={`visit-end-${visit.id}`}>Koniec wizyty</Label><Input id={`visit-end-${visit.id}`} aria-label="Koniec wizyty" type="datetime-local" value={form.endsAt} disabled={controlsLocked} onChange={(event) => setForm(visit.id, { endsAt: event.target.value })} /></div>
              </div>
              <fieldset className="mt-5" disabled={controlsLocked}><legend className="text-sm font-bold" style={{ color: 'var(--wd-dark)' }}>Zakres tej wizyty</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">
                {scopes.map((scope) => <label key={scope.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" style={{ background: 'var(--wd-white)', borderColor: form.scopeIds.includes(scope.id) ? '#B5741D' : 'rgba(30, 30, 30, 0.12)' }}>
                  <input type="checkbox" checked={form.scopeIds.includes(scope.id)} onChange={() => toggleScope(visit.id, scope.id)} aria-label={scopeLabel(scope)} className="mt-0.5 h-4 w-4 accent-amber-700" />
                  <span><strong>{scopeLabel(scope)}</strong></span>
                </label>)}
              </div></fieldset>

              {selectedScopes.map((scope) => {
                const installerIds = scopeTeams[scope.id] ?? []
                const changed = !sameIds(installerIds, persistedScopeTeams[scope.id] ?? [])
                return <div key={scope.id} className="mt-4 rounded-xl border p-4" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--wd-dark)' }}><UsersRound className="h-4 w-4" style={{ color: '#8C5718' }} /> Instalatorzy dla {scopeLabel(scope)}</p>{changed && <Button type="button" size="sm" variant="outline" onClick={() => void saveScopeTeam(scope)} disabled={controlsLocked}><Save /> {pendingAction === `scope:${scope.id}` ? 'Zapisywanie…' : 'Zapisz ekipę'}</Button>}</div>
                  <div className="mt-3 flex flex-wrap gap-2">{employees.map((employee) => <label key={employee.id} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: installerIds.includes(employee.id) ? '#B5741D' : 'rgba(30, 30, 30, 0.12)', background: installerIds.includes(employee.id) ? '#FFF6E8' : 'var(--wd-white)' }}>
                    <input type="checkbox" checked={installerIds.includes(employee.id)} disabled={controlsLocked} onChange={() => toggleInstaller(scope.id, employee.id)} aria-label={`${employee.firstName} ${employee.lastName} dla ${scopeLabel(scope)}`} className="h-4 w-4 accent-amber-700" />
                    {employee.firstName} {employee.lastName}{employee.email?.trim() ? '' : ' · brak e-maila'}
                  </label>)}</div>
                </div>
              })}
              {missingEmailEmployees.map((employee) => <p key={employee.id} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{employee.firstName} {employee.lastName} nie ma adresu e-mail — zaproszenie nie zostanie wysłane.</p>)}
              {hasUnsavedScopeTeams(form) && <p className="mt-3 text-sm text-amber-900">Zapisz zmienioną ekipę dla wybranych zakresów przed potwierdzeniem wizyty.</p>}
              <div className="mt-5 flex flex-wrap gap-2">
                {visit.status === 'DRAFT' ? <>
                  <Button type="button" variant="outline" onClick={() => void saveVisit(visit, 'SAVE_DRAFT')} disabled={controlsLocked}><Save /> {actionBusy('draft') ? 'Zapisywanie…' : 'Zapisz szkic'}</Button>
                  <Button type="button" onClick={() => void saveVisit(visit, 'CONFIRM')} disabled={controlsLocked || hasUnsavedScopeTeams(form)}><CheckCircle2 /> {actionBusy('confirm') ? 'Potwierdzanie…' : 'Potwierdź i wyślij zaproszenia'}</Button>
                  <Button type="button" variant="outline" className="border-red-200 text-red-800" onClick={() => void visitAction(visit, 'CANCEL')} disabled={controlsLocked}><XCircle /> {actionBusy('cancel') ? 'Odwoływanie…' : 'Odwołaj szkic'}</Button>
                </> : <Button type="button" onClick={() => void saveVisit(visit, 'CHANGE_SCHEDULE')} disabled={controlsLocked || hasUnsavedScopeTeams(form)}><Save /> {actionBusy('schedule') ? 'Zapisywanie…' : 'Zapisz zmianę terminu i wyślij aktualizacje'}</Button>}
              </div>
            </> : <div className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
              <p>{visit.startsAt && visit.endsAt ? `${formatWarsawDateTime(visit.startsAt)} – ${formatWarsawDateTime(visit.endsAt)}` : 'Termin nieustalony'}</p>
              <p className="mt-2">Zakresy: {visit.scopeIds.length ? visit.scopeIds.map((scopeId) => scopesById.get(scopeId)).filter(Boolean).map((scope) => scopeLabel(scope as InstallationScopeOption)).join(', ') : 'brak'}</p>
              {visit.participants.length > 0 && <p className="mt-2">Ekipa: {visit.participants.map((participant) => participant.name).join(', ')}</p>}
            </div>}

            {visit.syncState.externalUrl && <a href={visit.syncState.externalUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4" style={{ color: '#8C5718' }}><ExternalLink className="h-4 w-4" /> Otwórz w Google Calendar</a>}
            {visit.syncState.lastSyncedAt && <p className="mt-3 text-xs" style={{ color: 'var(--wd-text-muted)' }}>Ostatnia synchronizacja: {formatWarsawDateTime(visit.syncState.lastSyncedAt)}</p>}
            {visit.syncState.status === 'ATTENTION' && canEdit && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{visit.syncState.lastErrorMessage ?? 'Synchronizacja wymaga ponowienia.'}<div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => void requeueCalendar(visit, false)} disabled={controlsLocked}><RotateCw /> {actionBusy('retry') ? 'Dodawanie…' : 'Ponów synchronizację'}</Button>{canForceOverwrite && visit.syncState.lastErrorCode === 'CONFLICT' && <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" onClick={() => void requeueCalendar(visit, true)} disabled={controlsLocked}><XCircle /> {actionBusy('force') ? 'Dodawanie…' : 'Wymuś nadpisanie w Google Calendar'}</Button>}</div></div>}
            {canEdit && visit.status === 'CONFIRMED' && <div className="mt-5 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => void visitAction(visit, 'COMPLETE')} disabled={controlsLocked}><CheckCircle2 /> {actionBusy('complete') ? 'Zapisywanie…' : 'Oznacz jako zakończoną'}</Button><Button type="button" variant="outline" className="border-red-200 text-red-800" onClick={() => void visitAction(visit, 'CANCEL')} disabled={controlsLocked}><XCircle /> {actionBusy('cancel') ? 'Odwoływanie…' : 'Odwołaj wizytę'}</Button></div>}
          </div>}
        </article>
      })}
    </div>}
    {pendingAction && !message && <p className="mt-4 text-sm" role="status"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />Trwa zapisywanie…</p>}
  </section>
}
