'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArrowLeft, BookOpen, MapPin, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InstallationOrderForm, type InstallationEmployeeOption, type InstallationOrderFormValue } from './order-form'
import { RoomScopeEditor } from './room-scope-editor'
import { InstallationFormSnapshotPanel } from './form-snapshot-panel'
import { ClientLinkPanel, type InstallationClientLinkStatus } from './client-link-panel'
import { InstallationClarificationPanel, type InstallationClarificationView } from './installation-clarification-panel'
import { InstallationFormRevisionPanel } from './form-revision-panel'
import { OwnershipPanel } from './ownership-panel'
import { VisitFeePanel } from './visit-fee-panel'
import { InstallationFilesPanel } from './installation-files-panel'
import { InstallationVisitsPanel, type InstallationVisitValue } from './installation-visits-panel'
import { InstallerProtocolPanel, type AcceptanceCandidate } from './installer-protocol-panel'
import type { ScopeAssignmentView } from '@/lib/installations/scope-assignment-service'
import type { InstallerInstallationOrderView } from '@/lib/installations/order-presenter'
import { formatWarsawDateTime } from '@/lib/installations/visit-time'

type CoordinatorInstallationOrderDetailValue = InstallationOrderFormValue & {
  number: string
  status: string
  archivedAt: Date | string | null
  primaryEmployee: { firstName: string; lastName: string }
  backupEmployee: { firstName: string; lastName: string }
}

type InstallationOrderDetailValue = CoordinatorInstallationOrderDetailValue | InstallerInstallationOrderView
const emptyRooms: NonNullable<Parameters<typeof RoomScopeEditor>[0]['initialRooms']> = []
const emptyLinks: InstallationClientLinkStatus[] = []
const emptyClarifications: InstallationClarificationView[] = []

function isCoordinatorOrder(order: InstallationOrderDetailValue): order is CoordinatorInstallationOrderDetailValue {
  return 'email' in order.client && 'phone' in order.client && 'primaryEmployeeId' in order && 'backupEmployeeId' in order
}

export function InstallationOrderDetail({
  order,
  employees,
  canEdit = false,
  canArchive = false,
  rooms = emptyRooms,
  catalog = [],
  publishedTemplates = [],
  formSnapshot = null,
  clientLinks = emptyLinks,
  clarifications = emptyClarifications,
  readiness = { isReady: false, openBlockingCount: 0, submittedCount: 0 },
  formRevisions = [],
  ownership = null,
  visitFee = null,
  canManageGovernance = false,
  files = [],
  mismatches = [],
  visits = [],
  scopeAssignments = [],
  acceptanceCandidates = [],
}: {
  order: InstallationOrderDetailValue
  employees: InstallationEmployeeOption[]
  canEdit?: boolean
  canArchive?: boolean
  rooms?: Parameters<typeof RoomScopeEditor>[0]['initialRooms']
  catalog?: Parameters<typeof RoomScopeEditor>[0]['catalog']
  publishedTemplates?: Parameters<typeof InstallationFormSnapshotPanel>[0]['publishedTemplates']
  formSnapshot?: Parameters<typeof InstallationFormSnapshotPanel>[0]['initialSnapshot']
  clientLinks?: InstallationClientLinkStatus[]
  clarifications?: InstallationClarificationView[]
  readiness?: { isReady: boolean; openBlockingCount: number; submittedCount: number; visitFeeAcceptanceRequired?: boolean }
  formRevisions?: Parameters<typeof InstallationFormRevisionPanel>[0]['revisions']
  ownership?: Awaited<ReturnType<typeof import('@/lib/installations/delegation-service').getInstallationOwnershipView>> | null
  visitFee?: Awaited<ReturnType<typeof import('@/lib/installations/delegation-service').getInstallationVisitFeeView>> | null
  canManageGovernance?: boolean
  files?: Parameters<typeof InstallationFilesPanel>[0]['initialFiles']
  mismatches?: Parameters<typeof InstallationFilesPanel>[0]['mismatches']
  visits?: InstallationVisitValue[]
  scopeAssignments?: ScopeAssignmentView[]
  acceptanceCandidates?: AcceptanceCandidate[]
}) {
  const router = useRouter()
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState('')
  const [editingContact, setEditingContact] = useState(false)
  const [selectedSnapshot, setSelectedSnapshot] = useState(formSnapshot)
  const [cardRooms, setCardRooms] = useState(rooms)
  useEffect(() => { setSelectedSnapshot(formSnapshot) }, [formSnapshot])
  useEffect(() => { setCardRooms(rooms) }, [rooms])
  useEffect(() => {
    const refresh = () => router.refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [router])
  function revealSection(hash: string) {
    const target = document.getElementById(hash.slice(1))
    if (!target) return
    let element: HTMLElement | null = target
    while (element) {
      if (element instanceof HTMLDetailsElement) element.open = true
      element = element.parentElement
    }
    target.scrollIntoView?.({ block: 'start' })
  }
  useEffect(() => { if (window.location.hash) revealSection(window.location.hash) }, [])
  const isArchived = Boolean(order.archivedAt) || order.status === 'ARCHIVED'
  const editableOrder = isCoordinatorOrder(order) ? order : null
  const canEditActiveOrder = canEdit && !isArchived
  const installerIdsByScope = new Map(scopeAssignments.map((assignment) => [assignment.scopeId, assignment.employeeIds]))
  const visitScopes = cardRooms.flatMap((room) => room.scopes.map((scope) => ({
    id: scope.id,
    roomName: room.name,
    name: scope.name,
    installerIds: installerIdsByScope.get(scope.id) ?? [],
  })))
  const nextVisit = visits.filter((visit) => visit.startsAt && !['CANCELLED', 'COMPLETED'].includes(visit.status) && new Date(visit.endsAt ?? visit.startsAt!).getTime() >= Date.now())
    .sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime())[0]

  async function archive() {
    if (!window.confirm('Zarchiwizować to zlecenie? Karta pozostanie w historii, bez możliwości edycji.')) return
    setArchiving(true)
    setError('')
    try {
      const response = await fetch(`/api/installations/${order.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const result = await response.json()
        setError(result.error ?? 'Nie udało się zarchiwizować zlecenia.')
        return
      }
      router.push('/installations')
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-6 [overflow-wrap:anywhere]" onClickCapture={(event) => {
      const link = (event.target as HTMLElement).closest('a[href^="#"]')
      if (link) revealSection(link.getAttribute('href')!)
    }}>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/installations" className="inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4" style={{ color: '#8C5718' }}>
              <ArrowLeft className="h-4 w-4" /> Wróć do kart
            </Link>
            <Link href="/installations/instrukcje" className="inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4" style={{ color: '#8C5718' }}>
              <BookOpen className="h-4 w-4" aria-hidden="true" /> Instrukcje montaży
            </Link>
          </div>
          <p className="num mt-5 text-xs font-bold tracking-wide" style={{ color: '#8C5718' }}>{order.number}</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>{order.client.name}</h1>
        </div>
        {canEditActiveOrder && !editingContact && <Button type="button" variant="outline" onClick={() => setEditingContact(true)}>Edytuj dane</Button>}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-4" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--wd-dark)' }}><MapPin className="h-4 w-4" style={{ color: '#8C5718' }} /> Miejsce montażu</div>
          <p className="mt-3 text-sm" style={{ color: 'var(--wd-text-muted)' }}>{order.addressStreet} {order.addressBuildingNumber}{order.addressApartmentNumber ? `/${order.addressApartmentNumber}` : ''}, {order.addressPostalCode} {order.addressCity}</p>
          {editableOrder && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
            {editableOrder.client.phone && <a className="underline underline-offset-4" href={`tel:${editableOrder.client.phone}`}>{editableOrder.client.phone}</a>}
            {editableOrder.client.email && <a className="underline underline-offset-4" href={`mailto:${editableOrder.client.email}`}>{editableOrder.client.email}</a>}
          </div>}
        </div>
        <div className="rounded-xl border p-4" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--wd-dark)' }}><UsersRound className="h-4 w-4" style={{ color: '#8C5718' }} /> Odpowiedzialność</div>
          <p className="mt-3 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Opiekun: {order.primaryEmployee.firstName} {order.primaryEmployee.lastName}</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Zastępca: {order.backupEmployee.firstName} {order.backupEmployee.lastName}</p>
          <p className="mt-3 text-sm font-bold">{nextVisit ? `Najbliższa wizyta: ${formatWarsawDateTime(nextVisit.startsAt!)}` : 'Termin nieustalony'}</p>
        </div>
      </div>
      {editingContact && canEditActiveOrder && editableOrder && <InstallationOrderForm mode="edit" order={editableOrder} employees={employees} canManageOwners={false} onSaved={() => setEditingContact(false)} onCancel={() => setEditingContact(false)} />}
      <nav aria-label="Sekcje karty" className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-bold" style={{ color: '#8C5718' }}>
        {canEditActiveOrder && <a className="underline underline-offset-4" href="#preparation">Do ustalenia</a>}
        <a className="underline underline-offset-4" href="#scope">Zakres prac</a>
        {canEditActiveOrder && <a className="underline underline-offset-4" href="#client-form">Formularz klienta</a>}
        <a className="underline underline-offset-4" href="#visits">Wizyty i terminy</a>
        {!editableOrder && <a className="underline underline-offset-4" href="#acceptance">Protokoły odbioru</a>}
        {canEditActiveOrder && <a className="underline underline-offset-4" href="#attachments">Załączniki</a>}
      </nav>

      {isArchived ? (
        <p className="rounded-xl border px-4 py-3 text-sm font-medium" style={{ background: 'var(--wd-sand-light)', borderColor: 'rgba(30, 30, 30, 0.12)', color: 'var(--wd-dark)' }}>
          Karta jest zarchiwizowana. Historia i odpowiedzialność pozostają zachowane.
        </p>
      ) : null}
      {canEditActiveOrder && <section id="preparation" data-card-section aria-labelledby="preparation-heading" className="scroll-mt-6">
        <InstallationClarificationPanel orderId={order.id} clarifications={clarifications} readiness={readiness} hasSnapshot={selectedSnapshot !== null} canEdit onChanged={() => router.refresh()} />
        {visitFee?.fee.status === 'PENDING_APPROVAL' && <p className="mt-2 text-sm"><a href="#visit-fee" className="font-bold underline">Kwota za podjazd oczekuje na akceptację administratora.</a></p>}
      </section>}
      <section id="scope" data-card-section className="scroll-mt-6" aria-label="Zakres prac">
        <RoomScopeEditor orderId={order.id} initialRooms={rooms} catalog={catalog} canEdit={canEditActiveOrder} onRoomsChanged={(updated) => { setCardRooms(updated); router.refresh() }} />
      </section>
      {canEditActiveOrder && <section id="client-form" data-card-section aria-labelledby="client-form-heading" className="scroll-mt-6 rounded-2xl border p-4 sm:p-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30,30,30,.12)' }}>
        <h2 id="client-form-heading" className="text-xl font-extrabold">Formularz klienta</h2>
        <InstallationFormSnapshotPanel orderId={order.id} publishedTemplates={publishedTemplates} initialSnapshot={formSnapshot} canEdit={canEditActiveOrder} isArchived={isArchived} canReplace={clientLinks.length === 0 && formRevisions.length === 0} onSelected={(snapshot) => { setSelectedSnapshot(snapshot); router.refresh() }} />
        <ClientLinkPanel orderId={order.id} initialLinks={clientLinks} canEdit canGenerate={selectedSnapshot !== null} />
        <InstallationFormRevisionPanel revisions={formRevisions} files={files} />
      </section>}
      <section id="visits" data-card-section aria-labelledby="installation-visits-heading" className="scroll-mt-6">
        <InstallationVisitsPanel orderId={order.id} visits={visits} scopes={visitScopes} employees={employees} canEdit={canEditActiveOrder} canForceOverwrite={canManageGovernance && !isArchived} />
      </section>
      {!editableOrder && <InstallerProtocolPanel orderId={order.id} candidates={acceptanceCandidates} />}
      {canEditActiveOrder && <section id="attachments" data-card-section className="scroll-mt-6" aria-label="Załączniki zlecenia">
        <InstallationFilesPanel orderId={order.id} initialFiles={files} mismatches={mismatches} rooms={cardRooms.map((room) => ({ id: room.id, name: room.name, scopes: room.scopes.map((scope) => ({ id: scope.id, name: scope.name })) }))} canEdit={canEditActiveOrder} onChanged={() => router.refresh()} />
      </section>}
      {canEditActiveOrder && <details id="settings" data-card-section className="rounded-xl border p-4" style={{ borderColor: 'rgba(30,30,30,.12)' }}>
        <summary className="cursor-pointer text-lg font-bold">Ustawienia dodatkowe</summary>
        {ownership && <OwnershipPanel
        orderId={order.id}
        employees={employees}
        owners={{ primary: ownership.primaryEmployee, backup: ownership.backupEmployee }}
        delegations={ownership.delegations}
        history={ownership.auditEvents}
        canManage={canManageGovernance}
      />}
      {canEditActiveOrder && visitFee && <details id="visit-fee" className="rounded-xl border p-4" style={{ borderColor: 'rgba(30,30,30,.12)' }}>
        <summary className="cursor-pointer font-bold">Opłata za podjazd · {visitFee.fee.grossAmount ? `${visitFee.fee.grossAmount.replace('.', ',')} zł` : 'nie wybrano'}</summary>
        <VisitFeePanel
        orderId={order.id}
        fee={visitFee.fee}
        defaultPolicy={visitFee.defaultPolicy}
        canEdit
        canApprove={canManageGovernance}
      /></details>}
      {canArchive && !isArchived && <details className="rounded-xl border p-4" style={{ borderColor: 'rgba(30,30,30,.12)' }}><summary className="cursor-pointer font-bold">Archiwizacja</summary><Button type="button" variant="outline" onClick={archive} disabled={archiving} className="mt-3 min-h-11 border-red-200 text-red-800 hover:bg-red-50"><Archive />{archiving ? 'Archiwizowanie…' : 'Archiwizuj zlecenie'}</Button></details>}
      </details>}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    </div>
  )
}
