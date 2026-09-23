import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  canArchiveInstallationOrder,
  canEditInstallationOrder,
  canViewInstallationOrder,
  isInstallationViewerAuthorized,
} from '@/lib/installations/access'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { getInstallationOrder } from '@/lib/installations/order-service'
import { getInstallationOrderFormSnapshot, getInstallationOrderRooms, listInstallationCatalog, listInstallationFormTemplates } from '@/lib/installations/catalog-service'
import { listClientLinkStatuses } from '@/lib/installations/client-link'
import { listInstallationClarifications, listInstallationFormRevisions } from '@/lib/installations/form-service'
import { getInstallationReadiness } from '@/lib/installations/readiness'
import { getInstallationOwnershipView, getInstallationVisitFeeView } from '@/lib/installations/delegation-service'
import { listInstallationFiles, listInstallationMismatchesForEvidence } from '@/lib/installation-media/service'
import { listInstallationVisits } from '@/lib/installations/visit-service'
import { listScopeInstallerAssignments } from '@/lib/installations/scope-assignment-service'
import { InstallationOrderDetail } from '@/components/installations/order-detail'
import { getInstallerInstallationCardData } from '@/lib/installations/installer-card-data'
import { listAcceptanceCandidates } from '@/lib/installations/acceptance-protocol'
import { Bricolage_Grotesque } from 'next/font/google'
import type { AcceptanceSnapshot } from '@/lib/installations/acceptance-protocol'

type Params = { params: Promise<{ id: string }> }
const acceptanceDisplay = Bricolage_Grotesque({ variable: '--font-acceptance-display', subsets: ['latin', 'latin-ext'], weight: ['700', '800'] })

async function loadAcceptanceProtocols(orderId: string) {
  const [protocols, invoiceTasks] = await Promise.all([
    prisma.installationAcceptanceProtocol.findMany({ where: { orderId }, select: {
      id: true, visitId: true, groupKey: true, revision: true, status: true, snapshotJson: true, resultsJson: true, clientNote: true,
      resolutionAsPrior: { select: { resolvingProtocolId: true } },
      unilateral: { select: { status: true } },
      alerts: { select: { emailStatus: true } },
      clientLinks: { where: { channel: 'EMAIL' }, select: { id: true, recipientEmail: true, expiresAt: true, revokedAt: true, sentAt: true }, orderBy: { createdAt: 'desc' } },
    }, orderBy: { createdAt: 'desc' } }),
    prisma.installationAcceptanceInvoiceTask.findMany({ where: { orderId }, select: { id: true, visitId: true, groupKey: true, title: true, status: true } }),
  ])
  const latestByGroup = new Map<string, number>()
  const invoiceTaskByGroup = new Map(invoiceTasks.map((task) => [`${task.visitId}:${task.groupKey}`, { id: task.id, title: task.title, status: task.status }]))
  for (const protocol of protocols) {
    const key = `${protocol.visitId}:${protocol.groupKey}`
    latestByGroup.set(key, Math.max(latestByGroup.get(key) ?? 0, protocol.revision))
  }
  return protocols.map((protocol) => {
    const snapshot = JSON.parse(protocol.snapshotJson) as AcceptanceSnapshot
    return {
      id: protocol.id, revision: protocol.revision, status: protocol.status,
      isLatest: protocol.revision === latestByGroup.get(`${protocol.visitId}:${protocol.groupKey}`),
      resolvedByProtocolId: protocol.resolutionAsPrior?.resolvingProtocolId ?? null,
      invoiceTask: invoiceTaskByGroup.get(`${protocol.visitId}:${protocol.groupKey}`) ?? null,
      hasIncompleteWorks: Boolean(protocol.resultsJson && (JSON.parse(protocol.resultsJson) as Array<{ result: string }>).some((result) => result.result !== 'DONE')),
      unilateralStatus: protocol.unilateral?.status ?? null,
      failedAlerts: protocol.alerts.filter((alert) => alert.emailStatus === 'FAILED').length,
      workType: snapshot.workType, visitStartsAt: snapshot.visitStartsAt, clientNote: protocol.clientNote,
      links: protocol.clientLinks.map((link) => ({ ...link, expiresAt: link.expiresAt.toISOString(), revokedAt: link.revokedAt?.toISOString() ?? null, sentAt: link.sentAt?.toISOString() ?? null })),
    }
  })
}

export default async function InstallationOrderPage({ params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const viewer = await installationViewerFromSession(session)
  if (!isInstallationViewerAuthorized(viewer)) notFound()
  if (viewer.role === 'INSTALLER') {
    const card = await getInstallerInstallationCardData(prisma, id, viewer)
    if (!card) notFound()
    const acceptanceCandidates = await listAcceptanceCandidates(prisma, id, viewer.employeeId!)
    return <div className={acceptanceDisplay.variable}><InstallationOrderDetail order={card.order} rooms={card.rooms} visits={card.visits} employees={[]} canEdit={false} canArchive={false} catalog={[]} clientLinks={[]} clarifications={[]} formRevisions={[]} files={[]} scopeAssignments={[]} acceptanceCandidates={acceptanceCandidates} /></div>
  }
  const order = await getInstallationOrder(prisma, id)
  if (!order) notFound()

  if (!canViewInstallationOrder(viewer, order)) notFound()

  const canCoordinateClientForm = canEditInstallationOrder(viewer, order)
  const canManageGovernance = viewer.role === 'ADMIN' || viewer.role === 'MANAGER'
  const [rooms, visits, scopeAssignments, acceptanceProtocols] = await Promise.all([
    getInstallationOrderRooms(prisma, id),
    listInstallationVisits(prisma, id),
    listScopeInstallerAssignments(prisma, id),
    loadAcceptanceProtocols(id),
  ])
  // Client answers, evidence and link management are coordinator-only.
  const coordinatorData = canCoordinateClientForm ? await (async () => {
    const [employees, catalog, templates, formSnapshot, clientLinks, clarifications, readiness, formRevisions, ownership, visitFee, files, mismatches] = await Promise.all([
      prisma.employee.findMany({
        where: { active: true },
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      listInstallationCatalog(prisma),
      listInstallationFormTemplates(prisma),
      getInstallationOrderFormSnapshot(prisma, id),
      listClientLinkStatuses(prisma, id),
      listInstallationClarifications(prisma, id),
      getInstallationReadiness(prisma, id),
      listInstallationFormRevisions(prisma, id),
      getInstallationOwnershipView(prisma, id),
      getInstallationVisitFeeView(prisma, id),
      listInstallationFiles(prisma, id),
      listInstallationMismatchesForEvidence(prisma, id),
    ])
    return { employees, catalog, templates, formSnapshot, clientLinks, clarifications, readiness, formRevisions, ownership, visitFee, files, mismatches }
  })() : null

  // The coordinator model needs Decimal serialization at the client boundary.
  const clientOrder = {
    ...order,
    visitFeeGrossAmount: order.visitFeeGrossAmount?.toFixed(2) ?? null,
  }

  return <div className={acceptanceDisplay.variable}><InstallationOrderDetail
    order={clientOrder}
    employees={coordinatorData?.employees ?? []}
    canEdit={canCoordinateClientForm}
    canArchive={canArchiveInstallationOrder(viewer, order)}
    rooms={rooms}
    catalog={coordinatorData?.catalog ?? []}
    publishedTemplates={coordinatorData?.templates.filter((template) => template.status === 'PUBLISHED').map(({ id: templateId, name, version }) => ({ id: templateId, name, version })) ?? []}
    formSnapshot={coordinatorData?.formSnapshot ?? null}
    clientLinks={coordinatorData?.clientLinks ?? []}
    clarifications={coordinatorData?.clarifications ?? []}
    readiness={coordinatorData?.readiness ?? { isReady: false, openBlockingCount: 0, submittedCount: 0 }}
    formRevisions={coordinatorData?.formRevisions ?? []}
    ownership={coordinatorData?.ownership ?? null}
    visitFee={coordinatorData?.visitFee ?? null}
    files={coordinatorData?.files ?? []}
    acceptanceProtocols={acceptanceProtocols}
    mismatches={coordinatorData?.mismatches ?? []}
    canManageGovernance={canManageGovernance}
    visits={visits}
    scopeAssignments={scopeAssignments}
  /></div>
}
