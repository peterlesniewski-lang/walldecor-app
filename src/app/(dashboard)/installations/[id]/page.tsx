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
import { getInstallationOrderFormSnapshot, getInstallationOrderRooms, getInstallerInstallationOrderRooms, listInstallationCatalog, listInstallationFormTemplates } from '@/lib/installations/catalog-service'
import { listClientLinkStatuses } from '@/lib/installations/client-link'
import { listInstallationClarifications, listInstallationFormRevisions } from '@/lib/installations/form-service'
import { getInstallationReadiness } from '@/lib/installations/readiness'
import { getInstallationOwnershipView, getInstallationVisitFeeView } from '@/lib/installations/delegation-service'
import { listInstallationFiles, listInstallationMismatchesForEvidence } from '@/lib/installation-media/service'
import { listInstallationVisits } from '@/lib/installations/visit-service'
import { listScopeInstallerAssignments } from '@/lib/installations/scope-assignment-service'
import { InstallationOrderDetail } from '@/components/installations/order-detail'
import { presentInstallerInstallationOrder } from '@/lib/installations/order-presenter'
import { presentInstallerInstallationVisits } from '@/lib/installations/installer-visit-presenter'

type Params = { params: Promise<{ id: string }> }

export default async function InstallationOrderPage({ params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const viewer = await installationViewerFromSession(session)
  if (!isInstallationViewerAuthorized(viewer)) notFound()
  const order = await getInstallationOrder(prisma, id)
  if (!order) notFound()

  if (!canViewInstallationOrder(viewer, order)) notFound()

  const canCoordinateClientForm = canEditInstallationOrder(viewer, order)
  const canManageGovernance = viewer.role === 'ADMIN' || viewer.role === 'MANAGER'
  const [rooms, visits, scopeAssignments] = await Promise.all([
    viewer.role === 'INSTALLER'
      ? getInstallerInstallationOrderRooms(prisma, id, viewer.employeeId!)
      : getInstallationOrderRooms(prisma, id),
    listInstallationVisits(prisma, id),
    listScopeInstallerAssignments(prisma, id),
  ])
  // An installer gets the limited work-order view. Client answers, their
  // clarification/evidence trail and client-link management are coordinator-only.
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

  // Cross the Server/Client boundary with a role-specific payload: an explicit
  // installer allowlist, or the coordinator model with Decimal serialized.
  const installerView = viewer.role === 'INSTALLER'
  const clientOrder = installerView
    ? presentInstallerInstallationOrder(order)
    : {
        ...order,
        visitFeeGrossAmount: order.visitFeeGrossAmount?.toFixed(2) ?? null,
      }
  const clientVisits = installerView
    ? presentInstallerInstallationVisits(visits, viewer)
    : visits

  return <InstallationOrderDetail
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
    mismatches={coordinatorData?.mismatches ?? []}
    canManageGovernance={canManageGovernance}
    visits={clientVisits}
    scopeAssignments={installerView ? [] : scopeAssignments}
  />
}
