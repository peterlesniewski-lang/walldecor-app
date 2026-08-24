import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  canArchiveInstallationOrder,
  canEditInstallationOrder,
  canViewInstallationOrder,
} from '@/lib/installations/access'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { getInstallationOrder } from '@/lib/installations/order-service'
import { getInstallationOrderFormSnapshot, getInstallationOrderRooms, listInstallationCatalog, listInstallationFormTemplates } from '@/lib/installations/catalog-service'
import { listClientLinkStatuses } from '@/lib/installations/client-link'
import { listInstallationClarifications, listInstallationFormRevisions } from '@/lib/installations/form-service'
import { getInstallationReadiness } from '@/lib/installations/readiness'
import { getInstallationOwnershipView, getInstallationVisitFeeView } from '@/lib/installations/delegation-service'
import { listInstallationFiles, listInstallationMismatchesForEvidence } from '@/lib/installation-media/service'
import { InstallationOrderDetail } from '@/components/installations/order-detail'

type Params = { params: Promise<{ id: string }> }

export default async function InstallationOrderPage({ params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const order = await getInstallationOrder(prisma, id)
  if (!order) notFound()

  const viewer = await installationViewerFromSession(session)
  if (!canViewInstallationOrder(viewer, order)) notFound()

  const canCoordinateClientForm = canEditInstallationOrder(viewer, order)
  const canManageGovernance = viewer.role === 'ADMIN' || viewer.role === 'MANAGER'
  const rooms = await getInstallationOrderRooms(prisma, id)
  // An installer gets the limited work-order view. Client answers, their
  // clarification/evidence trail and client-link management are coordinator-only.
  const coordinatorData = canCoordinateClientForm ? await (async () => {
    const [employees, catalog, templates, formSnapshot, clientLinks, clarifications, readiness, formRevisions, ownership, visitFee, files, mismatches] = await Promise.all([
      prisma.employee.findMany({
        where: { active: true },
        select: { id: true, firstName: true, lastName: true },
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

  // Decimal is a Prisma value object and cannot cross the Server/Client
  // Component boundary. Keep the order model intact in the service layer and
  // serialize only the Task 4 snapshot exposed to the detail component.
  const clientOrder = {
    ...order,
    visitFeeGrossAmount: order.visitFeeGrossAmount?.toFixed(2) ?? null,
  }

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
  />
}
